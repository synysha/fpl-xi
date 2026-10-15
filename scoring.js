// Skóre hráča na viac kôl: FDR (náročnosť súperov) alebo vlastný model
const mult = (d) => 1 + (3 - d) * 0.12;
const num = (v) => parseFloat(v) || 0;
const fin = (x) => (Number.isFinite(x) ? x : 0);
const GOAL = { 1: 10, 2: 6, 3: 5, 4: 4 };
const CS = { 1: 4, 2: 4, 3: 1, 4: 0 };

export function makeCtx(teamObjs, nextEvent) {
  const teamById = {};
  let d = 0, a = 0, n = 0;
  for (const t of teamObjs) {
    teamById[t.id] = t;
    d += fin(t.strength_defence_home) + fin(t.strength_defence_away);
    a += fin(t.strength_attack_home) + fin(t.strength_attack_away);
    n += 2;
  }
  return { teamById, avgDef: d / n || 1100, avgAtt: a / n || 1100, gwPlayed: Math.max(1, nextEvent.id - 1) };
}

// Vlastný model: očakávané body hráča v jednom zápase
function modelXp(p, f, ctx) {
  let avail = 1;
  if (p.status !== 'a') {
    avail = p.chance_of_playing_next_round == null ? 0 : p.chance_of_playing_next_round / 100;
  }
  const exp = Math.min(90, num(p.minutes) / ctx.gwPlayed) * avail; // priemer minút na kolo
  if (!(exp > 0) || !GOAL[p.element_type]) return 0;
  const opp = ctx.teamById[f.opp] || {};
  const oppDef = (f.home ? opp.strength_defence_away : opp.strength_defence_home) || ctx.avgDef;
  const oppAtt = (f.home ? opp.strength_attack_away : opp.strength_attack_home) || ctx.avgAtt;
  const attM = fin(Math.pow(ctx.avgDef / oppDef, 3)) || 1; // slabá obrana súpera = viac gólov
  const csM = fin(Math.pow(ctx.avgAtt / oppAtt, 3)) || 1; // slabý útok súpera = viac čistých kont
  const t = p.element_type;
  const mins = num(p.minutes);
  const cs90 = num(p.clean_sheets_per_90) || (mins > 0 ? (num(p.clean_sheets) * 90) / mins : 0);
  const bonus90 = mins >= 180 ? (num(p.bonus) * 90) / mins : 0;
  let per90 =
    num(p.expected_goals_per_90) * attM * GOAL[t] +
    num(p.expected_assists_per_90) * attM * 3 +
    Math.min(0.6, cs90 * csM) * CS[t] +
    bonus90 * 0.8;
  if (t === 1) per90 += num(p.saves_per_90) / 3;
  if (t <= 2) per90 -= num(p.expected_goals_conceded_per_90) / csM / 2;
  return fin(Math.min(2, exp / 45) + per90 * (exp / 90));
}

