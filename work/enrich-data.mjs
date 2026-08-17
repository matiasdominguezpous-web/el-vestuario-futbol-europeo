import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../outputs/data.js');
const raw = await readFile(file, 'utf8');
const data = JSON.parse(raw.replace(/^window\.FOOTBALL_DATA=/, '').replace(/;\s*$/, ''));
const previousPlayers = new Map(Object.values(data).flatMap(l => Object.values(l.rosters).flatMap(r => r.players)).filter(p => p.tmId).map(p => [p.tmId, p]));
const competitions = {
  'eng.1': ['premier-league', 'GB1'], 'esp.1': ['laliga', 'ES1'],
  'ita.1': ['serie-a', 'IT1'], 'ger.1': ['bundesliga', 'L1'], 'fra.1': ['ligue-1', 'FR1'],
  'por.1': ['liga-portugal', 'PO1'], 'ned.1': ['eredivisie', 'NL1'],
  'bel.1': ['jupiler-pro-league', 'BE1'], 'tur.1': ['super-lig', 'TR1'],
  'sco.1': ['scottish-premiership', 'SC1'],
};
const aliases = {
  Deportivo: 'deportivo-la-coruna',
  'AC Milan': 'ac-mailand', 'AS Roma': 'as-rom', Atalanta: 'atalanta-bergamo', Bologna: 'fc-bologna', Cagliari: 'cagliari-calcio', Como: 'como-1907', Fiorentina: 'ac-florenz', Frosinone: 'frosinone-calcio', Genoa: 'genua-cfc', Internazionale: 'inter-mailand', Juventus: 'juventus-turin', Lazio: 'lazio-rom', Lecce: 'us-lecce', Monza: 'ac-monza', Napoli: 'ssc-neapel', Parma: 'parma-calcio-1913', Sassuolo: 'us-sassuolo', Torino: 'fc-turin', Udinese: 'udinese-calcio', Venezia: 'venezia-fc',
  'FC Cologne': '1-fc-koln',
  Nice: 'ogc-nizza', Strasbourg: 'rc-strassburg-alsace', Lyon: 'olympique-lyon', Marseille: 'olympique-marseille',
};
const ua = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function text(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try { const response = await fetch(url, { headers: ua }); if (response.ok) { const body = await response.text(); if (body.length > 1000) return body; } } catch {}
    await sleep(350 * (i + 1));
  }
  return '';
}
const clean = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&amp;/g, 'and').replace(/\b(fc|cf|ac|afc|calcio|football|club)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const words = s => new Set(clean(s).split(' ').filter(Boolean));
function similarity(a, b) {
  const A = words(a), B = words(b); let same = 0; A.forEach(w => { if (B.has(w)) same++; });
  return same / Math.max(A.size, B.size, 1) + (clean(a).includes(clean(b)) || clean(b).includes(clean(a)) ? .7 : 0);
}
function decode(value) { return value.replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').trim(); }
function groupPosition(position) {
  if (/goalkeeper/i.test(position)) return 'Goalkeeper';
  if (/back|defender/i.test(position)) return 'Defender';
  if (/midfield/i.test(position)) return 'Midfielder';
  return 'Forward';
}
function playersFrom(html) {
  const players = [];
  for (const row of html.matchAll(/<tr class="(?:odd|even)">([\s\S]*?)(?=<tr class="(?:odd|even)">|<\/tbody>)/g)) {
    const block = row[1];
    const identity = block.match(/href="\/([^"/]+)\/profil\/spieler\/(\d+)">\s*([^<]+?)\s*<\/a>/);
    const position = identity && block.slice(block.indexOf(identity[0]) + identity[0].length).match(/<tr>\s*<td>\s*([^<]+?)\s*<\/td>/);
    if (!identity || !position) continue;
    const tmId = identity[2], name = decode(identity[3]), exactPosition = decode(position[1]);
    const jersey = decode(block.match(/<div class=rn_nummer>([^<]*)<\/div>/)?.[1] || '—') || '—';
    const age = Number(block.match(/\((\d{1,2})\)<\/td>/)?.[1] || 0) || null;
    const country = decode(block.match(/title="([^"]+)"[^>]*class="flaggenrahmen"/)?.[1] || '');
    const photo = block.match(/data-src="([^"]*portrait[^"]+)"/)?.[1] || '';
    const marketValue = decode(block.match(new RegExp(`href="[^"]*\\/marktwertverlauf\\/spieler\\/${tmId}">\\s*([^<]+)`))?.[1] || 'S/D');
    const old = previousPlayers.get(tmId);
    players.push({ tmId, slug: identity[1], name, position: groupPosition(exactPosition), exactPosition, marketValue, age, country, number: jersey, photo, tmUrl: `https://www.transfermarkt.com/${identity[1]}/profil/spieler/${tmId}`, titles: old?.titles || [], titlesLoaded: old?.titlesLoaded || false, stats: old?.stats || { career: true, items: [] } });
  }
  return players;
}
function achievementsFrom(html) {
  const unique = new Map();
  for (const match of html.matchAll(/<h2[^>]*>\s*(\d+)x\s+([^<]+?)\s*<\/h2>/g)) unique.set(decode(match[2]), { name: decode(match[2]), count: Number(match[1]) });
  return [...unique.values()];
}
async function pool(items, size, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (cursor < items.length) { const index = cursor++; await worker(items[index], index); } }));
}

