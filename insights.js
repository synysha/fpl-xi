// Predajné ceny, sledovanie cien a porovnanie s ligou

// FPL predáva hráča len s polovicou zisku (zaokrúhlené nadol)
export function sellPrices(players, ownIds, transfers) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const buy = {};
  [...transfers]
    .sort((a, b) => new Date(a.time) - new Date(b.time))
    .forEach((t) => (buy[t.element_in] = t.element_in_cost));
  const out = {};
  for (const id of ownIds) {
    const p = byId.get(id);
    if (!p) continue;
    const b = buy[id] !== undefined ? buy[id] : p.now_cost - (p.cost_change_start || 0);
    out[id] = p.now_cost > b ? b + Math.floor((p.now_cost - b) / 2) : p.now_cost;
  }
  return out;
}

// Odhad: kto je najviac kupovaný / predávaný (možná zmena ceny)
export function priceWatch(players, ownIds = []) {
  const own = new Set(ownIds);
  const rows = players
    .filter((p) => parseFloat(p.selected_by_percent) >= 0.5)
    .map((p) => ({ p, net: (p.transfers_in_event || 0) - (p.transfers_out_event || 0), own: own.has(p.id) }));
  return {
    up: [...rows].sort((a, b) => b.net - a.net).slice(0, 8),
    down: [...rows].sort((a, b) => a.net - b.net).slice(0, 8),
  };
}

// Rozdielové voľby proti top rivalom v lige
export function leagueDiff(players, ownIds, rivalPicks) {
  const n = rivalPicks.length || 1;
  const cnt = {};
  rivalPicks.forEach((ids) => ids.forEach((id) => (cnt[id] = (cnt[id] || 0) + 1)));
  const byId = new Map(players.map((p) => [p.id, p]));
  const own = new Set(ownIds);
  const diff = ownIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((p) => ({ p, pct: ((cnt[p.id] || 0) / n) * 100 }))
    .filter((r) => r.pct <= 20)
    .sort((a, b) => b.p._score - a.p._score);
  const missing = Object.keys(cnt)
    .map(Number)
    .filter((id) => !own.has(id))
    .map((id) => ({ p: byId.get(id), pct: (cnt[id] / n) * 100 }))
    .filter((r) => r.p && r.pct >= 50)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8);
  return { diff, missing, n };
}

// Riadky o udalostiach zápasu (góly, červené karty, bonusy) z fixture.stats
export function eventLines(f, byId, teams) {
  const out = [];
  const defs = [['goals_scored', '⚽'], ['own_goals', '⚽ vl.'], ['red_cards', '🟥'], ['penalties_missed', '✖ pen.'], ['bonus', '⭐']];
  for (const [id, icon] of defs) {
    const st = (f.stats || []).find((x) => x.identifier === id);
    if (!st) continue;
    const fmt = (arr) =>
      (arr || [])
        .map((e) => {
          const p = byId.get(e.element);
          const n = p ? p.web_name : '?';
          return id === 'bonus' ? `${n} ${e.value}` : e.value > 1 ? `${n} ×${e.value}` : n;
        })
        .join(', ');
    const hs = fmt(st.h);
    const as = fmt(st.a);
    if (!hs && !as) continue;
    const parts = [hs && `${teams[f.team_h].short}: ${hs}`, as && `${teams[f.team_a].short}: ${as}`].filter(Boolean);
    out.push(`${icon} ${parts.join(' · ')}`);
  }
  return out;
}

// Body tvojho tímu naživo (násobok = kapitán, lavička = 0)
export function liveTotal(picks, liveElements) {
  const pts = new Map(liveElements.map((e) => [e.id, e.stats.total_points]));
  const rows = picks
    .map((k) => ({ element: k.element, pts: (pts.get(k.element) || 0) * k.multiplier, mult: k.multiplier, cap: k.is_captain, vice: k.is_vice_captain }))
    .filter((r) => r.mult > 0)
    .sort((a, b) => b.pts - a.pts);
  return { total: rows.reduce((s, r) => s + r.pts, 0), rows };
}

