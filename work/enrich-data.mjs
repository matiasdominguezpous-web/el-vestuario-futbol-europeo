import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../outputs/data.js');
const raw = await readFile(file, 'utf8');
const data = JSON.parse(raw.replace(/^window\.FOOTBALL_DATA=/, '').replace(/;\s*$/, ''));
const previousPlayers = new Map(
  Object.values(data)
    .flatMap(league => Object.values(league.rosters).flatMap(roster => roster.players))
    .filter(player => player.tmId)
    .map(player => [String(player.tmId), player]),
);

const competitions = {
  'eng.1': 'GB1', 'esp.1': 'ES1', 'ita.1': 'IT1', 'ger.1': 'L1', 'fra.1': 'FR1',
  'por.1': 'PO1', 'ned.1': 'NL1', 'bel.1': 'BE1', 'tur.1': 'TR1', 'sco.1': 'SC1',
};

// Transfermarkt and ESPN occasionally use unrelated localized names. These stable
// IDs make the handful of genuinely ambiguous cases deterministic.
const clubOverrides = {
  'FC Cologne': '3',
  'Sint-Truidense': '475',
  'Union St.-Gilloise': '3948',
  'Erzurum BB': '39722',
  Fenerbahce: '36',
  Galatasaray: '141',
  Trabzonspor: '449',
  'Çorum FK': '37951',
};

const aliases = {
  Deportivo: 'deportivo-la-coruna',
  'AC Milan': 'ac-mailand', 'AS Roma': 'as-rom', Atalanta: 'atalanta-bergamo', Bologna: 'fc-bologna', Cagliari: 'cagliari-calcio', Como: 'como-1907', Fiorentina: 'ac-florenz', Frosinone: 'frosinone-calcio', Genoa: 'genua-cfc', Internazionale: 'inter-mailand', Juventus: 'juventus-turin', Lazio: 'lazio-rom', Lecce: 'us-lecce', Monza: 'ac-monza', Napoli: 'ssc-neapel', Parma: 'parma-calcio-1913', Sassuolo: 'us-sassuolo', Torino: 'fc-turin', Udinese: 'udinese-calcio', Venezia: 'venezia-fc',
  'FC Cologne': '1-fc-koln',
  Nice: 'ogc-nizza', Strasbourg: 'rc-strassburg-alsace', Lyon: 'olympique-lyon', Marseille: 'olympique-marseille',
};

const apiBase = 'https://tmapi.transfermarkt.technology';
const ua = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36' };
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

async function text(url, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await fetch(url, { headers: ua, signal: AbortSignal.timeout(30_000) });
      if (response.ok) {
        const body = await response.text();
        if (body.length > 1_000) return body;
      }
    } catch {}
    await sleep(350 * (attempt + 1));
  }
  return '';
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

