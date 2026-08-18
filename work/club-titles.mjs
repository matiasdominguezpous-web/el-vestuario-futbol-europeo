import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../outputs/data.js');
const raw = await readFile(file, 'utf8');
const data = JSON.parse(raw.replace(/^window\.FOOTBALL_DATA=/, '').replace(/;\s*$/, ''));
const requested = new Set(process.argv.slice(2));
const teams = Object.values(data).flatMap(league => league.teams)
  .filter(team => team.tmId && team.tmSlug && (!requested.size || requested.has(String(team.tmId))));
const ua = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36' };

function decode(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').trim();
}

function achievementsFrom(html) {
  const unique = new Map();
  for (const match of html.matchAll(/<h2[^>]*>\s*(\d+)x\s+([^<]+?)\s*<\/h2>/g)) {
    unique.set(decode(match[2]), { name: decode(match[2]), count: Number(match[1]) });
  }
  return [...unique.values()];
}

async function load(team) {
  const url = `https://www.transfermarkt.com/${team.tmSlug}/erfolge/verein/${team.tmId}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: ua, signal: AbortSignal.timeout(30_000) });
      const html = response.ok ? await response.text() : '';
      if (/Club achievements|Vereinserfolge|Erfolge/i.test(html)) return achievementsFrom(html);
    } catch {}
  }
  throw new Error(`Could not refresh club honours for ${team.displayName}`);
}

let cursor = 0;
await Promise.all(Array.from({ length: Math.min(12, teams.length) }, async () => {
  while (cursor < teams.length) {
    const team = teams[cursor++];
    team.titles = await load(team);
    console.log(team.displayName, team.titles.length, 'honours');
  }
}));

await writeFile(file, `window.FOOTBALL_DATA=${JSON.stringify(data)};\n`);
console.log('done', teams.length);
