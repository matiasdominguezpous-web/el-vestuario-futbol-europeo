import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = resolve(root, 'outputs/data.js');
const newsFile = resolve(root, 'outputs/news-data.js');
const snapshotFile = resolve(root, 'work/news-snapshot.json');
const apiBase = 'https://tmapi.transfermarkt.technology';
const competitions = [
  { id: 'eng.1', code: 'GB1', name: 'Premier League', flag: '🇬🇧' },
  { id: 'esp.1', code: 'ES1', name: 'LaLiga', flag: '🇪🇸' },
  { id: 'ita.1', code: 'IT1', name: 'Serie A', flag: '🇮🇹' },
  { id: 'ger.1', code: 'L1', name: 'Bundesliga', flag: '🇩🇪' },
  { id: 'fra.1', code: 'FR1', name: 'Ligue 1', flag: '🇫🇷' },
  { id: 'por.1', code: 'PO1', name: 'Liga Portugal', flag: '🇵🇹' },
  { id: 'ned.1', code: 'NL1', name: 'Eredivisie', flag: '🇳🇱' },
  { id: 'bel.1', code: 'BE1', name: 'Pro League', flag: '🇧🇪' },
  { id: 'tur.1', code: 'TR1', name: 'Süper Lig', flag: '🇹🇷' },
  { id: 'sco.1', code: 'SC1', name: 'Premiership', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseWindowData(source, key) {
  const prefix = `window.${key}=`;
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error(`Missing ${key}`);
  return JSON.parse(source.slice(start + prefix.length).trim().replace(/;\s*$/, ''));
}

async function readWindowFile(file, key) {
  return parseWindowData(await readFile(file, 'utf8'), key);
}

async function optionalWindowFile(file, key) {
  try { return await readWindowFile(file, key); } catch { return null; }
}

async function api(path, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await fetch(`${apiBase}/${path}`, { signal: AbortSignal.timeout(30_000) });
      const payload = response.ok ? await response.json() : null;
      if (payload?.success && payload.data != null) return payload.data;
    } catch {}
    await sleep(350 * (attempt + 1));
  }
  throw new Error(`Transfermarkt API unavailable: ${path}`);
}

function moneyValue(value) {
  const match = String(value || '').match(/([\d.]+)([MK])/i);
  if (!match) return 0;
  return Number(match[1]) * (match[2].toUpperCase() === 'M' ? 1_000_000 : 1_000);
}

function buildCatalog(data) {
  const clubs = new Map();
  const players = new Map();
  for (const [leagueId, league] of Object.entries(data)) {
    for (const team of league.teams) {
      const roster = league.rosters[String(team.id)]?.players || [];
      const value = roster.reduce((total, player) => total + moneyValue(player.marketValue), 0);
      const club = {
        id: String(team.tmId),
        name: team.displayName,
        logo: team.logo || '',
        leagueId,
        value,
      };
      clubs.set(club.id, club);
      for (const player of roster) {
        players.set(String(player.tmId), {
          playerId: String(player.tmId),
          name: player.name,
          clubId: club.id,
          clubName: club.name,
          clubLogo: club.logo,
          leagueId,
          position: player.exactPosition || player.position || '',
          marketValue: player.marketValue || 'S/D',
          country: player.country || '',
        });
      }
    }
  }
  return { clubs, players };
}

function serializePlayers(players) {
  return Object.fromEntries([...players].sort(([a], [b]) => a.localeCompare(b)).map(([id, player]) => [id, {
    name: player.name,
    clubId: player.clubId,
    clubName: player.clubName,
  }]));
}

function firstBaseline(currentData) {
  try {
    const source = execFileSync('git', ['show', 'HEAD^:outputs/data.js'], { cwd: root, maxBuffer: 25_000_000 }).toString();
    return serializePlayers(buildCatalog(parseWindowData(source, 'FOOTBALL_DATA')).players);
  } catch {
    return serializePlayers(buildCatalog(currentData).players);
  }
}

function transferUpdates(previous, current, existing, clubs, detectedAt) {
  const updates = [];
  for (const [playerId, player] of current) {
    const old = previous[playerId];
    if (old?.clubId === player.clubId) continue;
    updates.push({
      id: `${playerId}:${old?.clubId || 'alta'}:${player.clubId}`,
      playerId,
      name: player.name,
      type: old ? 'transfer' : 'alta',
      from: old ? { id: old.clubId, name: old.clubName, logo: clubs.get(old.clubId)?.logo || '' } : null,
      to: { id: player.clubId, name: player.clubName, logo: player.clubLogo || '' },
      leagueId: player.leagueId,
      position: player.position,
      marketValue: player.marketValue,
      country: player.country,
      detectedAt,
    });
  }
  const merged = new Map((existing || []).map(item => [item.id, item]));
  updates.forEach(item => merged.set(item.id, item));
  return [...merged.values()].sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt)).slice(0, 24);
}

