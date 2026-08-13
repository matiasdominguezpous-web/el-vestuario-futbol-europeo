import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../outputs/data.js');
const raw = await readFile(file, 'utf8');
const data = JSON.parse(raw.replace(/^window\.FOOTBALL_DATA=/, '').replace(/;\s*$/, ''));
const players = Object.values(data).flatMap(league => Object.values(league.rosters).flatMap(roster => roster.players));
const targets = players.filter(player => player.tmId && !player.stats?.items?.length);

async function pool(items, size, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (cursor < items.length) { const index = cursor++; await worker(items[index], index); }
  }));
}

async function load(id) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`https://tmapi.transfermarkt.technology/player/${id}/performance-game`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return null;
}

await pool(targets, 18, async (player, index) => {
  const payload = await load(player.tmId);
  const games = payload?.data?.performance || [];
  const totals = { APPS: 0, STRT: 0, G: 0, A: 0, MIN: 0, YC: 0, RC: 0 };
  for (const game of games) {
    const stats = game.statistics || {}, general = stats.generalStatistics || {};
    if (general.participationState !== 'played') continue;
    totals.APPS++;
    if (stats.playingTimeStatistics?.isStarting) totals.STRT++;
    totals.MIN += Number(stats.playingTimeStatistics?.playedMinutes || 0);
    totals.G += Number(stats.goalStatistics?.goalsScoredTotalOfficial || 0);
    totals.A += Number(stats.goalStatistics?.assistsOfficial || 0);
    totals.YC += Number(stats.cardStatistics?.yellowCardGross || 0);
    totals.RC += Number(stats.cardStatistics?.redCards || stats.cardStatistics?.redCard || 0);
  }
  player.stats = { career: true, items: Object.entries(totals) };
  if (index % 100 === 0) console.log(index, '/', targets.length);
});

for (const player of players) if (!player.tmId) player.stats = { career: true, items: [] };
await writeFile(file, `window.FOOTBALL_DATA=${JSON.stringify(data)};\n`);
console.log('done', targets.length);
