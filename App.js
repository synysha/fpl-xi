import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, ScrollView, ActivityIndicator, TouchableOpacity,
  StyleSheet, StatusBar, Image, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchBootstrap, fetchPicks, fetchHistory, fetchTransfers, fetchEntry, fetchLeague, fetchLeaguePicks,
  fetchEventFixtures, fetchLive, fetchPicksFull,
} from './api';
import { deepScores, makeCtx } from './scoring';
import { suggestTransfers, metricValue } from './optimizer';
import { chipAdvice } from './chips';
import { sellPrices, priceWatch, leagueOwnership, eventLines, liveTotal, lastResults, headToHead } from './insights';
import { loadPrefs, savePrefs } from './storage';
import { loadH2H, loadPastMatches, loadMatchTop } from './history';

const C = {
  bg: '#0a1620', card: '#10222d', border: '#1c3846', text: '#e8f1f2', sub: '#7f98a3',
  green: '#22c55e', greenDark: '#0f2f20', yellow: '#eab308', red: '#ef4444', input: '#0d1d27',
};
const TABS = [
  ['my', 'Môj tím', 'people'],
  ['best', 'Najlepšia', 'football'],
  ['fixtures', 'Zápasy', 'calendar'],
  ['fdr', 'Náročnosť', 'grid'],
  ['league', 'Liga', 'trophy'],
  ['prices', 'Ceny', 'trending-up'],
];
const POS = { 1: 'BR', 2: 'OB', 3: 'ST', 4: 'ÚT' };
const later = () => new Promise((r) => setTimeout(r, 60));
const ratingColor = (v) => (v >= 8 ? '#16a34a' : v >= 5 ? '#2f855a' : v >= 3 ? '#8a7a1f' : '#7a3b3b');

function FadeIn({ children }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, []);
  const y = a.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  return <Animated.View style={{ opacity: a, transform: [{ translateY: y }] }}>{children}</Animated.View>;
}

