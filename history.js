// Výkony hráčov proti jednotlivým súperom v minulej sezóne.
// Oficiálne FPL API ich nemá, preto používame verejný dataset github.com/vaastav/Fantasy-Premier-League
import { getCache, setCache } from './storage';

const RAW = 'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/';

export function lastSeasonName(events) {
  const y = new Date(events[0].deadline_time).getFullYear();
  return `${y - 1}-${String(y).slice(2)}`;
}

function splitLine(line) {
  if (line.indexOf('"') === -1) return line.split(',');
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// vráti riadky len s požadovanými stĺpcami
export function parseCsv(text, cols) {
  const lines = text.split('\n');
  const head = splitLine(lines[0].replace('\r', ''));
  const pos = cols.map((c) => head.indexOf(c));
  if (pos.some((i) => i < 0)) throw new Error('v dátach chýba stĺpec');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    const a = splitLine(l.replace('\r', ''));
    out.push(pos.map((j) => a[j]));
  }
  return out;
}

async function getText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('súbor sa nenašiel (' + r.status + ')');
  return r.text();
}

// map[kód hráča][kód súpera] = [body v jednotlivých zápasoch]
export async function loadH2H(events) {
  const season = lastSeasonName(events);
  const key = 'h2h-' + season;
  const cached = await getCache(key);
  if (cached) return { map: cached, season };
  try {
    const [pl, tm, gw] = await Promise.all([
      getText(`${RAW}${season}/players_raw.csv`),
      getText(`${RAW}${season}/teams.csv`),
      getText(`${RAW}${season}/gws/merged_gw.csv`),
    ]);
    const idToCode = {};
    parseCsv(pl, ['id', 'code']).forEach(([id, code]) => (idToCode[id] = code));
    const teamCode = {};
    parseCsv(tm, ['id', 'code']).forEach(([id, code]) => (teamCode[id] = code));
    const map = {};
    for (const [el, opp, pts, mins] of parseCsv(gw, ['element', 'opponent_team', 'total_points', 'minutes'])) {
      if (!(parseFloat(mins) > 0)) continue;
      const pc = idToCode[el];
      const oc = teamCode[opp];
      if (!pc || !oc) continue;
      if (!map[pc]) map[pc] = {};
      if (!map[pc][oc]) map[pc][oc] = [];
      map[pc][oc].push(parseFloat(pts) || 0);
    }
    await setCache(key, map);
    return { map, season };
  } catch (e) {
    return { map: null, season, error: e.message };
  }
}

// Ligové zápasy z dvoch minulých sezón (na vzájomné zápasy tímov)
export async function loadPastMatches(events) {
  const y = new Date(events[0].deadline_time).getFullYear();
  const matches = [];
  const errors = [];
  const info = [];
  for (const back of [1, 2, 3]) {
    const season = `${y - back}-${String(y - back + 1).slice(2)}`;
    const key = 'matches3-' + season;
    let m = null;
    try { m = await getCache(key); } catch (e) { m = null; }
    if (m && m.length === 0) m = null;
    if (!m) {
      try {
        const [tm, fx] = await Promise.all([
          getText(`${RAW}${season}/teams.csv`),
          getText(`${RAW}${season}/fixtures.csv`),
        ]);
        const code = {};
        const nm = {};
        let rows;
        try { rows = parseCsv(tm, ['id', 'code', 'name']); } catch (e) { rows = parseCsv(tm, ['id', 'code']).map((r) => [...r, '']); }
        rows.forEach(([id, c, n]) => { code[id] = c; nm[id] = n; });
        m = parseCsv(fx, ['event', 'team_h', 'team_a', 'team_h_score', 'team_a_score', 'kickoff_time', 'id'])
          .filter((r) => r[3] !== '' && r[4] !== '' && code[r[1]] !== undefined && code[r[2]] !== undefined)
          .map(([ev, h, a, hs, ag, dt, fid]) => ({ id: Number(fid), ev: Number(ev), h: code[h], a: code[a], hn: nm[h], an: nm[a], hs: Number(hs), ag: Number(ag), dt }));
        if (m.length === 0) throw new Error('prázdny súbor');
        try { await setCache(key, m); } catch (e) {}
      } catch (e) {
        errors.push(`${season}: ${e.message}`);
        m = [];
      }
    }
    info.push(`${season}: ${m.length} zápasov`);
    m.forEach((x) => matches.push({ ...x, season }));
  }
  return { matches, errors, info };
}

// Najlepší 3 hráči podľa bodov v konkrétnom zápase z minulých sezón (dáta po kolách z datasetu)
const gwRowsCache = {};
function gwRows(season, ev) {
  const k = season + ':' + ev;
  if (!gwRowsCache[k]) {
    gwRowsCache[k] = getText(`${RAW}${season}/gws/gw${ev}.csv`).then((t) =>
      parseCsv(t, ['name', 'team', 'fixture', 'total_points', 'minutes'])
    );
    gwRowsCache[k].catch(() => delete gwRowsCache[k]);
  }
  return gwRowsCache[k];
}

export async function loadMatchTop(m) {
  const key = `top-${m.season}-${m.id}`;
  let cached = null;
  try { cached = await getCache(key); } catch (e) { cached = null; }
  if (cached && cached.length) return cached;
  const rows = await gwRows(m.season, m.ev);
  const top = rows
    .filter((r) => Number(r[2]) === Number(m.id))
    .sort((a, b) => Number(b[3]) - Number(a[3]) || Number(b[4]) - Number(a[4]))
    .slice(0, 3)
    .map((r) => ({ name: r[0], pts: Number(r[3]), side: r[1] === m.hn ? 'h' : r[1] === m.an ? 'a' : '' }));
  if (top.length) { try { await setCache(key, top); } catch (e) {} }
  return top;
}
