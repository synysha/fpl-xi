// Výber najlepšej zostavy bez externých knižníc (lokálne prehľadávanie s reštartmi)
const val = (p, metric) => parseFloat(p[metric]) || 0;
const SQUAD_SIZE = { 1: 2, 2: 5, 3: 5, 4: 3 };
const XI_MIN = { 1: 1, 2: 3, 3: 2, 4: 1 };
const XI_MAX = { 1: 1, 2: 5, 3: 5, 4: 3 };

// Zúženie hráčov (dostupní, najlepší + lacní na lavičku)
function pickCandidates(players, metric) {
  const ok = players.filter(
    (p) =>
      p.status === 'a' &&
      (p.chance_of_playing_next_round == null || p.chance_of_playing_next_round >= 75)
  );
  const out = new Map();
  for (const t of [1, 2, 3, 4]) {
    const pos = ok.filter((p) => p.element_type === t);
    [...pos]
      .sort((a, b) => val(b, metric) - val(a, metric))
      .slice(0, 40)
      .forEach((p) => out.set(p.id, p));
    pos
      .filter((p) => p.minutes > 0)
      .sort((a, b) => a.now_cost - b.now_cost)
      .slice(0, 12)
      .forEach((p) => out.set(p.id, p));
  }
  return [...out.values()];
}

// Najlepšia základná 11 z danej 15-člennej súpisky + skóre
function evaluate(squad, metric) {
  const by = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of squad) by[p.element_type].push({ p, v: val(p, metric) });
  for (const t of [1, 2, 3, 4]) by[t].sort((a, b) => b.v - a.v);

  const starters = [];
  const count = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const rest = [];
  for (const t of [1, 2, 3, 4]) {
    for (let i = 0; i < by[t].length; i++) {
      if (i < XI_MIN[t]) {
        starters.push(by[t][i]);
        count[t]++;
      } else if (t !== 1) rest.push(by[t][i]);
    }
  }
  rest.sort((a, b) => b.v - a.v);
  for (const r of rest) {
    if (starters.length >= 11) break;
    const t = r.p.element_type;
    if (count[t] < XI_MAX[t]) {
      starters.push(r);
      count[t]++;
    }
  }
  const ids = new Set(starters.map((s) => s.p.id));
  let score = 0;
  let top = 0;
  for (const s of starters) {
    score += s.v;
    if (s.v > top) top = s.v;
  }
  score += top; // kapitán dostáva dvojnásobok
  for (const p of squad) if (!ids.has(p.id)) score += 0.05 * val(p, metric);
  return { score, starterIds: ids };
}

const sumCost = (sq) => sq.reduce((s, p) => s + p.now_cost, 0);

function teamCounts(sq) {
  const m = {};
  for (const p of sq) m[p.team] = (m[p.team] || 0) + 1;
  return m;
}

// Najlacnejšia platná súpiska ako východisko
function cheapestSquad(cands) {
  const sq = [];
  const need = { ...SQUAD_SIZE };
  const tc = {};
  const sorted = [...cands].sort((a, b) => a.now_cost - b.now_cost || Math.random() - 0.5);
  for (const p of sorted) {
    if (need[p.element_type] > 0 && (tc[p.team] || 0) < 3) {
      sq.push(p);
      need[p.element_type]--;
      tc[p.team] = (tc[p.team] || 0) + 1;
    }
  }
  return sq;
}

function localSearch(start, cands, metric, budget) {
  let squad = start;
  let best = evaluate(squad, metric).score;
  for (let iter = 0; iter < 60; iter++) {
    const ids = new Set(squad.map((p) => p.id));
    const cost = sumCost(squad);
    const tc = teamCounts(squad);
    let move = null;
    let moveScore = best + 1e-9;
    for (let i = 0; i < squad.length; i++) {
      const out = squad[i];
      for (const c of cands) {
        if (c.element_type !== out.element_type || ids.has(c.id)) continue;
        if (cost - out.now_cost + c.now_cost > budget) continue;
        const after = (tc[c.team] || 0) - (c.team === out.team ? 1 : 0) + 1;
        if (after > 3) continue;
        const next = squad.slice();
        next[i] = c;
        const sc = evaluate(next, metric).score;
        if (sc > moveScore) {
          moveScore = sc;
          move = next;
        }
      }
    }
    if (!move) break;
    squad = move;
    best = moveScore;
  }
  return { squad, score: best };
}

// Náhodné "zatrasenie" súpisky, aby sa našlo lepšie riešenie
function kick(squad, cands, budget, swaps) {
  let sq = squad.slice();
  for (let k = 0; k < swaps; k++) {
    const i = Math.floor(Math.random() * sq.length);
    const out = sq[i];
    const ids = new Set(sq.map((p) => p.id));
    const cost = sumCost(sq);
    const tc = teamCounts(sq);
    const opts = cands.filter(
      (c) =>
        c.element_type === out.element_type &&
        !ids.has(c.id) &&
        cost - out.now_cost + c.now_cost <= budget &&
        (tc[c.team] || 0) - (c.team === out.team ? 1 : 0) + 1 <= 3
    );
    if (opts.length) sq[i] = opts[Math.floor(Math.random() * opts.length)];
  }
  return sq;
}