function Pills({ items, value, onChange, render }) {
  return (
    <View style={s.pills}>
      {items.map((it) => {
        const key = it.key || it;
        const on = value === key;
        return (
          <TouchableOpacity key={key} onPress={() => onChange(key)} style={[s.pill, on && s.pillOn]}>
            <Text style={[s.pillText, on && s.pillTextOn]}>{render ? render(it) : it.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Segment({ items, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.segment}>
      {items.map((it) => (
        <TouchableOpacity key={it.key} onPress={() => onChange(it.key)} style={[s.segItem, value === it.key && s.segItemOn]}>
          <Text style={[s.segText, value === it.key && s.segTextOn]}>{it.label}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const Card = ({ title, children }) => (
  <View style={s.card}>
    {title ? <Text style={s.cardTitle}>{title}</Text> : null}
    {children}
  </View>
);

const Tile = ({ value, label, color }) => (
  <View style={s.tile}>
    <Text style={[s.tileValue, color && { color }]}>{value}</Text>
    <Text style={s.tileLabel}>{label}</Text>
  </View>
);

const Rating = ({ text, bg }) => (
  <View style={[s.rating, { backgroundColor: bg }]}>
    <Text style={s.ratingText}>{text}</Text>
  </View>
);

function FormDots({ p }) {
  const f = parseFloat(p.form) || 0;
  const n = f >= 6 ? 3 : f >= 3 ? 2 : f > 0 ? 1 : 0;
  const col = f >= 3 ? C.green : C.yellow;
  return (
    <View style={s.dots}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[s.dot, { backgroundColor: i < n ? col : '#2a3b46' }]} />
      ))}
    </View>
  );
}

function Shirt({ p, teams, size }) {
  const [fail, setFail] = useState(false);
  const team = teams[p.team];
  const uri = `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${team.code}${p.element_type === 1 ? '_1' : ''}-110.png`;
  if (fail) {
    return (
      <View style={[s.shirtFallback, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={s.shirtText}>{team.short}</Text>
      </View>
    );
  }
  return <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="contain" onError={() => setFail(true)} />;
}

function Photo({ p }) {
  const [fail, setFail] = useState(false);
  if (fail) return <View style={s.photo} />;
  const uri = `https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.code}.png`;
  return <Image source={{ uri }} style={s.photo} resizeMode="cover" onError={() => setFail(true)} />;
}

function PlayerBadge({ p, teams, lu, small }) {
  const tag = lu.captain && lu.captain.id === p.id ? 'C' : lu.vice && lu.vice.id === p.id ? 'V' : '';
  return (
    <View style={s.player}>
      <View>
        <Shirt p={p} teams={teams} size={small ? 38 : 48} />
        {tag ? (
          <View style={s.tag}>
            <Text style={s.tagText}>{tag}</Text>
          </View>
        ) : null}
      </View>
      <Text style={s.pName} numberOfLines={1}>{p.web_name}</Text>
      <Text style={s.pScore}>{metricValue(p, '_score').toFixed(1)}</Text>
    </View>
  );
}

function Pitch({ lu, teams }) {
  return (
    <>
      <View style={s.pitch}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <View key={i} style={{ flex: 1, backgroundColor: i % 2 ? '#1b6b34' : '#1e7a3a' }} />
          ))}
        </View>
        <View style={s.lineOuter} pointerEvents="none" />
        <View style={s.lineHalf} pointerEvents="none" />
        <View style={s.lineCircle} pointerEvents="none" />
        <View style={[s.lineBox, { top: 8 }]} pointerEvents="none" />
        <View style={[s.lineBox, { bottom: 8 }]} pointerEvents="none" />
        {[4, 3, 2, 1].map((t) => (
          <View key={t} style={s.pitchRow}>
            {lu.starters.filter((p) => p.element_type === t).map((p) => (
              <PlayerBadge key={p.id} p={p} teams={teams} lu={lu} />
            ))}
          </View>
        ))}
      </View>
      <Card title="Lavička">
        <View style={s.benchRow}>
          {lu.bench.map((p) => (
            <PlayerBadge key={p.id} p={p} teams={teams} lu={lu} small />
          ))}
        </View>
      </Card>
    </>
  );
}

function Row({ p, teams, sub, badge, badgeBg }) {
  return (
    <View style={s.row}>
      <Photo p={p} />
      <View style={{ flex: 1 }}>
        <Text style={s.rowName}>{p.web_name}</Text>
        <Text style={s.rowSub}>
          {teams[p.team].short} · £{(p.now_cost / 10).toFixed(1)}{sub ? ' · ' + sub : ''}
        </Text>
      </View>
      <Text style={s.rowPos}>{POS[p.element_type]}</Text>
      <Rating text={badge} bg={badgeBg} />
    </View>
  );
}

const TableHead = ({ right }) => (
  <View style={s.thead}>
    <Text style={[s.th, { flex: 1 }]}>Hráč</Text>
    <Text style={[s.th, { width: 30 }]}>Poz.</Text>
    <Text style={[s.th, { width: 44, textAlign: 'center' }]}>Forma</Text>
    <Text style={[s.th, { width: 56, textAlign: 'right' }]}>{right}</Text>
  </View>
);

function whyLines(p, mode) {
  const w = p._why;
  if (mode === 'last' || !w) return [];
  return [`${w.home ? 'doma' : 'vonku'} proti ${w.opp} · očakávané ${w.final.toFixed(1)} b`];
}

function MoveRow({ m, mode }) {
  return (
    <View style={s.moveBox}>
      <View style={s.move}>
        <Ionicons name="arrow-down-circle" size={20} color={C.red} />
        <Text style={s.mOut}>{m.out.web_name} £{(m.outPrice / 10).toFixed(1)} · {m.out._score.toFixed(1)} b</Text>
      </View>
      <View style={s.move}>
        <Ionicons name="arrow-up-circle" size={20} color={C.green} />
        <Text style={s.mIn}>{m.in.web_name} £{(m.inPrice / 10).toFixed(1)} · {m.in._score.toFixed(1)} b</Text>
      </View>
      {whyLines(m.in, mode).map((t, i) => (
        <Text key={i} style={s.why}>{t}</Text>
      ))}
    </View>
  );
}

function PlanView({ res, free, teams, mode }) {
  const fp = res.freePlan;
  const hp = res.hitPlan;
  return (
    <>
      <View style={s.tiles}>
        <Tile value={`${fp.k}/${free}`} label="transfery" />
        <Tile value={`+${fp.gain.toFixed(1)}`} label="zisk bodov" color={C.green} />
        <Tile value={hp ? '−4' : '0'} label="hit" color={hp ? C.red : C.text} />
      </View>
      <Card title={fp.k ? 'Odporúčané transfery (zadarmo)' : 'Žiadny transfer zadarmo sa neoplatí'}>
        {fp.k === 0 ? (
          <Text style={s.text}>Nechaj si voľné transfery na ďalšie kolo, žiadna výmena nepriniesla dosť bodov.</Text>
        ) : (
          fp.moves.map((m, i) => <MoveRow key={i} m={m} mode={mode} />)
        )}
      </Card>
      {hp ? (
        <Card title="Voliteľne: 1 transfer navyše za −4 b">
          <Text style={s.hint}>Po odpočítaní −4 b ostáva +{hp.net.toFixed(1)} b navyše.</Text>
          {hp.moves.map((m, i) => <MoveRow key={i} m={m} mode={mode} />)}
        </Card>
      ) : (
        <Text style={s.hint}>Transfer navyše za −4 b sa neoplatí.</Text>
      )}
    </>
  );
}

const DAYS = ['nedeľa', 'pondelok', 'utorok', 'streda', 'štvrtok', 'piatok', 'sobota'];
const MONTHS = ['januára', 'februára', 'marca', 'apríla', 'mája', 'júna', 'júla', 'augusta', 'septembra', 'októbra', 'novembra', 'decembra'];
const FDR = { 1: '#0f7a3d', 2: '#22c55e', 3: '#9aa5ab', 4: '#e0603a', 5: '#b91c1c' };
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function Crest({ team }) {
  const [fail, setFail] = useState(false);
  if (fail) return <View style={s.crest} />;
  const uri = `https://resources.premierleague.com/premierleague/badges/50/t${team.code}.png`;
  return <Image source={{ uri }} style={s.crest} resizeMode="contain" onError={() => setFail(true)} />;
}

const RES_COLOR = { V: '#16a34a', R: '#9aa5ab', P: '#b91c1c' };
function LastResult({ r, team, teams }) {
  if (!r) return null;
  const opp = teams[r.opp];
  return (
    <View style={{ marginBottom: 4 }}>
      <View style={s.lastRow}>
        <Text style={s.why2}>Forma {team.short}:  </Text>
        {r.form.map((x, i) => (
          <View key={i} style={[s.resBadge, { backgroundColor: RES_COLOR[x], marginRight: 3 }]}>
            <Text style={s.resText}>{x}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function H2H({ r, loading, shortByCode, errors, data }) {
  if (!r) {
    const err = errors && errors.length ? ' Nepodarilo sa načítať: ' + errors.join('; ') : '';
    return <Text style={[s.why2, { marginTop: 6 }]}>{loading ? 'Načítavam vzájomné zápasy…' : 'Vzájomný zápas sa nenašiel.' + err}</Text>;
  }
  return (
    <View style={{ marginTop: 6 }}>
      <View style={s.lastRow}>
        <View style={[s.resBadge, { backgroundColor: RES_COLOR[r.res] }]}>
          <Text style={s.resText}>{r.res}</Text>
        </View>
        <Text style={[s.why3, { flex: 1 }]}>
          Posledný vzájomný zápas: {shortByCode[r.hCode] || r.hCode} {r.hs}-{r.ag} {shortByCode[r.aCode] || r.aCode} ({r.where})
        </Text>
      </View>
      <H2HTop r={r} data={data} shortByCode={shortByCode} />
    </View>
  );
}

async function topFromLive(src, data) {
  const l = await fetchLive(src.event);
  const byId = new Map(data.players.map((p) => [p.id, p]));
  const out = [];
  l.elements.forEach((e) => {
    const x = (e.explain || []).find((z) => z.fixture === src.id);
    const p = byId.get(e.id);
    if (!x || !p) return;
    out.push({ name: p.web_name, pts: x.stats.reduce((a, b) => a + b.points, 0), short: data.teams[p.team].short });
  });
  return out.sort((a, b) => b.pts - a.pts).slice(0, 3);
}

function H2HTop({ r, data, shortByCode }) {
  const [list, setList] = useState(null);
  const sid = r.src ? r.src.id : null;
  useEffect(() => {
    let stop = false;
    if (!r.src) return undefined;
    const run = r.src.current ? topFromLive(r.src, data) : loadMatchTop(r.src);
    Promise.resolve(run)
      .then((l) => { if (!stop) setList(l); })
      .catch(() => { if (!stop) setList([]); });
    return () => { stop = true; };
  }, [sid]);
  if (!r.src || list === null) return null;
  if (!list.length) return <Text style={s.why2}>Body hráčov z toho zápasu sa nepodarilo načítať.</Text>;
  const txt = list
    .map((x) => `${x.name} (${x.short || (x.side === 'h' ? shortByCode[r.hCode] : x.side === 'a' ? shortByCode[r.aCode] : '?')}) ${x.pts} b`)
    .join(' · ');
  return <Text style={s.why2}>Najviac bodov: {txt}</Text>;
}

function NextRound({ data }) {
  const gw = data.nextEvent;
  const last = useMemo(() => lastResults(data.fixtures), [data]);
  const [past, setPast] = useState(null);
  useEffect(() => {
    loadPastMatches(data.events).then(setPast).catch(() => setPast({ matches: [], errors: ['chyba'] }));
  }, []);
  const shortByCode = useMemo(() => {
    const m = {};
    Object.values(data.teams).forEach((t) => (m[t.code] = t.short));
    return m;
  }, [data]);
  const top = useMemo(() => {
    const m = {};
    data.players.filter((p) => p.status === 'a').forEach((p) => {
      (m[p.team] = m[p.team] || []).push(p);
    });
    Object.keys(m).forEach((k) => {
      m[k] = m[k].sort((a, b) => parseFloat(b.ep_next) - parseFloat(a.ep_next)).slice(0, 2);
    });
    return m;
  }, [data]);
  const list = data.fixtures
    .filter((f) => f.event === gw.id)
    .sort((a, b) => (a.kickoff_time || '9').localeCompare(b.kickoff_time || '9'));
  const groups = [];
  list.forEach((f) => {
    const d = f.kickoff_time ? new Date(f.kickoff_time) : null;
    const label = d ? `${DAYS[d.getDay()]} ${d.getDate()}. ${MONTHS[d.getMonth()]}` : 'Čas bude upresnený';
    let g = groups[groups.length - 1];
    if (!g || g.label !== label) {
      g = { label, items: [] };
      groups.push(g);
    }
    g.items.push({ f, d });
  });
  const dl = gw.deadline_time ? new Date(gw.deadline_time) : null;
  const names = (id) =>
    (top[id] || []).map((p) => `${p.web_name} ${parseFloat(p.ep_next).toFixed(1)}`).join(', ');
  return (
    <FadeIn key="fixtures">
      <Text style={s.hint}>{gw.name.replace('Gameweek', 'GW')}{dl ? ` · uzávierka ${dl.getDate()}. ${dl.getMonth() + 1}. ${hhmm(dl)}` : ''}</Text>
      {groups.map((g) => (
        <Card key={g.label} title={g.label}>
          {g.items.map(({ f, d }) => {
            const h = data.teams[f.team_h];
            const a = data.teams[f.team_a];
            return (
              <View key={f.id} style={s.fx}>
                <View style={s.fxTop}>
                  <View style={s.fxTeam}>
                    <Crest team={h} />
                    <Text style={s.fxName}>{h.short}</Text>
                  </View>
                  <View style={s.fxMid}>
                    <Text style={s.fxTime}>{d ? hhmm(d) : '--:--'}</Text>
                    <View style={{ flexDirection: 'row', gap: 4, marginTop: 3 }}>
                      <View style={[s.fdr, { backgroundColor: FDR[f.team_h_difficulty] }]}><Text style={s.fdrText}>{f.team_h_difficulty}</Text></View>
                      <View style={[s.fdr, { backgroundColor: FDR[f.team_a_difficulty] }]}><Text style={s.fdrText}>{f.team_a_difficulty}</Text></View>
                    </View>
                  </View>
                  <View style={[s.fxTeam, { justifyContent: 'flex-end' }]}>
                    <Text style={s.fxName}>{a.short}</Text>
                    <Crest team={a} />
                  </View>
                </View>
                <H2H r={headToHead(data.fixtures, past ? past.matches : [], f.team_h, f.team_a, data.teams)}
                  loading={!past} shortByCode={shortByCode} errors={past ? past.errors : []} data={data} />
                <LastResult r={last[f.team_h]} team={h} teams={data.teams} />
                <LastResult r={last[f.team_a]} team={a} teams={data.teams} />
              </View>
            );
          })}
        </Card>
      ))}
    </FadeIn>
  );
}

function PlayedRow({ f, data, byId }) {
  const h = data.teams[f.team_h];
  const a = data.teams[f.team_a];
  const live = f.started && !f.finished && !f.finished_provisional;
  const done = f.finished || f.finished_provisional;
  const d = f.kickoff_time ? new Date(f.kickoff_time) : null;
  const sc = (v) => (v == null ? 0 : v);
  const lines = eventLines(f, byId, data.teams);
  return (
    <View style={s.fx}>
      <View style={s.fxTop}>
        <View style={s.fxTeam}>
          <Crest team={h} />
          <Text style={s.fxName}>{h.short}</Text>
        </View>
        <View style={s.fxMid}>
          {f.started ? (
            <>
              <Text style={s.score}>{sc(f.team_h_score)} - {sc(f.team_a_score)}</Text>
              <Text style={[s.fxTag, live && { color: C.red }]}>{live ? `${f.minutes}'` : done ? 'FT' : ''}</Text>
            </>
          ) : (
            <Text style={s.fxTime}>{d ? hhmm(d) : '--:--'}</Text>
          )}
        </View>
        <View style={[s.fxTeam, { justifyContent: 'flex-end' }]}>
          <Text style={s.fxName}>{a.short}</Text>
          <Crest team={a} />
        </View>
      </View>
      {lines.map((t, i) => (
        <Text key={i} style={s.why2}>{t}</Text>
      ))}
    </View>
  );
}

// Výsledky minulého kola alebo zápasy a body naživo (obnova každú minútu)
function PlayedView({ data, ev, isLive, entryId }) {
  const [fx, setFx] = useState(null);
  const [liveEl, setLiveEl] = useState(null);
  const [mine, setMine] = useState(null);
  const [err, setErr] = useState(null);
  const [upd, setUpd] = useState(null);
  const byId = useMemo(() => new Map(data.players.map((p) => [p.id, p])), [data]);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const [f, l] = await Promise.all([fetchEventFixtures(ev.id), fetchLive(ev.id)]);
        let m = null;
        if (isLive && entryId.trim()) m = await fetchPicksFull(entryId.trim(), ev.id);
        if (stop) return;
        setFx(f);
        setLiveEl(l.elements);
        setMine(m);
        setErr(null);
        setUpd(new Date());
      } catch (e) {
        if (!stop) setErr(e.message);
      }
    };
    load();
    const t = isLive ? setInterval(load, 60000) : null;
    return () => {
      stop = true;
      if (t) clearInterval(t);
    };
  }, [ev.id, isLive, entryId]);

  if (err && !fx) return <Text style={s.error}>{err}</Text>;
  if (!fx) return <ActivityIndicator style={{ marginTop: 30 }} color={C.green} />;

  const sorted = [...fx].sort((a, b) => (a.kickoff_time || '9').localeCompare(b.kickoff_time || '9'));
  const anyLive = fx.some((f) => f.started && !f.finished && !f.finished_provisional);
  const top = [...liveEl].sort((a, b) => b.stats.total_points - a.stats.total_points).slice(0, 5);
  const my = mine ? liveTotal(mine.picks, liveEl) : null;
  return (
    <FadeIn key={ev.id}>
      <View style={s.tiles}>
        <Tile value={ev.name.replace('Gameweek', 'GW')} label={isLive ? 'aktuálne kolo' : 'minulé kolo'} color={C.green} />
        {isLive ? (
          <Tile value={my ? String(my.total) : '-'} label="moje body" color={C.green} />
        ) : (
          <Tile value={ev.average_entry_score != null ? String(ev.average_entry_score) : '-'} label="priemer" />
        )}
      </View>
      {isLive && (
        <Text style={s.hint}>
          {anyLive ? 'Obnovuje sa každú minútu.' : 'Práve nebeží žiadny zápas.'}
          {upd ? ` Aktualizované ${hhmm(upd)}.` : ''}
          {err ? ` (${err})` : ''}
        </Text>
      )}
      {isLive && !entryId.trim() && <Text style={s.hint}>Zadaj ID tímu v záložke Môj tím a uvidíš aj svoje body naživo.</Text>}
      {my && (
        <Card title="Moje body naživo">
          <Text style={s.hint}>Body bez automatických striedaní. Bonusy sa pripočítajú po skončení zápasu.</Text>
          {my.rows.map((r) => {
            const p = byId.get(r.element);
            if (!p) return null;
            return (
              <Row key={r.element} p={p} teams={data.teams} sub={r.cap ? 'kapitán' : r.vice ? 'vice' : null}
                badge={String(r.pts)} badgeBg={ratingColor(r.pts / Math.max(r.mult, 1))} />
            );
          })}
        </Card>
      )}
      <Card title="Zápasy">
        {sorted.map((f) => (
          <PlayedRow key={f.id} f={f} data={data} byId={byId} />
        ))}
      </Card>
    </FadeIn>
  );
}

function lastFinishedEvent(data) {
  const cur = data.events.find((e) => e.is_current);
  return cur && cur.finished ? cur : data.events.find((e) => e.id === (cur ? cur.id - 1 : data.nextEvent.id - 1));
}

// Najlepšia možná zostava kola podľa skutočných bodov (bez rozpočtu), platná formácia
function bestOfRound(players, live) {
  const pts = new Map(live.map((e) => [e.id, e.stats.total_points]));
  const all = players.map((p) => ({ ...p, _score: pts.get(p.id) || 0 }));
  const by = (t) => all.filter((p) => p.element_type === t).sort((a, b) => b._score - a._score);
  const gk = by(1), df = by(2), md = by(3), fw = by(4);
  const sum = (arr, n) => arr.slice(0, n).reduce((x, p) => x + p._score, 0);
  let best = null;
  for (let d = 3; d <= 5; d++) {
    for (let m = 2; m <= 5; m++) {
      const f = 10 - d - m;
      if (f < 1 || f > 3) continue;
      const v = sum(df, d) + sum(md, m) + sum(fw, f);
      if (!best || v > best.v) best = { d, m, f, v };
    }
  }
  const starters = [gk[0], ...df.slice(0, best.d), ...md.slice(0, best.m), ...fw.slice(0, best.f)];
  const rest = [...df.slice(best.d), ...md.slice(best.m), ...fw.slice(best.f)].sort((a, b) => b._score - a._score);
  const bench = [gk[1], ...rest.slice(0, 3)];
  const ranked = [...starters].sort((a, b) => b._score - a._score);
  return {
    starters, bench, captain: ranked[0], vice: ranked[1],
    total: starters.reduce((x, p) => x + p._score, 0) + ranked[0]._score,
    formation: `${best.d}-${best.m}-${best.f}`,
  };
}

function LastBest({ data }) {
  const ev = useMemo(() => lastFinishedEvent(data), [data]);
  const [live, setLive] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!ev) return;
    fetchLive(ev.id).then((l) => setLive(l.elements)).catch((e) => setErr(e.message));
  }, [ev && ev.id]);
  const lu = useMemo(() => (live ? bestOfRound(data.players, live) : null), [live, data]);
  if (!ev) return <Text style={s.hint}>Zatiaľ nebolo odohrané žiadne kolo.</Text>;
  if (err) return <Text style={s.error}>{err}</Text>;
  if (!lu) return <ActivityIndicator style={{ marginTop: 30 }} color={C.green} />;
  return (
    <FadeIn key={ev.id}>
      <View style={s.tiles}>
        <Tile value={ev.name.replace('Gameweek', 'GW')} label="minulé kolo" color={C.green} />
        <Tile value={String(lu.total)} label="body (s kapitánom)" color={C.green} />
        <Tile value={lu.formation} label="formácia" />
      </View>
      <Pitch lu={lu} teams={data.teams} />
    </FadeIn>
  );
}

function FdrTable({ data }) {
  const rows = useMemo(() => {
    const gw = data.nextEvent.id;
    const up = data.fixtures
      .filter((f) => !f.finished && !f.finished_provisional && f.event && f.event >= gw)
      .sort((a, b) => a.event - b.event || (a.kickoff_time || '').localeCompare(b.kickoff_time || ''));
    return Object.entries(data.teams)
      .map(([key, t]) => {
        const id = Number(key);
        const list = [];
        for (const f of up) {
          if (list.length >= 3) break;
          if (f.team_h === id) list.push({ opp: data.teams[f.team_a], home: true, d: f.team_h_difficulty });
          else if (f.team_a === id) list.push({ opp: data.teams[f.team_h], home: false, d: f.team_a_difficulty });
        }
        const avg = list.length ? list.reduce((x, y) => x + y.d, 0) / list.length : 9;
        return { t, list, avg };
      })
      .sort((a, b) => a.avg - b.avg);
  }, [data]);
  return (
    <FadeIn key="fdr">
      <Text style={s.hint}>Najbližšie 3 zápasy každého tímu. Zelená = ľahký súper, červená = ťažký. Hore sú tímy s najľahším rozpisom.</Text>
      <Card>
        {rows.map(({ t, list, avg }) => (
          <View key={t.short} style={s.fdrRow}>
            <View style={s.fdrTeam}>
              <Crest team={t} />
              <Text style={s.fxName}>{t.short}</Text>
            </View>
            {list.map((x, i) => (
              <View key={i} style={[s.fdrChip, { backgroundColor: FDR[x.d] }]}>
                <Text style={[s.fdrChipOpp, x.d >= 4 && { color: '#fff' }]}>{x.opp.short}</Text>
                <Text style={[s.fdrChipSub, x.d >= 4 && { color: '#fff' }]}>{x.home ? 'doma' : 'vonku'}</Text>
              </View>
            ))}
            {Array.from({ length: 3 - list.length }).map((_, i) => (
              <View key={'e' + i} style={[s.fdrChip, { backgroundColor: '#1c3846' }]}><Text style={s.fdrChipSub}>-</Text></View>
            ))}
            <Text style={s.fdrAvg}>{list.length ? avg.toFixed(1) : '-'}</Text>
          </View>
        ))}
      </Card>
    </FadeIn>
  );
}

function FixturesView({ data, entryId }) {
  const [view, setView] = useState('next');
  const cur = data.events.find((e) => e.is_current);
  const last = cur && cur.finished ? cur : data.events.find((e) => e.id === (cur ? cur.id - 1 : data.nextEvent.id - 1));
  return (
    <>
      <Segment
        items={[{ key: 'next', label: 'Nadchádzajúce kolo' }, { key: 'last', label: 'Minulé kolo' }, { key: 'live', label: 'Naživo' }]}
        value={view}
        onChange={setView}
      />
      <View style={{ height: 6 }} />
      {view === 'next' && <NextRound data={data} />}
      {view === 'last' && (last ? <PlayedView key={'l' + last.id} data={data} ev={last} isLive={false} entryId={entryId} /> : <Text style={s.hint}>Zatiaľ nebolo odohrané žiadne kolo.</Text>)}
      {view === 'live' && (cur ? <PlayedView key={'v' + cur.id} data={data} ev={cur} isLive entryId={entryId} /> : <Text style={s.hint}>Sezóna ešte nezačala.</Text>)}
    </>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('my');
  const [metric, setMetric] = useState('ep_next');
  const [horizon, setHorizon] = useState(1);
  const [entryId, setEntryId] = useState('');
  const [free, setFree] = useState(1);
  const [busy, setBusy] = useState(false);
  const [tr, setTr] = useState(null);
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState(null);
  const [lg, setLg] = useState(null);
  const [advice, setAdvice] = useState(null);
  const [mode, setMode] = useState('next');
  const [h2hInfo, setH2hInfo] = useState(null);
  const h2hRef = useRef(null);
  const [own, setOwn] = useState([]);
  const [run, setRun] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    fetchBootstrap().then(setData).catch((e) => setError(e.message));
    loadPrefs().then((p) => {
      if (p.entryId) setEntryId(String(p.entryId));
      if (p.free) setFree(p.free);
      if (p.leagueId) setLeagueId(p.leagueId);
      loaded.current = true;
    });
  }, []);
  useEffect(() => {
    if (loaded.current) savePrefs({ entryId, free, leagueId });
  }, [entryId, free, leagueId]);

  const ctx = useMemo(() => (data ? makeCtx(data.teamObjs, data.nextEvent) : null), [data]);
  const watch = useMemo(() => (data ? priceWatch(data.players, own) : null), [data, own]);

  const guard = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setRun((r) => r + 1);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };
  const needId = () => {
    if (!entryId.trim()) throw new Error('Zadaj ID svojho FPL tímu.');
    return entryId.trim();
  };

  const runMy = () =>
    guard(async () => {
      const id = needId();
      const [picks, hist, trs] = await Promise.all([
        fetchPicks(id, data.events), fetchHistory(id), fetchTransfers(id),
      ]);
      if (!h2hRef.current) h2hRef.current = await loadH2H(data.events);
      const hh = h2hRef.current;
      setH2hInfo(
        hh.map
          ? `Zohľadnené: výkony proti súperom v sezóne ${hh.season}.`
          : `Dáta z minulej sezóny sa nepodarilo načítať (${hh.error}), analýza ich nezohľadnila.`
      );
      await later();
      const sell = sellPrices(data.players, picks.ids, trs);
      setOwn(picks.ids);
      const deep = deepScores(data.players, data.fixtures, data.nextEvent.id, horizon, ctx, hh.map);
      const lastRound = data.players.map((p) => ({ ...p, _score: p.event_points || 0 }));
      const next = suggestTransfers(deep, picks.ids, picks.bank, free, '_score', sell);
      await later();
      const last = suggestTransfers(lastRound, picks.ids, picks.bank, free, '_score', sell);
      setTr({ next, last, free });
      await later();
      setAdvice(chipAdvice(data.players, data.fixtures, data.nextEvent.id, picks.ids, picks.bank, 'model', ctx, sell, hist.chips));
    });

  const loadLeagues = () =>
    guard(async () => {
      const e = await fetchEntry(needId());
      const list = (e.leagues.classic || []).filter((l) => l.league_type === 'x');
      setLeagues(list);
      if (list.length && !list.some((l) => l.id === leagueId)) setLeagueId(list[0].id);
      if (!list.length) throw new Error('Nemáš žiadnu súkromnú ligu.');
    });

  const runLeague = () =>
    guard(async () => {
      const id = needId();
      let mine;
      let rows;
      try { mine = await fetchPicks(id, data.events); } catch (e) { throw new Error('Tvoja zostava: ' + e.message); }
      try { rows = await fetchLeague(leagueId); } catch (e) { throw new Error('Tabuľka ligy: ' + e.message); }
      const res = await fetchLeaguePicks(rows.map((r) => r.entry), mine.gw);
      if (!res.picks.length) throw new Error('Zostavy členov ligy sa nepodarilo načítať.');
      setOwn(mine.ids);
      const lgi = leagues.find((l) => l.id === leagueId);
      setLg({ ...leagueOwnership(data.players, res.picks, mine.ids), failed: res.failed, gw: mine.gw, name: lgi ? lgi.name : '' });
    });

  useEffect(() => {
    if (tab === 'league' && data && entryId.trim() && leagues.length === 0 && !busy) loadLeagues();
  }, [tab, data]);

  if (!data && !error) {
    return (
      <SafeAreaView style={[s.root, s.center]}>
        <ActivityIndicator size="large" color={C.green} />
        <Text style={[s.text, { marginTop: 12 }]}>Sťahujem dáta z FPL…</Text>
      </SafeAreaView>
    );
  }

  const gwLabel = data ? data.nextEvent.name.replace('Gameweek', 'GW') : '';
  const dateText = new Date().toLocaleDateString('sk-SK', { weekday: 'short', day: 'numeric', month: 'short' });
  const Btn = ({ label, onPress }) => (
    <TouchableOpacity style={s.button} onPress={onPress} disabled={!data || busy}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>{label}</Text>}
    </TouchableOpacity>
  );
  const IdBox = () => (
    <Card title="Tvoj FPL tím">
      <Text style={s.hint}>ID nájdeš v adrese fantasy.premierleague.com/entry/ID</Text>
      <TextInput style={s.input} value={entryId} onChangeText={setEntryId} keyboardType="number-pad"
        placeholder="napr. 1234567" placeholderTextColor={C.sub} />
    </Card>
  );
  const formation = (lu) => [2, 3, 4].map((t) => lu.starters.filter((p) => p.element_type === t).length).join('-');

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <View style={s.logo}>
          <Ionicons name="shield-checkmark" size={26} color={C.green} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>My FPL team</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={s.gwPill}><Text style={s.gwText}>{gwLabel}</Text></View>
          <Text style={s.date}>{dateText}</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {error && <Text style={s.error}>{error}</Text>}

        {tab === 'best' && data && <LastBest data={data} />}

        {tab === 'my' && (
          <>
            <IdBox />
            <Text style={s.label}>Voľné transfery</Text>
            <Pills items={[1, 2, 3, 4, 5]} value={free} onChange={setFree} render={(n) => String(n)} />
            <Btn label="Načítať tím a analyzovať transfery" onPress={runMy} />
            {tr && (
              <FadeIn key={run}>
                <PlanView res={tr.next} free={tr.free} teams={data.teams} mode="next" />
                {advice && (
                  <>
                    <Text style={s.section}>Chipy (najbližších 8 kôl)</Text>
                    {advice.items.map((c) => (
                      <View key={c.title} style={s.chipCard}>
                        <Text style={s.cardTitle}>{c.title}</Text>
                        <Text style={s.text}>{c.text}</Text>
                      </View>
                    ))}
                  </>
                )}
              </FadeIn>
            )}
          </>
        )}

        {tab === 'fixtures' && data && <FixturesView data={data} entryId={entryId} />}

        {tab === 'fdr' && data && <FdrTable data={data} />}

        {tab === 'league' && (
          !entryId.trim() ? (
            <Text style={s.hint}>Najprv zadaj ID svojho tímu v záložke Môj tím.</Text>
          ) : (
            <>
              {leagues.length > 1 && (
                <>
                  <Text style={s.label}>Vyber ligu</Text>
                  <Pills items={leagues.map((l) => ({ key: l.id, label: l.name }))} value={leagueId} onChange={setLeagueId} />
                </>
              )}
              {leagues.length === 1 && <Text style={s.hint}>{leagues[0].name}</Text>}
              {leagues.length === 0 ? (
                <Btn label="Načítať moje ligy" onPress={loadLeagues} />
              ) : (
                <Btn label="Porovnať používanie hráčov v lige" onPress={runLeague} />
              )}
              {lg && (
                <FadeIn key={run}>
                  <Text style={s.hint}>
                    {lg.name} · {lg.n} manažérov · GW{lg.gw}{lg.failed ? ` (${lg.failed} sa nenačítalo)` : ''}
                  </Text>
                  <Card title="Najpoužívanejší v lige">
                    {lg.top.map((r) => (
                      <Row key={r.p.id} p={r.p} teams={data.teams}
                        sub={`svet ${r.p.selected_by_percent} %${r.own ? ' · máš ho' : ''}`}
                        badge={`${Math.round(r.pct)} %`} badgeBg={r.own ? '#16a34a' : '#3b5566'} />
                    ))}
                  </Card>
                  <Card title="Tvoji hráči v lige">
                    {lg.mine.map((r) => (
                      <Row key={r.p.id} p={r.p} teams={data.teams} sub={`svet ${r.p.selected_by_percent} %`}
                        badge={`${Math.round(r.pct)} %`} badgeBg={r.pct <= 20 ? '#b45309' : '#2f855a'} />
                    ))}
                  </Card>
                </FadeIn>
              )}
            </>
          )
        )}

        {tab === 'prices' && watch && (
          <FadeIn key="prices">
            <Card title="Možný rast ceny">
              {watch.up.slice(0, 6).map((r) => (
                <Row key={r.p.id} p={r.p} teams={data.teams} sub={r.own ? 'máš ho' : null}
                  badge={`+${Math.round(r.net / 1000)}k`} badgeBg="#16a34a" />
              ))}
            </Card>
            <Card title="Možný pokles ceny">
              {watch.down.slice(0, 6).map((r) => (
                <Row key={r.p.id} p={r.p} teams={data.teams} sub={r.own ? 'máš ho' : null}
                  badge={`${Math.round(r.net / 1000)}k`} badgeBg="#b91c1c" />
              ))}
            </Card>
          </FadeIn>
        )}

      </ScrollView>

      <View style={s.nav}>
        {TABS.map(([k, l, icon]) => {
          const on = tab === k;
          return (
            <TouchableOpacity key={k} style={[s.navItem, on && s.navItemOn]} onPress={() => setTab(k)}>
              <Ionicons name={on ? icon : icon + '-outline'} size={22} color={on ? C.green : C.sub} />
              <Text style={[s.navText, on && { color: C.green }]}>{l}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  text: { color: C.text },
  header: { flexDirection: 'row', alignItems: 'center', padding: 14, paddingTop: 40, borderBottomWidth: 1, borderBottomColor: C.border },
  logo: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.greenDark, borderWidth: 1, borderColor: C.green, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  title: { color: C.text, fontSize: 20, fontWeight: '800' },
  headerSub: { color: C.sub, fontSize: 12, marginTop: 1 },
  gwPill: { backgroundColor: C.greenDark, borderWidth: 1, borderColor: C.green, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 3 },
  gwText: { color: C.green, fontWeight: '800', fontSize: 12 },
  date: { color: C.sub, fontSize: 11, marginTop: 3 },
  segment: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: C.border },
  segItem: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  segItemOn: { borderBottomColor: C.green },
  segText: { color: C.sub, fontWeight: '600' },
  segTextOn: { color: C.green },
  label: { color: C.sub, fontSize: 12, marginTop: 14, marginBottom: 6, fontWeight: '600' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  pillOn: { borderColor: C.green, backgroundColor: C.greenDark },
  pillText: { color: C.sub, fontWeight: '600' },
  pillTextOn: { color: C.green },
  input: { backgroundColor: C.input, color: C.text, borderRadius: 10, padding: 12, fontSize: 16, borderWidth: 1, borderColor: C.border },
  hint: { color: C.sub, fontSize: 12, marginTop: 6, marginBottom: 6 },
  button: { backgroundColor: '#16a34a', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  error: { color: C.red, marginTop: 10 },
  section: { color: C.text, fontWeight: '800', fontSize: 16, marginTop: 18, marginBottom: 4 },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 12, marginTop: 12 },
  cardTitle: { color: C.text, fontWeight: '800', fontSize: 15, marginBottom: 8 },
  chipCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, borderLeftWidth: 3, borderLeftColor: C.green, padding: 12, marginTop: 8 },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 14 },
  tile: { flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingVertical: 14, alignItems: 'center' },
  tileValue: { color: C.text, fontSize: 20, fontWeight: '800' },
  tileLabel: { color: C.sub, fontSize: 11, marginTop: 4, textAlign: 'center' },
  pitch: { borderRadius: 14, overflow: 'hidden', marginTop: 12, paddingVertical: 14, borderWidth: 1, borderColor: C.border },
  pitchRow: { flexDirection: 'row', justifyContent: 'space-evenly', paddingVertical: 8 },
  lineOuter: { position: 'absolute', top: 8, left: 8, right: 8, bottom: 8, borderWidth: 1.5, borderColor: '#ffffff55' },
  lineHalf: { position: 'absolute', top: '50%', left: 8, right: 8, height: 1.5, backgroundColor: '#ffffff55' },
  lineCircle: { position: 'absolute', top: '50%', left: '50%', width: 84, height: 84, borderRadius: 42, marginTop: -42, marginLeft: -42, borderWidth: 1.5, borderColor: '#ffffff55' },
  lineBox: { position: 'absolute', left: '25%', width: '50%', height: 50, borderWidth: 1.5, borderColor: '#ffffff55' },
  benchRow: { flexDirection: 'row', justifyContent: 'space-around' },
  player: { alignItems: 'center', width: 76 },
  shirtFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff', backgroundColor: '#1e88e5' },
  shirtText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  tag: { position: 'absolute', top: -4, right: -6, backgroundColor: C.green, borderRadius: 9, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  tagText: { color: '#04210f', fontSize: 10, fontWeight: '900' },
  pName: { color: '#fff', backgroundColor: '#0a1620cc', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, marginTop: 3, fontSize: 11, fontWeight: '700', overflow: 'hidden', maxWidth: 74 },
  pScore: { color: C.green, fontSize: 11, fontWeight: '800', marginTop: 1, backgroundColor: '#0a1620aa', paddingHorizontal: 5, borderRadius: 4, overflow: 'hidden' },
  move: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 6 },
  moveOut: { flex: 1, color: C.red, fontWeight: '700' },
  moveIn: { flex: 1, color: C.green, fontWeight: '700', textAlign: 'right' },
  moveBox: { borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 8 },
  mOut: { flex: 1, color: C.red, fontWeight: '700' },
  mIn: { flex: 1, color: C.green, fontWeight: '700' },
  why: { color: C.sub, fontSize: 11, marginLeft: 26, marginTop: 1 },
  fx: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  fxTop: { flexDirection: 'row', alignItems: 'center' },
  fxTeam: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  fxName: { color: C.text, fontWeight: '800', fontSize: 15 },
  fxMid: { width: 84, alignItems: 'center' },
  fxTime: { color: C.text, fontWeight: '700' },
  fdr: { width: 22, height: 18, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  fdrRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border, gap: 6 },
  fdrTeam: { width: 72, flexDirection: 'row', alignItems: 'center', gap: 6 },
  fdrChip: { flex: 1, borderRadius: 8, paddingVertical: 4, alignItems: 'center' },
  fdrChipOpp: { color: '#04210f', fontWeight: '900', fontSize: 13 },
  fdrChipSub: { color: '#04210f', fontSize: 9, fontWeight: '700' },
  fdrAvg: { width: 30, textAlign: 'right', color: C.text, fontWeight: '800' },
  fdrText: { color: '#04210f', fontSize: 11, fontWeight: '900' },
  score: { color: C.text, fontWeight: '800', fontSize: 18 },
  fxTag: { color: C.sub, fontSize: 11, fontWeight: '700', marginTop: 2 },
  lastRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3, marginBottom: 2 },
  resBadge: { width: 18, height: 18, borderRadius: 4, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  resText: { color: '#04210f', fontSize: 11, fontWeight: '900' },
  why3: { color: C.text, fontSize: 11 },
  crest: { width: 30, height: 30 },
  why2: { color: C.sub, fontSize: 11, marginTop: 4 },
  thead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 4 },
  th: { color: C.sub, fontSize: 11 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#14293500' },
  photo: { width: 34, height: 44, borderRadius: 6, marginRight: 10, backgroundColor: '#1c3846' },
  rowName: { color: C.text, fontWeight: '700' },
  rowSub: { color: C.sub, fontSize: 11 },
  rowPos: { color: C.sub, width: 30, fontSize: 12, fontWeight: '700' },
  dots: { flexDirection: 'row', gap: 2, width: 44, justifyContent: 'center' },
  dot: { width: 8, height: 12, borderRadius: 2 },
  rating: { minWidth: 56, paddingVertical: 5, borderRadius: 7, alignItems: 'center' },
  ratingText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  nav: { flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 6, paddingBottom: 18, paddingHorizontal: 6 },
  navItem: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 10, marginHorizontal: 2 },
  navItemOn: { backgroundColor: C.greenDark, borderWidth: 1, borderColor: C.green },
  navText: { color: C.sub, fontSize: 11, marginTop: 2, fontWeight: '600' },
});
