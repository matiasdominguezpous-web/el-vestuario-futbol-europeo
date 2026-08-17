import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const leagues = ['eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'por.1', 'ned.1', 'bel.1', 'tur.1', 'sco.1'];
const base = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const data = {};

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

for (const league of leagues) {
  const payload = await json(`${base}/${league}/teams`);
  const teams = (payload.sports?.[0]?.leagues?.[0]?.teams || []).map(({ team }) => ({
    id: team.id,
    displayName: team.displayName,
    abbreviation: team.abbreviation,
    color: team.color,
    logo: team.logos?.[0]?.href || '',
  }));
  const rosters = {};
  await Promise.all(teams.map(async (team) => {
    const roster = await json(`${base}/${league}/teams/${team.id}/roster`);
    rosters[team.id] = {
      season: roster.season?.displayName || 'Plantilla actual',
      players: (roster.athletes || []).map(player => ({
        id: player.id,
        name: player.displayName,
        age: player.age,
        country: player.citizenship || '',
        number: player.jersey || '—',
        position: player.position?.displayName || 'Plantilla',
        photo: player.headshot?.href || '',
      })),
    };
  }));
  data[league] = { teams, rosters };
  console.log(league, teams.length, Object.values(rosters).reduce((n, r) => n + r.players.length, 0));
}

await writeFile(resolve(root, 'outputs/data.js'), `window.FOOTBALL_DATA=${JSON.stringify(data)};\n`);