const allPlayers = [];
for (const [league, [competitionSlug, code]] of Object.entries(competitions)) {
  const competition = await text(`https://www.transfermarkt.com/${competitionSlug}/startseite/wettbewerb/${code}`);
  const clubs = [...competition.matchAll(/href="\/([^"/]+)\/startseite\/verein\/(\d+)\/saison_id\/2026"/g)].map(m => ({ slug: m[1], id: m[2] })).filter((v, i, a) => a.findIndex(x => x.id === v.id) === i);
  const claimed = new Set();
  const assignments = [];
  for (const team of data[league].teams) {
    const alias = aliases[team.displayName];
    const available = clubs.filter(c => !claimed.has(c.id));
    const club = alias ? available.find(c => c.slug === alias) : available.sort((a, b) => similarity(team.displayName, b.slug) - similarity(team.displayName, a.slug))[0];
    if (!club) { console.warn('No Transfermarkt club match:', league, team.displayName); continue; }
    claimed.add(club.id); team.tmId = club.id; team.tmSlug = club.slug;
    assignments.push({ team, club });
  }
  await pool(assignments, 6, async ({ team, club }) => {
    const [squadPage, achievementsPage] = await Promise.all([
      text(`https://www.transfermarkt.com/${club.slug}/kader/verein/${club.id}/saison_id/2026/plus/1`),
      text(`https://www.transfermarkt.com/${club.slug}/erfolge/verein/${club.id}`),
    ]);
    const squad = playersFrom(squadPage);
    team.titles = achievementsFrom(achievementsPage);
    data[league].rosters[team.id] = { season: '2026–27 · Transfermarkt', players: squad };
    allPlayers.push(...squad);
    console.log(league, team.displayName, squad.length, 'players,', team.titles.length, 'honours');
  });
}

const playersWithoutTitles = allPlayers.filter(player => player.titlesLoaded !== 2);
console.log('Fetching player honours for', playersWithoutTitles.length, 'players');
await pool(playersWithoutTitles, 16, async (player, index) => {
  player.titles = achievementsFrom(await text(`https://www.transfermarkt.com/${player.slug}/erfolge/spieler/${player.tmId}`, 3));
  player.titlesLoaded = 2;
  if (index % 100 === 0) console.log('honours', index, '/', playersWithoutTitles.length);
});

await writeFile(file, `window.FOOTBALL_DATA=${JSON.stringify(data)};\n`);
console.log('Transfermarkt enrichment complete:', allPlayers.length, 'players');