function matchPayload(game, competition, clubs) {
  const home = clubs.get(String(game.homeClub?.clubId));
  const away = clubs.get(String(game.awayClub?.clubId));
  const date = game.baseDetails?.date?.dateTimeUTC;
  if (!home || !away || !date) return null;
  return {
    id: String(game.gameId || game.id),
    leagueId: competition.id,
    competition: competition.name,
    flag: competition.flag,
    gameDay: Number(game.baseDetails?.gameDay || 0),
    date,
    home: { id: home.id, name: home.name, logo: home.logo },
    away: { id: away.id, name: away.name, logo: away.logo },
    score: { home: game.score?.home, away: game.score?.away },
    finished: Boolean(game.isFinished),
    url: game.relativeUrl ? `https://www.transfermarkt.com${game.relativeUrl}` : '',
    importance: home.value + away.value,
  };
}

function selectMatches(items, limit, maxPerLeague = 3) {
  const counts = new Map();
  const selected = [];
  for (const item of items) {
    const count = counts.get(item.leagueId) || 0;
    if (count >= maxPerLeague) continue;
    selected.push(item);
    counts.set(item.leagueId, count + 1);
    if (selected.length === limit) break;
  }
  return selected.sort((a, b) => new Date(b.date) - new Date(a.date)).map(({ importance, ...item }) => item);
}

const currentData = await readWindowFile(dataFile, 'FOOTBALL_DATA');
const previousNews = await optionalWindowFile(newsFile, 'NEWS_DATA');
const { clubs, players } = buildCatalog(currentData);
let previousSnapshot;
try { previousSnapshot = JSON.parse(await readFile(snapshotFile, 'utf8')); }
catch { previousSnapshot = null; }
const previousPlayers = previousSnapshot?.players || firstBaseline(currentData);

const detectedAt = new Date().toISOString();
const transfers = transferUpdates(previousPlayers, players, previousNews?.transfers, clubs, detectedAt);
const fixtureSets = await Promise.all(competitions.map(async competition => ({
  competition,
  fixtures: (await api(`competition/${competition.code}/fixtures`)).fixtures || [],
})));
const allMatches = fixtureSets.flatMap(({ competition, fixtures }) => fixtures.flatMap(matchDay =>
  (matchDay.games || []).map(game => matchPayload(game, competition, clubs)).filter(Boolean)
));

const now = Date.now();
const recentCutoff = now - 8 * 24 * 60 * 60 * 1000;
const upcomingCutoff = now + 8 * 24 * 60 * 60 * 1000;
const finished = allMatches.filter(match => match.finished && Number.isFinite(match.score.home) && Number.isFinite(match.score.away) && new Date(match.date).getTime() >= recentCutoff)
  .sort((a, b) => (b.importance + new Date(b.date).getTime() / 1000) - (a.importance + new Date(a.date).getTime() / 1000));
const upcoming = allMatches.filter(match => !match.finished && new Date(match.date).getTime() >= now && new Date(match.date).getTime() <= upcomingCutoff)
  .sort((a, b) => (b.importance - a.importance) || (new Date(a.date) - new Date(b.date)));

const semantic = {
  matches: selectMatches(finished, 12),
  upcoming: selectMatches(upcoming, 8, 2).sort((a, b) => new Date(a.date) - new Date(b.date)),
  transfers,
};
const previousSemantic = previousNews ? {
  matches: previousNews.matches || [],
  upcoming: previousNews.upcoming || [],
  transfers: previousNews.transfers || [],
} : null;
const changed = JSON.stringify(semantic) !== JSON.stringify(previousSemantic);
const payload = {
  updatedAt: changed || !previousNews ? detectedAt : previousNews.updatedAt,
  ...semantic,
};

if (changed || !previousNews) {
  await writeFile(newsFile, `window.NEWS_DATA=${JSON.stringify(payload)};\n`);
}
const currentPlayers = serializePlayers(players);
if (!previousSnapshot || JSON.stringify(currentPlayers) !== JSON.stringify(previousSnapshot.players)) {
  await writeFile(snapshotFile, `${JSON.stringify({ updatedAt: detectedAt, players: currentPlayers })}\n`);
}
console.log(`News updated: ${payload.matches.length} results, ${payload.upcoming.length} upcoming, ${payload.transfers.length} transfers${changed ? '' : ' (no changes)'}`);