// Posledný odohraný ligový zápas každého tímu + forma z posledných 5 zápasov (najstarší prvý)
export function lastResults(fixtures) {
  const done = fixtures
    .filter((f) => (f.finished || f.finished_provisional) && f.team_h_score != null && f.team_a_score != null && f.kickoff_time)
    .sort((a, b) => b.kickoff_time.localeCompare(a.kickoff_time));
  const out = {};
  for (const f of done) {
    for (const home of [true, false]) {
      const team = home ? f.team_h : f.team_a;
      const gf = home ? f.team_h_score : f.team_a_score;
      const ga = home ? f.team_a_score : f.team_h_score;
      const res = gf > ga ? 'V' : gf < ga ? 'P' : 'R';
      if (!out[team]) {
        out[team] = { opp: home ? f.team_a : f.team_h, home, gf, ga, res, event: f.event, form: [] };
      }
      if (out[team].form.length < 5) out[team].form.unshift(res);
    }
  }
  return out;
}

// Posledný vzájomný zápas dvoch tímov: najprv tento ročník, potom minulé sezóny
export function headToHead(thisSeason, past, teamH, teamA, teams) {
  const codeH = String(teams[teamH].code);
  const codeA = String(teams[teamA].code);
  const cur = thisSeason
    .filter(
      (f) =>
        (f.finished || f.finished_provisional) && f.team_h_score != null && f.kickoff_time &&
        ((f.team_h === teamH && f.team_a === teamA) || (f.team_h === teamA && f.team_a === teamH))
    )
    .sort((a, b) => b.kickoff_time.localeCompare(a.kickoff_time))[0];
  let m = null;
  if (cur) {
    m = { hCode: String(teams[cur.team_h].code), aCode: String(teams[cur.team_a].code), hs: cur.team_h_score, ag: cur.team_a_score, where: `tento ročník, GW${cur.event}`, src: { current: true, event: cur.event, id: cur.id } };
  } else {
    const nH = String(teams[teamH].name || '').toLowerCase();
    const nA = String(teams[teamA].name || '').toLowerCase();
    const is = (code, name, c, n) => String(code) === c || (!!name && String(name).toLowerCase() === n);
    const p = past
      .filter((x) => (is(x.h, x.hn, codeH, nH) && is(x.a, x.an, codeA, nA)) || (is(x.h, x.hn, codeA, nA) && is(x.a, x.an, codeH, nH)))
      .sort((a, b) => String(b.dt).localeCompare(String(a.dt)))[0];
    if (p) {
      const homeIsH = is(p.h, p.hn, codeH, nH);
      m = { hCode: homeIsH ? codeH : codeA, aCode: homeIsH ? codeA : codeH, hs: p.hs, ag: p.ag, where: `sezóna ${p.season.replace('-', '/')}, GW${p.ev}`, src: { season: p.season, ev: p.ev, id: p.id, hn: p.hn, an: p.an } };
    }
  }
  if (!m) return null;
  const mine = m.hCode === codeH ? m.hs : m.ag; // pohľad domáceho tímu nadchádzajúceho zápasu
  const theirs = m.hCode === codeH ? m.ag : m.hs;
  m.res = mine > theirs ? 'V' : mine < theirs ? 'P' : 'R';
  return m;
}

// % použitie hráčov v zostavách členov ligy
export function leagueOwnership(players, picksLists, ownIds) {
  const n = picksLists.length || 1;
  const cnt = {};
  picksLists.forEach((ids) => ids.forEach((id) => (cnt[id] = (cnt[id] || 0) + 1)));
  const byId = new Map(players.map((p) => [p.id, p]));
  const own = new Set(ownIds);
  const top = Object.keys(cnt)
    .map(Number)
    .filter((id) => byId.has(id))
    .map((id) => ({ p: byId.get(id), pct: (cnt[id] / n) * 100, own: own.has(id) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 20);
  const mine = ownIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((p) => ({ p, pct: ((cnt[p.id] || 0) / n) * 100, own: true }))
    .sort((a, b) => a.pct - b.pct);
  return { top, mine, n };
}