const clean = value => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/&amp;/g, 'and')
  .replace(/\b(fc|cf|ac|afc|calcio|football|club|jk|sk|sv|vv)\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const words = value => new Set(clean(value).split(' ').filter(Boolean));

function similarity(a, b) {
  const A = words(a), B = words(b);
  let same = 0;
  A.forEach(word => { if (B.has(word)) same++; });
  const normalizedA = clean(a), normalizedB = clean(b);
  return same / Math.max(A.size, B.size, 1)
    + (normalizedA && normalizedB && (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) ? 0.7 : 0);
}

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

function slugFrom(relativeUrl, fallback = '') {
  return relativeUrl?.split('/').filter(Boolean)[0] || fallback;
}

function groupPosition(profile) {
  const category = profile?.attributes?.position?.category || profile?.attributes?.positionGroupName || '';
  if (/goalkeeper/i.test(category)) return 'Goalkeeper';
  if (/back|defender/i.test(category)) return 'Defender';
  if (/midfield/i.test(category)) return 'Midfielder';
  return 'Forward';
}

function marketValue(profile) {
  const current = profile?.marketValueDetails?.current;
  const compact = current?.compact;
  if (!current?.value) return 'S/D';
  return compact ? `${compact.prefix || ''}${compact.content || ''}${compact.suffix || ''}` : 'S/D';
}

function seasonLabel(competition) {
  const id = Number(competition.currentSeasonId);
  return Number.isFinite(id) ? `${id}–${String(id + 1).slice(-2)} · Transfermarkt` : 'Plantilla actual · Transfermarkt';
}

const attributes = await api('attributes');
const countries = new Map((attributes.countries || []).map(country => [Number(country.id), country.name]));
const allPlayers = [];
const assignmentReport = [];

for (const [league, code] of Object.entries(competitions)) {
  const [competition, table] = await Promise.all([
    api(`competition/${code}`),
    api(`competition/${code}/table`),
  ]);
  const clubIds = [...new Set((table.tables || []).flatMap(section => (section.clubs || []).map(club => String(club.clubId))))];
  if (clubIds.length !== data[league].teams.length) {
    throw new Error(`${league}: ESPN has ${data[league].teams.length} clubs but Transfermarkt has ${clubIds.length}`);
  }
  const query = clubIds.map(id => `ids%5B%5D=${encodeURIComponent(id)}`).join('&');
  const profiles = await api(`clubs?${query}`);
  const clubs = profiles.map(profile => ({
    id: String(profile.id),
    name: profile.name,
    shortName: profile.baseDetails?.shortName || '',
    slug: slugFrom(profile.relativeUrl),
  }));

  const claimed = new Set();
  const assignments = [];
  for (const team of data[league].teams) {
    const available = clubs.filter(club => !claimed.has(club.id));
    const override = clubOverrides[team.displayName];
    const alias = aliases[team.displayName];
    let club = override ? available.find(candidate => candidate.id === override) : null;
    if (!club && alias) club = available.find(candidate => candidate.slug === alias);
    if (!club) {
      const ranked = available
        .map(candidate => ({
          candidate,
          score: Math.max(
            similarity(team.displayName, candidate.name),
            similarity(team.displayName, candidate.shortName),
            similarity(team.displayName, candidate.slug),
          ),
        }))
        .sort((a, b) => b.score - a.score);
      if (!ranked[0] || ranked[0].score < 0.45) {
        throw new Error(`${league}: no safe Transfermarkt match for ${team.displayName}`);
      }
      club = ranked[0].candidate;
    }
    claimed.add(club.id);
    team.tmId = club.id;
    team.tmSlug = club.slug;
    assignments.push({ team, club });
    assignmentReport.push(`${league}\t${team.displayName}\t${club.name}\t${club.id}`);
  }

  if (assignments.length !== clubs.length || claimed.size !== clubs.length) {
    throw new Error(`${league}: incomplete or duplicated club assignment`);
  }

  await pool(assignments, 8, async ({ team, club }) => {
    const [squadPayload, clubHonoursHtml] = await Promise.all([
      api(`club/${club.id}/squad`),
      text(`https://www.transfermarkt.com/${club.slug}/erfolge/verein/${club.id}`, 3),
    ]);
    if (clubHonoursHtml) team.titles = achievementsFrom(clubHonoursHtml);
    const members = (squadPayload.squad || []).filter(member => member.type === 'current' && String(member.clubId) === club.id);
    const playerIds = [...new Set(members.map(member => String(member.playerId)))];
    if (!playerIds.length) throw new Error(`${team.displayName}: Transfermarkt returned an empty squad`);

    const playerQuery = playerIds.map(id => `ids%5B%5D=${encodeURIComponent(id)}`).join('&');
    const playerProfiles = await api(`players?${playerQuery}`);
    const byId = new Map(playerProfiles.map(profile => [String(profile.id), profile]));
    const missing = playerIds.filter(id => !byId.has(id));
    if (missing.length) throw new Error(`${team.displayName}: ${missing.length} player profiles are missing (${missing.join(', ')})`);

    const squad = members.map(member => {
      const profile = byId.get(String(member.playerId));
      const tmId = String(profile.id);
      const old = previousPlayers.get(tmId);
      const slug = slugFrom(profile.relativeUrl, old?.slug);
      const nationalityId = Number(profile.nationalityDetails?.nationalities?.nationalityId);
      const exactPosition = profile.attributes?.position?.name || old?.exactPosition || 'Plantilla';
      return {
        tmId,
        slug,
        name: profile.name || profile.shortName || old?.name || `Jugador ${tmId}`,
        position: groupPosition(profile),
        exactPosition,
        marketValue: marketValue(profile),
        age: profile.lifeDates?.age ?? old?.age ?? null,
        country: countries.get(nationalityId) || old?.country || '',
        number: member.shirtNumber ?? '—',
        photo: profile.portraitUrl || old?.photo || '',
        tmUrl: `https://www.transfermarkt.com/${slug}/profil/spieler/${tmId}`,
        titles: old?.titles || [],
        titlesLoaded: old?.titlesLoaded || false,
        stats: old?.stats || { career: true, items: [] },
      };
    });

    data[league].rosters[team.id] = { season: seasonLabel(competition), players: squad };
    allPlayers.push(...squad);
    console.log(league, team.displayName, '→', club.name, squad.length, 'players');
  });
}

const duplicateAssignments = allPlayers
  .map(player => player.tmId)
  .filter((id, index, ids) => ids.indexOf(id) !== index);
if (duplicateAssignments.length) {
  throw new Error(`Players assigned to more than one club: ${[...new Set(duplicateAssignments)].join(', ')}`);
}

const playersWithoutTitles = allPlayers.filter(player => player.titlesLoaded !== 2);
console.log('Fetching player honours for', playersWithoutTitles.length, 'new players');
await pool(playersWithoutTitles, 16, async (player, index) => {
  const html = await text(`https://www.transfermarkt.com/${player.slug}/erfolge/spieler/${player.tmId}`, 3);
  player.titles = achievementsFrom(html);
  player.titlesLoaded = 2;
  if (index % 100 === 0) console.log('honours', index, '/', playersWithoutTitles.length);
});

await writeFile(file, `window.FOOTBALL_DATA=${JSON.stringify(data)};\n`);
console.log('Validated club assignments:\n' + assignmentReport.join('\n'));
console.log('Transfermarkt enrichment complete:', allPlayers.length, 'players');