export function scorePlayers(players, fixtures, startGw, horizon, metric, ctx) {
  const fx = {}; // tím -> kolo -> [zápasy]
  const add = (team, gw, o) => {
    if (!fx[team]) fx[team] = {};
    if (!fx[team][gw]) fx[team][gw] = [];
    fx[team][gw].push(o);
  };
  for (const f of fixtures) {
    if (f.event == null || f.event < startGw || f.event >= startGw + horizon) continue;
    add(f.team_h, f.event, { opp: f.team_a, home: true, d: f.team_h_difficulty });
    add(f.team_a, f.event, { opp: f.team_h, home: false, d: f.team_a_difficulty });
  }
  return players.map((p) => {
    const mine = fx[p.team] || {};
    const first = mine[startGw] || [];
    let rate = 0;
    let dref = 3;
    if (metric === 'ep_next') {
      const ep = num(p.ep_next);
      if (first.length && ep > 0) {
        rate = ep / first.length; // ep_next už obsahuje náročnosť prvého kola
        dref = first.reduce((s, f) => s + f.d, 0) / first.length;
      } else if (p.status === 'a') {
        rate = 0.5 * num(p.form) + 0.5 * num(p.points_per_game);
      }
    } else if (metric !== 'model') {
      rate = num(p[metric]);
    }
    const gw = [];
    const n = [];
    for (let g = startGw; g < startGw + horizon; g++) {
      const list = mine[g] || [];
      let v = 0;
      for (const f of list) {
        v += metric === 'model' ? modelXp(p, f, ctx) : (rate * mult(f.d)) / mult(dref);
      }
      gw.push(v);
      n.push(list.length);
    }
    return { ...p, _score: fin(gw.reduce((s, v) => s + v, 0)), _gw: gw.map(fin), _n: n };
  });
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// Hlboká analýza: model (xG/xA, sila súpera) + očakávané body FPL + priemer bodov na zápas
// + výkony hráča proti tomuto súperovi v minulej sezóne (h2h)
export function deepScores(players, fixtures, startGw, horizon, ctx, h2h) {
  const fx = {};
  const add = (team, gw, o) => {
    if (!fx[team]) fx[team] = {};
    if (!fx[team][gw]) fx[team][gw] = [];
    fx[team][gw].push(o);
  };
  for (const f of fixtures) {
    if (f.event == null || f.event < startGw || f.event >= startGw + horizon) continue;
    add(f.team_h, f.event, { opp: f.team_a, home: true, d: f.team_h_difficulty });
    add(f.team_a, f.event, { opp: f.team_h, home: false, d: f.team_a_difficulty });
  }
  return players.map((p) => {
    const mine = fx[p.team] || {};
    const first = mine[startGw] || [];
    const ep = num(p.ep_next);
    let epRate = 0;
    let dref = 3;
    if (first.length && ep > 0) {
      epRate = ep / first.length;
      dref = first.reduce((s, f) => s + f.d, 0) / first.length;
    }
    const ppg = num(p.points_per_game);
    let avail = 1;
    if (p.status !== 'a') avail = p.chance_of_playing_next_round == null ? 0 : p.chance_of_playing_next_round / 100;
    const minShare = Math.min(1, num(p.minutes) / ctx.gwPlayed / 75);
    let total = 0;
    let why = null;
    for (let g = startGw; g < startGw + horizon; g++) {
      for (const f of mine[g] || []) {
        const model = modelXp(p, f, ctx);
        const parts = [[0.35, model]];
        const epV = epRate > 0 ? (epRate * mult(f.d)) / mult(dref) : null;
        if (epV != null) parts.push([0.25, epV]);
        parts.push([0.2, ppg * mult(f.d) * avail * minShare]);
        const oppT = ctx.teamById[f.opp] || {};
        const hist = h2h && h2h[p.code] && h2h[p.code][oppT.code];
        const h2hAvg = hist && hist.length ? mean(hist) : null;
        if (h2hAvg != null) parts.push([Math.min(0.2, 0.1 * hist.length), h2hAvg * avail * minShare]);
        const ok = parts.filter((x) => Number.isFinite(x[1]));
        const wsum = ok.reduce((s, x) => s + x[0], 0) || 1;
        const v = fin(ok.reduce((s, x) => s + x[0] * x[1], 0) / wsum);
        total += v;
        if (!why && g === startGw) {
          why = {
            ppg, opp: oppT.short_name || '?', home: f.home, d: f.d, model, ep: epV,
            h2hAvg, h2hN: hist ? hist.length : 0, final: v,
          };
        }
      }
    }
    return { ...p, _score: fin(total), _why: why };
  });
}

// Tip kola: jeden hráč s najväčším potenciálom na body v najbližšom kole.
// Spája 4 veci: formu, priemer bodov, náročnosť súpera a body hráča proti tomuto súperovi v minulosti.
export function topPick(players, fixtures, gw, ctx, h2h) {
  const fx = {};
  for (const f of fixtures) {
    if (f.event !== gw) continue;
    (fx[f.team_h] = fx[f.team_h] || []).push({ opp: f.team_a, home: true, d: f.team_h_difficulty });
    (fx[f.team_a] = fx[f.team_a] || []).push({ opp: f.team_h, home: false, d: f.team_a_difficulty });
  }
  let best = null;
  for (const p of players) {
    if (p.element_type > 4 || p.status !== 'a') continue;
    if (num(p.minutes) / ctx.gwPlayed < 45) continue; // musí pravidelne hrať
    const list = fx[p.team];
    if (!list || !list.length) continue;
    const form = num(p.form);
    const ppg = num(p.points_per_game);
    let score = 0;
    let why = null;
    for (const f of list) {
      const oppT = ctx.teamById[f.opp] || {};
      const hist = h2h && h2h[p.code] && h2h[p.code][oppT.code];
      const n = hist ? hist.length : 0;
      const h2hAvg = n ? mean(hist) : null;
      let base = 0.5 * form + 0.5 * ppg;
      if (h2hAvg != null) {
        const w = Math.min(0.3, 0.1 * n);
        base = base * (1 - w) + h2hAvg * w;
      }
      score += fin(base * (1 + (3 - f.d) * 0.15));
      if (!why) why = { form, ppg, opp: oppT.short_name || '?', home: f.home, d: f.d, h2hAvg, h2hN: n };
    }
    if (!best || score > best.score) best = { p, score, why };
  }
  return best;
}