export function lineup(squad, metric) {
  const { starterIds } = evaluate(squad, metric);
  const starters = squad
    .filter((p) => starterIds.has(p.id))
    .sort((a, b) => a.element_type - b.element_type || val(b, metric) - val(a, metric));
  const bench = squad
    .filter((p) => !starterIds.has(p.id))
    .sort(
      (a, b) =>
        (b.element_type === 1) - (a.element_type === 1) || val(b, metric) - val(a, metric)
    );
  const ranked = [...starters].sort((a, b) => val(b, metric) - val(a, metric));
  return {
    squad,
    starters,
    bench,
    captain: ranked[0],
    vice: ranked[1],
    cost: sumCost(squad) / 10,
    points: starters.reduce((s, p) => s + val(p, metric), 0) + val(ranked[0], metric),
  };
}

export function buildBestSquad(players, { metric = '_score', budget = 1000 } = {}) {
  const cands = pickCandidates(players, metric);
  let best = localSearch(cheapestSquad(cands), cands, metric, budget);
  for (let r = 0; r < 25; r++) {
    const trial = localSearch(kick(best.squad, cands, budget, 3 + (r % 4)), cands, metric, budget);
    if (trial.score > best.score + 1e-9) best = trial;
  }
  return lineup(best.squad, metric);
}

const MIN_GAIN = 1.5; // minimálny zisk bodov na jeden bezplatný transfer
const HIT = 4;

// Návrh transferov: bezplatné (podľa počtu voľných) + najviac jeden navyše za -4 body
export function suggestTransfers(players, ownIds, bank, free, metric = '_score', sell = {}) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const current = ownIds.map((id) => byId.get(id)).filter(Boolean);
  if (current.length !== 15) throw new Error('Tím nemá 15 hráčov.');
  const cands = pickCandidates(players, metric);
  const small = [];
  for (const t of [1, 2, 3, 4]) {
    const pos = cands.filter((p) => p.element_type === t);
    const top = [...pos].sort((a, b) => val(b, metric) - val(a, metric)).slice(0, 18);
    const cheap = [...pos].sort((a, b) => a.now_cost - b.now_cost).slice(0, 7);
    small.push(...new Set([...top, ...cheap]));
  }
  const price = (p) => (sell[p.id] !== undefined ? sell[p.id] : p.now_cost);
  const priceSum = (sq) => sq.reduce((t, p) => t + price(p), 0);
  const budget = priceSum(current) + bank;
  const base = evaluate(current, metric).score;
  const valid = (sq) => {
    if (priceSum(sq) > budget) return false;
    return Object.values(teamCounts(sq)).every((n) => n <= 3);
  };
  const owned = new Set(ownIds);

  const bestSingle = (squad, pool) => {
    const ids = new Set(squad.map((p) => p.id));
    let best = null;
    for (let i = 0; i < squad.length; i++) {
      for (const c of pool) {
        if (c.element_type !== squad[i].element_type || ids.has(c.id)) continue;
        const next = squad.slice();
        next[i] = c;
        if (!valid(next)) continue;
        const sc = evaluate(next, metric).score;
        if (!best || sc > best.score) best = { squad: next, score: sc };
      }
    }
    return best;
  };

  const K = Math.min(free + 1, 5);
  const opts = [{ squad: current, score: base }];
  const one = bestSingle(current, cands);
  opts[1] = one && one.score > base ? one : opts[0];

  let pair = null;
  for (let i = 0; i < 15; i++) {
    for (let j = i + 1; j < 15; j++) {
      for (const a of small) {
        if (a.element_type !== current[i].element_type || owned.has(a.id)) continue;
        for (const b of small) {
          if (b.element_type !== current[j].element_type || owned.has(b.id) || b.id === a.id) continue;
          const next = current.slice();
          next[i] = a;
          next[j] = b;
          if (!valid(next)) continue;
          const sc = evaluate(next, metric).score;
          if (!pair || sc > pair.score) pair = { squad: next, score: sc };
        }
      }
    }
  }
  opts[2] = pair && pair.score > opts[1].score ? pair : opts[1];
  for (let k = 3; k <= K; k++) {
    const nx = bestSingle(opts[k - 1].squad, cands);
    opts[k] = nx && nx.score > opts[k - 1].score ? nx : opts[k - 1];
  }

  const curIds = new Set(current.map((p) => p.id));
  const mk = (squad) => {
    const newIds = new Set(squad.map((p) => p.id));
    const outs = current.filter((p) => !newIds.has(p.id));
    const pool = squad.filter((p) => !curIds.has(p.id));
    return outs.map((o) => {
      const i = pool.findIndex((x) => x.element_type === o.element_type);
      const n = pool.splice(i, 1)[0];
      return { out: o, in: n, outPrice: price(o), inPrice: price(n) };
    });
  };

  // bezplatný plán: najviac `free` transferov, každý musí priniesť aspoň MIN_GAIN bodov
  let fk = 0;
  let fv = 0;
  for (let k = 1; k <= Math.min(free, K); k++) {
    const v = opts[k].score - base - MIN_GAIN * k;
    if (v > fv + 1e-9) {
      fk = k;
      fv = v;
    }
  }
  const freeOpt = opts[fk];
  const freeMoves = mk(freeOpt.squad);

  // jeden transfer navyše za -4 body, len ak sa oplatí
  let hitPlan = null;
  if (free + 1 <= K) {
    const o = opts[free + 1];
    const moves = mk(o.squad);
    const net = o.score - freeOpt.score - HIT;
    if (moves.length === free + 1 && net > 1) {
      hitPlan = { moves, gain: o.score - base, net, after: lineup(o.squad, metric) };
    }
  }

  return {
    before: lineup(current, metric),
    freePlan: {
      k: freeMoves.length,
      moves: freeMoves,
      gain: freeOpt.score - base,
      after: lineup(freeOpt.squad, metric),
    },
    hitPlan,
  };
}

export const metricValue = val;
