import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiBase = 'https://tmapi.transfermarkt.technology';
const websiteBase = 'https://www.transfermarkt.com';
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

async function api(path, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await fetch(`${apiBase}/${path}`, { signal: AbortSignal.timeout(30_000) });
      const payload = response.ok ? await response.json() : null;
      if (payload?.success && payload.data != null) return payload.data;
    } catch {}
    await sleep(300 * (attempt + 1));
  }
  throw new Error(`Transfermarkt API unavailable: ${path}`);
}

async function website(path, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await fetch(`${websiteBase}/${path}`, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          'accept-language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(30_000),
      });
      const html = response.ok ? await response.text() : '';
      if (html.includes('<table class="items">')) return html;
    } catch {}
    await sleep(300 * (attempt + 1));
  }
  throw new Error(`Transfermarkt website unavailable: ${path}`);
}

function decodeHtml(value = '') {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return value.replace(/&(#x?[\da-f]+|[a-z]+);/gi, (entity, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
    const hexadecimal = code[1]?.toLowerCase() === 'x';
    const number = Number.parseInt(code.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
  });
}

function parseTopScorers(html, competition) {
  const tableStart = [...html.matchAll(/<table class="items">/g)]
    .map(match => match.index)
    .find(index => html.slice(index, html.indexOf('</thead>', index)).includes('icon-tor-table-header'));
  if (tableStart == null) return [];
  const tableEnd = html.indexOf('</tbody>', tableStart);
  if (tableEnd < 0) throw new Error(`${competition.name}: missing goalscorer table`);

  const rows = html.slice(tableStart, tableEnd).split(/<tr class="(?:odd|even)">/i).slice(1, 6);
  const scorers = rows.map((row, index) => {
    const rank = row.match(/^\s*<td class="zentriert">(\d+)<\/td>/i);
    const player = row.match(/<a title="([^"]+)" href="([^"]+\/profil\/spieler\/(\d+))">/i);
    const photo = row.match(/data-src="([^"]+)"[^>]+class="bilderrahmen-fixed/i)
      || row.match(/<img src="([^"]+)"[^>]+class="bilderrahmen-fixed/i);
    const club = row.match(/<a title="([^"]+)" href="[^"]*\/startseite\/verein\/(\d+)\/saison_id\/\d+"><img src="([^"]+)"/i);
    const stats = [...row.matchAll(/href="[^"]*\/leistungsdaten\/spieler\/\d+\/saison\/\d+\/wettbewerb\/[A-Z0-9]+">(\d+)<\/a>/gi)];
    if (!rank || !player || !photo || !club || stats.length < 2) {
      throw new Error(`${competition.name}: invalid goalscorer row ${index + 1}`);
    }
    return {
      rank: Number(rank[1]),
      playerId: player[3],
      name: decodeHtml(player[1]),
      photo: decodeHtml(photo[1]),
      profileUrl: `${websiteBase}${decodeHtml(player[2])}`,
      clubId: club[2],
      club: decodeHtml(club[1]),
      clubLogo: decodeHtml(club[3]),
      appearances: Number(stats[0][1]),
      goals: Number(stats[1][1]),
    };
  });
  if (!scorers.length || scorers.length > 5) throw new Error(`${competition.name}: invalid goalscorer count ${scorers.length}`);
  return scorers;
}

async function pool(items, size, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }));
}

const standings = {};
await pool(competitions, 5, async competition => {
  const [info, table] = await Promise.all([
    api(`competition/${competition.code}`),
    api(`competition/${competition.code}/table`),
  ]);
  const competitionSlug = info.relativeUrl?.split('/').filter(Boolean)[0];
  if (!competitionSlug || !info.currentSeasonId) throw new Error(`${competition.name}: missing current season`);
  const scorerHtml = await website(`${competitionSlug}/torschuetzenliste/wettbewerb/${competition.code}/saison_id/${info.currentSeasonId}`);
  const topScorers = parseTopScorers(scorerHtml, competition);
  const entries = (table.tables || []).flatMap(section => section.clubs || []);
  const clubIds = [...new Set(entries.map(entry => String(entry.clubId)))];
  const query = clubIds.map(id => `ids%5B%5D=${encodeURIComponent(id)}`).join('&');
  const profiles = await api(`clubs?${query}`);
  const clubs = new Map(profiles.map(profile => [String(profile.id), profile]));
  const rawRows = entries.map(entry => {
    const club = clubs.get(String(entry.clubId));
    if (!club) throw new Error(`${competition.name}: missing club ${entry.clubId}`);
    const game = entry.game || {};
    const goal = entry.goal || {};
    return {
      id: String(entry.clubId),
      name: club.name,
      shortName: club.baseDetails?.shortName || club.name,
      logo: club.crestUrl || club.historical?.images?.[0]?.url || '',
      position: Number(entry.ranking?.current || 0),
      previousPosition: Number(entry.ranking?.previous || entry.ranking?.current || 0),
      played: Number(game.totalCount || 0),
      wins: Number(game.winCount || 0),
      draws: Number(game.drawCount || 0),
      losses: Number(game.lossCount || 0),
      goalsFor: Number(goal.totalCount || 0),
      goalsAgainst: Number(goal.concededCount || 0),
      goalDifference: Number(goal.differenceCount || 0),
      points: Number(game.points || 0),
      pointsDeducted: Number(game.pointsMinus || 0),
      zone: entry.positioning?.description || '',
      zoneColor: entry.positioning?.color || '',
    };
  });
  const positionsAreUnique = new Set(rawRows.map(row => row.position)).size === rawRows.length;
  const rows = rawRows.map((row, index) => positionsAreUnique ? row : {
    ...row,
    position: index + 1,
    previousPosition: index + 1,
  }).sort((a, b) => a.position - b.position);

  if (!rows.length || rows.some(row => !row.position)) {
    throw new Error(`${competition.name}: invalid standings table`);
  }
  standings[competition.id] = {
    ...competition,
    season: info.currentSeason?.display || '26/27',
    rows,
    topScorers,
  };
  console.log(competition.name, rows.length, 'clubs,', topScorers.length, 'goalscorers');
});

const payload = {
  updatedAt: new Date().toISOString(),
  leagues: Object.fromEntries(competitions.map(competition => [competition.id, standings[competition.id]])),
};
await writeFile(resolve(root, 'outputs/standings-data.js'), `window.STANDINGS_DATA=${JSON.stringify(payload)};\n`);
console.log('Standings updated:', Object.values(payload.leagues).reduce((total, league) => total + league.rows.length, 0), 'clubs');
