import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../outputs/data.js');
const raw = await readFile(file, 'utf8');
const data = JSON.parse(raw.replace(/^window\.FOOTBALL_DATA=/, '').replace(/;\s*$/, ''));
const competitions = {
  'eng.1': ['premier-league', 'GB1'], 'esp.1': ['laliga', 'ES1'],
  'ita.1': ['serie-a', 'IT1'], 'ger.1': ['bundesliga', 'L1'], 'fra.1': ['ligue-1', 'FR1'],
};
const ua = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function text(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: ua }); if (r.ok) return r.text(); } catch {}
    await sleep(300 * (i + 1));
  }
  return '';
}
const clean = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&amp;/g, 'and').replace(/\b(fc|cf|ac|afc|calcio|football|club)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const words = s => new Set(clean(s).split(' ').filter(Boolean));
function similarity(a, b) {
  const A = words(a), B = words(b); let same = 0; A.forEach(w => { if (B.has(w)) same++; });
  return same / Math.max(A.size, B.size, 1) + (clean(a).includes(clean(b)) || clean(b).includes(clean(a)) ? .7 : 0);
}
function playersFrom(html) {
  const out = []; const re = /href="\/([^"/]+)\/profil\/spieler\/(\d+)">\s*([^<]+?)\s*<\/a>[\s\S]*?<tr>\s*<td>\s*([^<]+?)\s*<\/td>[\s\S]*?href="[^"]*\/marktwertverlauf\/spieler\/\2">\s*([^<]+?)\s*<\/a>/g;
  for (const m of html.matchAll(re)) out.push({ slug: m[1], tmId: m[2], name: m[3].trim(), exactPosition: m[4].trim(), marketValue: m[5].trim(), tmUrl: `https://www.transfermarkt.com/${m[1]}/profil/spieler/${m[2]}` });
  return out;
}
function compactStats(j) {
  const result = { season: '', items: [] };
  const wanted = new Set(['STRT', 'G', 'A', 'YC', 'CS', 'SV', 'GA']);
  for (const category of j.categories || []) {
    const row = category.statistics?.[0]; if (!row) continue;
    result.season ||= row.season?.abbreviation || '';
    category.labels.forEach((label, i) => { if (wanted.has(label)) result.items.push([label, row.stats[i] || '0']); });
  }
  return result;
}
async function pool(items, size, worker) {
  let cursor = 0; const runners = Array.from({ length: size }, async () => { while (cursor < items.length) { const i = cursor++; await worker(items[i], i); } }); await Promise.all(runners);
}

const matched = [];
for (const [league, [slug, code]] of Object.entries(competitions)) {
  const competition = await text(`https://www.transfermarkt.com/${slug}/startseite/wettbewerb/${code}`);
  const clubs = [...competition.matchAll(/href="\/([^"/]+)\/startseite\/verein\/(\d+)\/saison_id\/2026"/g)].map(m => ({ slug: m[1], id: m[2] })).filter((v, i, a) => a.findIndex(x => x.id === v.id) === i);
  for (const team of data[league].teams) {
    const club = clubs.slice().sort((a, b) => similarity(team.displayName, b.slug) - similarity(team.displayName, a.slug))[0];
    if (!club || similarity(team.displayName, club.slug) < .25) continue;
    const squad = playersFrom(await text(`https://www.transfermarkt.com/${club.slug}/kader/verein/${club.id}/saison_id/2026/plus/1`));
    const roster = data[league].rosters[team.id].players;
    for (const player of roster) {
      const candidate = squad.slice().sort((a, b) => similarity(player.name, b.name) - similarity(player.name, a.name))[0];
      if (candidate && similarity(player.name, candidate.name) >= .62) { Object.assign(player, candidate); matched.push(player); }
    }
    console.log(league, team.displayName, squad.length, roster.filter(p => p.tmId).length);
  }
}

console.log('Enriching details for', matched.length, 'matched players');
await pool(matched, 16, async (player, i) => {
  const [achievements, statsResponse] = await Promise.all([
    text(`https://www.transfermarkt.com/${player.slug}/erfolge/spieler/${player.tmId}`, 2),
    fetch(`https://site.web.api.espn.com/apis/common/v3/sports/soccer/athletes/${player.id}/stats?region=us&lang=en&contentorigin=espn`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
  ]);
  player.titles = [...achievements.matchAll(/title="([^"]+)"[^>]*class="data-header__success-data"[\s\S]*?data-header__success-number">(\d+)</g)].map(m => ({ name: m[1], count: Number(m[2]) }));
  player.stats = compactStats(statsResponse);
  if (i % 100 === 0) console.log('details', i, '/', matched.length);
});

await writeFile(file, `window.FOOTBALL_DATA=${JSON.stringify(data)};\n`);
console.log('done');
