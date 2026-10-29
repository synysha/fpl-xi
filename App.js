import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, ScrollView, ActivityIndicator, TouchableOpacity,
  StyleSheet, StatusBar, Image, Animated, Modal, Platform, AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchBootstrap, fetchPicks, fetchEntry, fetchLeague, fetchLeaguePicks,
  fetchEventFixtures, fetchLive, fetchPicksFull, fetchElementSummary,
} from './api';
import { deepScores, makeCtx, topPick } from './scoring';
import { metricValue, lineup } from './optimizer';
import { leagueOwnership, eventLines, liveTotal, lastResults, headToHead } from './insights';
import { loadPrefs, savePrefs, getCache, setCache } from './storage';
import { loadH2H, loadPastMatches, loadMatchTop } from './history';

const C = {
  bg: '#f1f2f9', card: '#ffffff', border: '#e3e4f1', text: '#14143c', sub: '#7b7b9c',
  accent: '#6d3fd6', accentDark: '#ece6fb', btn: '#6d3fd6', navy: '#0d0d63',
  green: '#16a34a', greenDark: '#dcfce7', yellow: '#eab308', red: '#e11d48', input: '#f4f4fb',
};
const TABS = [
  ['analysis', 'Analýza', 'analytics'],
  ['fpl', 'FPL ligy', 'trophy'],
  ['my', 'Môj tím', 'people'],
  ['pl', 'Premier', 'football'],
  ['tips', 'Tipovanie', 'create'],
];
const POS = { 1: 'BR', 2: 'OB', 3: 'ST', 4: 'ÚT' };
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

// Podzáložky: farebné "karty" ako na ukážke. Aktívna je fialová, ostatné pastelové.
const SEG_COLORS = ['#e2dcfa', '#f6d6ec', '#f7efc4', '#d3f1de', '#d6e2fa', '#eadcf7'];
function Segment({ items, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.segment} contentContainerStyle={{ paddingRight: 8 }}>
      {items.map((it, i) => {
        const on = value === it.key;
        return (
          <TouchableOpacity
            key={it.key}
            onPress={() => onChange(it.key)}
            activeOpacity={0.8}
            style={[s.segItem, { backgroundColor: on ? C.accent : SEG_COLORS[i % SEG_COLORS.length] }, on && s.segItemOn]}
          >
            <Text style={[s.segText, on && s.segTextOn]}>{it.label}</Text>
          </TouchableOpacity>
        );
      })}
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

function PlayerBadge({ p, teams, lu, small, metric = '_score', onPlayer }) {
  const tag = lu.captain && lu.captain.id === p.id ? 'C' : lu.vice && lu.vice.id === p.id ? 'V' : '';
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={() => onPlayer && onPlayer(p)} style={s.player}>
      <View>
        <Shirt p={p} teams={teams} size={small ? 38 : 48} />
        {p.status && p.status !== 'a' ? <View style={[s.hdot, { backgroundColor: healthOf(p)[1] }]} /> : null}
        {tag ? (
          <View style={s.tag}>
            <Text style={s.tagText}>{tag}</Text>
          </View>
        ) : null}
      </View>
      <Text style={s.pName} numberOfLines={1}>{p.web_name}</Text>
      <Text style={s.pScore}>{(metric === '_score' ? metricValue(p, '_score') : parseFloat(p[metric]) || 0).toFixed(1)}</Text>
    </TouchableOpacity>
  );
}

function Pitch({ lu, teams, metric = '_score', onPlayer }) {
  return (
    <>
      <View style={s.pitch}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <View key={i} style={{ flex: 1, backgroundColor: i % 2 ? '#2e9a4b' : '#35a853' }} />
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
              <PlayerBadge key={p.id} p={p} teams={teams} lu={lu} metric={metric} onPlayer={onPlayer} />
            ))}
          </View>
        ))}
      </View>
      <Card title="Lavička">
        <View style={s.benchRow}>
          {lu.bench.map((p) => (
            <PlayerBadge key={p.id} p={p} teams={teams} lu={lu} small metric={metric} onPlayer={onPlayer} />
          ))}
        </View>
      </Card>
    </>
  );
}

function Row({ p, teams, sub, badge, badgeBg, onPress }) {
  return (
    <TouchableOpacity activeOpacity={onPress ? 0.7 : 1} onPress={onPress} style={s.row}>
      <Photo p={p} />
      <View style={{ flex: 1 }}>
        <Text style={s.rowName}>{p.web_name}</Text>
        <Text style={s.rowSub}>
          {teams[p.team].short} · £{(p.now_cost / 10).toFixed(1)}{sub ? ' · ' + sub : ''}
        </Text>
      </View>
      <Text style={s.rowPos}>{POS[p.element_type]}</Text>
      <Rating text={badge} bg={badgeBg} />
    </TouchableOpacity>
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

const RES_COLOR = { V: '#16a34a', R: '#9a9ac0', P: '#ef4565' };
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
  const [gwId, setGwId] = useState(data.nextEvent.id);
  const gw = data.events.find((e) => e.id === gwId) || data.nextEvent;
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
      <Stepper gw={gwId} setGw={setGwId} min={1} max={data.events.length} label={gw.name.replace('Gameweek', 'GW')} />
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
  if (!fx) return <ActivityIndicator style={{ marginTop: 30 }} color={C.accent} />;

  const sorted = [...fx].sort((a, b) => (a.kickoff_time || '9').localeCompare(b.kickoff_time || '9'));
  const anyLive = fx.some((f) => f.started && !f.finished && !f.finished_provisional);
  const top = [...liveEl].sort((a, b) => b.stats.total_points - a.stats.total_points).slice(0, 5);
  const my = mine ? liveTotal(mine.picks, liveEl) : null;
  return (
    <FadeIn key={ev.id}>
      <View style={s.tiles}>
        <Tile value={ev.name.replace('Gameweek', 'GW')} label={isLive ? 'aktuálne kolo' : 'minulé kolo'} color={C.accent} />
        {isLive ? (
          <Tile value={my ? String(my.total) : '-'} label="moje body" color={C.accent} />
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

function LastBest({ data, onPlayer }) {
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
  if (!lu) return <ActivityIndicator style={{ marginTop: 30 }} color={C.accent} />;
  return (
    <FadeIn key={ev.id}>
      <View style={s.tiles}>
        <Tile value={ev.name.replace('Gameweek', 'GW')} label="minulé kolo" color={C.accent} />
        <Tile value={String(lu.total)} label="body (s kapitánom)" color={C.accent} />
        <Tile value={lu.formation} label="formácia" />
      </View>
      <Pitch lu={lu} teams={data.teams} onPlayer={onPlayer} />
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
              <View key={'e' + i} style={[s.fdrChip, { backgroundColor: '#e3e4f1' }]}><Text style={s.fdrChipSub}>-</Text></View>
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

const PN = { 1: 'Brankár', 2: 'Obranca', 3: 'Stredopoliar', 4: 'Útočník' };
// Stav hráča z FPL: a = fit, d = pochybný, i = zranený, s = suspendovaný, u = nedostupný
const HEALTH = {
  a: ['Fit', '#16a34a'],
  d: ['Pochybný', '#eab308'],
  i: ['Zranený', '#e11d48'],
  s: ['Suspendovaný', '#e11d48'],
  u: ['Nedostupný', '#e11d48'],
  n: ['Mimo súpisky', '#9a9ac0'],
};
const healthOf = (p) => HEALTH[p.status] || HEALTH.a;
const newsDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : ` (${d.getDate()}. ${d.getMonth() + 1}.)`;
};
const byKick = (a, b) => (a.kickoff_time || '9').localeCompare(b.kickoff_time || '9');
const dayLabel = (d) => (d ? `${DAYS[d.getDay()]} ${d.getDate()}. ${MONTHS[d.getMonth()]}` : 'Čas bude upresnený');

function Stepper({ gw, setGw, min, max, label }) {
  return (
    <View style={s.stepper}>
      <TouchableOpacity style={s.stepBtn} disabled={gw <= min} onPress={() => setGw(gw - 1)}>
        <Ionicons name="chevron-back" size={22} color={gw <= min ? C.border : C.text} />
      </TouchableOpacity>
      <Text style={s.stepText}>{label}</Text>
      <TouchableOpacity style={s.stepBtn} disabled={gw >= max} onPress={() => setGw(gw + 1)}>
        <Ionicons name="chevron-forward" size={22} color={gw >= max ? C.border : C.text} />
      </TouchableOpacity>
    </View>
  );
}

// ---------- Štatistiky hráča (po ťuknutí na hráča)
function StatBox({ label, value }) {
  return (
    <View style={s.statBox}>
      <Text style={s.statVal}>{value}</Text>
      <Text style={s.statLbl}>{label}</Text>
    </View>
  );
}

function PlayerModal({ p, data, onClose }) {
  const [hist, setHist] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!p) return undefined;
    let stop = false;
    setHist(null);
    setErr(null);
    fetchElementSummary(p.id)
      .then((d) => { if (!stop) setHist(d.history || []); })
      .catch((e) => { if (!stop) setErr(e.message); });
    return () => { stop = true; };
  }, [p && p.id]);
  if (!p) return null;
  const n = (v) => parseFloat(v) || 0;
  const team = data.teams[p.team];
  const next = data.fixtures
    .filter((f) => f.event && f.event >= data.nextEvent.id && !f.finished && (f.team_h === p.team || f.team_a === p.team))
    .sort((a, b) => a.event - b.event || byKick(a, b))
    .slice(0, 3)
    .map((f) => {
      const home = f.team_h === p.team;
      return { opp: data.teams[home ? f.team_a : f.team_h], home, d: home ? f.team_h_difficulty : f.team_a_difficulty, ev: f.event };
    });
  const stats = [
    ['Body spolu', p.total_points], ['Ø body/zápas', p.points_per_game], ['Forma', p.form],
    ['Minúty', p.minutes], ['Góly', p.goals_scored], ['Asistencie', p.assists],
    ['Čisté konto', p.clean_sheets], ['Bonusy', p.bonus], ['xG', n(p.expected_goals).toFixed(1)],
    ['xA', n(p.expected_assists).toFixed(1)], ['Cena', `£${(p.now_cost / 10).toFixed(1)}`], ['Vybraný', `${p.selected_by_percent} %`],
  ];
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalBg}>
        <View style={s.modalCard}>
          <View style={s.modalHead}>
            <Photo p={p} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowName}>{p.first_name} {p.second_name}</Text>
              <Text style={s.rowSub}>{team.short} · {PN[p.element_type]}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <Ionicons name="close" size={22} color={C.text} />
            </TouchableOpacity>
          </View>
          <ScrollView>
            <View style={s.healthRow}>
              <View style={[s.resBadge, { backgroundColor: healthOf(p)[1], width: 'auto', paddingHorizontal: 8, height: 22 }]}>
                <Text style={s.resText}>{healthOf(p)[0]}</Text>
              </View>
              <Text style={[s.why3, { flex: 1, marginLeft: 8 }]}>
                {p.chance_of_playing_next_round != null ? `Šanca nastúpiť v ďalšom kole: ${p.chance_of_playing_next_round} %` : p.status === 'a' ? 'Bez hlásených problémov.' : 'Šanca nastúpiť: bez údaja'}
              </Text>
            </View>
            {p.news ? <Text style={s.newsText}>{p.news}{newsDate(p.news_added)}</Text> : null}
            <View style={s.statGrid}>
              {stats.map(([l, v]) => <StatBox key={l} label={l} value={String(v)} />)}
            </View>
            <Text style={s.section}>Najbližšie zápasy</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {next.length === 0 && <Text style={s.hint}>Žiadne naplánované zápasy.</Text>}
              {next.map((x, i) => (
                <View key={i} style={[s.fdrChip, { backgroundColor: FDR[x.d] }]}>
                  <Text style={[s.fdrChipOpp, x.d >= 4 && { color: '#fff' }]}>{x.opp.short}</Text>
                  <Text style={[s.fdrChipSub, x.d >= 4 && { color: '#fff' }]}>GW{x.ev} · {x.home ? 'doma' : 'vonku'}</Text>
                </View>
              ))}
            </View>
            <Text style={s.section}>Posledné zápasy</Text>
            {err ? <Text style={s.error}>{err}</Text> : null}
            {!hist && !err ? <ActivityIndicator color={C.accent} style={{ margin: 12 }} /> : null}
            {hist && hist.length === 0 ? <Text style={s.hint}>Zatiaľ bez odohraných zápasov.</Text> : null}
            {hist && hist.slice(-5).reverse().map((h, i) => {
              const opp = data.teams[h.opponent_team];
              const extra = [h.goals_scored ? `${h.goals_scored} G` : '', h.assists ? `${h.assists} A` : ''].filter(Boolean).join(' · ');
              return (
                <View key={i} style={s.histRow}>
                  <Text style={[s.why3, { flex: 1 }]}>
                    GW{h.round} · {opp ? opp.short : '?'} ({h.was_home ? 'doma' : 'vonku'}) · {h.minutes}'{extra ? ' · ' + extra : ''}
                  </Text>
                  <Rating text={`${h.total_points} b`} bg={ratingColor(h.total_points)} />
                </View>
              );
            })}
            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------- Analýza: tip na kolo (celkový + na každý post)
function TipBody({ tip, teams, onPlayer }) {
  const w = tip.why;
  return (
    <View>
      <Row p={tip.p} teams={teams} sub={`${w.home ? 'doma' : 'vonku'} proti ${w.opp}`}
        badge={`~${tip.score.toFixed(1)} b`} badgeBg={C.btn} onPress={() => onPlayer(tip.p)} />
      <Text style={s.why3}>Forma {w.form.toFixed(1)} · Ø {w.ppg.toFixed(1)} b/zápas · súper {w.opp} (náročnosť {w.d}/5)</Text>
      <Text style={s.why2}>
        {w.h2hN ? `Proti ${w.opp} minule: Ø ${w.h2hAvg.toFixed(1)} b (${w.h2hN}× nastúpil)` : `Proti ${w.opp} minule: bez údajov`}
      </Text>
    </View>
  );
}

function TipsView({ data, ctx, hh, onPlayer }) {
  const h2h = hh && hh.map;
  const gw = data.nextEvent.id;
  const overall = useMemo(() => topPick(data.players, data.fixtures, gw, ctx, h2h), [data, ctx, h2h]);
  const byPos = useMemo(
    () => [1, 2, 3, 4].map((t) => ({ t, tip: topPick(data.players, data.fixtures, gw, ctx, h2h, t) })),
    [data, ctx, h2h]
  );
  return (
    <FadeIn key="tips">
      <Text style={s.hint}>Tip spája formu, priemer bodov, náročnosť súpera a body proti tomuto súperovi v minulosti.</Text>
      {overall ? (
        <Card title="Tip na kolo">
          <TipBody tip={overall} teams={data.teams} onPlayer={onPlayer} />
        </Card>
      ) : null}
      <Card title="Tip na každý post">
        {byPos.map(({ t, tip }) =>
          tip ? (
            <View key={t} style={s.tipPos}>
              <Text style={s.tipPosTitle}>{PN[t]}</Text>
              <TipBody tip={tip} teams={data.teams} onPlayer={onPlayer} />
            </View>
          ) : null
        )}
      </Card>
    </FadeIn>
  );
}

// ---------- FPL ligy: moje ligy a tabuľky
function MyLeagues({ leagues, entryId }) {
  const [open, setOpen] = useState(null);
  const [rows, setRows] = useState({});
  const toggle = (l) => {
    if (l.league_type !== 'x') return;
    if (open === l.id) {
      setOpen(null);
      return;
    }
    setOpen(l.id);
    if (!rows[l.id]) {
      fetchLeague(l.id)
        .then((r) => setRows((m) => ({ ...m, [l.id]: r })))
        .catch((e) => setRows((m) => ({ ...m, [l.id]: { error: e.message } })));
    }
  };
  const sorted = [...leagues].sort((a, b) => (a.league_type === 'x' ? 0 : 1) - (b.league_type === 'x' ? 0 : 1));
  const me = Number(entryId);
  return (
    <FadeIn key="myleagues">
      <Text style={s.hint}>Ťukni na súkromnú ligu a uvidíš jej tabuľku.</Text>
      {sorted.map((l) => {
        const up = l.entry_rank && l.entry_last_rank && l.entry_rank < l.entry_last_rank;
        const down = l.entry_rank && l.entry_last_rank && l.entry_rank > l.entry_last_rank;
        const r = rows[l.id];
        return (
          <Card key={l.id}>
            <TouchableOpacity activeOpacity={l.league_type === 'x' ? 0.7 : 1} onPress={() => toggle(l)} style={s.lgRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowName}>{l.name}</Text>
                <Text style={s.rowSub}>{l.league_type === 'x' ? 'súkromná liga' : 'verejná liga'}</Text>
              </View>
              {up ? <Ionicons name="caret-up" size={16} color={C.green} /> : down ? <Ionicons name="caret-down" size={16} color={C.red} /> : null}
              <Rating text={l.entry_rank ? `#${l.entry_rank}` : '-'} bg={C.btn} />
            </TouchableOpacity>
            {open === l.id && (
              <View style={{ marginTop: 8 }}>
                {!r && <ActivityIndicator color={C.accent} style={{ margin: 10 }} />}
                {r && r.error ? <Text style={s.error}>{r.error}</Text> : null}
                {r && !r.error && (
                  <>
                    <View style={s.thead}>
                      <Text style={[s.th, { width: 30 }]}>#</Text>
                      <Text style={[s.th, { flex: 1 }]}>Tím</Text>
                      <Text style={[s.th, { width: 44, textAlign: 'right' }]}>Kolo</Text>
                      <Text style={[s.th, { width: 56, textAlign: 'right' }]}>Spolu</Text>
                    </View>
                    {r.slice(0, 30).map((x) => (
                      <View key={x.entry} style={[s.lgTable, x.entry === me && s.lgMe]}>
                        <Text style={[s.why3, { width: 30 }]}>{x.rank}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={s.why3} numberOfLines={1}>{x.entry_name}</Text>
                          <Text style={s.why2} numberOfLines={1}>{x.player_name}</Text>
                        </View>
                        <Text style={[s.why3, { width: 44, textAlign: 'right' }]}>{x.event_total}</Text>
                        <Text style={[s.why3, { width: 56, textAlign: 'right', fontWeight: '800' }]}>{x.total}</Text>
                      </View>
                    ))}
                  </>
                )}
              </View>
            )}
          </Card>
        );
      })}
    </FadeIn>
  );
}

// ---------- Premier League: zápasy po kolách, strelci
function MatchBrowser({ data }) {
  const [gw, setGw] = useState(data.nextEvent.id);
  const byId = useMemo(() => new Map(data.players.map((p) => [p.id, p])), [data]);
  const ev = data.events.find((e) => e.id === gw);
  const groups = useMemo(() => {
    const out = [];
    data.fixtures.filter((f) => f.event === gw).sort(byKick).forEach((f) => {
      const label = dayLabel(f.kickoff_time ? new Date(f.kickoff_time) : null);
      let g = out[out.length - 1];
      if (!g || g.label !== label) {
        g = { label, items: [] };
        out.push(g);
      }
      g.items.push(f);
    });
    return out;
  }, [data, gw]);
  return (
    <>
      <Stepper gw={gw} setGw={setGw} min={1} max={data.events.length} label={ev ? ev.name.replace('Gameweek', 'GW') : 'GW' + gw} />
      <FadeIn key={gw}>
        {groups.map((g) => (
          <Card key={g.label} title={g.label}>
            {g.items.map((f) => <PlayedRow key={f.id} f={f} data={data} byId={byId} />)}
          </Card>
        ))}
      </FadeIn>
    </>
  );
}

function Scorers({ data, onPlayer }) {
  const [kind, setKind] = useState('goals_scored');
  const list = useMemo(
    () =>
      [...data.players]
        .filter((p) => p[kind] > 0)
        .sort((a, b) => b[kind] - a[kind] || b.total_points - a.total_points)
        .slice(0, 20),
    [data, kind]
  );
  return (
    <FadeIn key={kind}>
      <Pills items={[{ key: 'goals_scored', label: 'Góly' }, { key: 'assists', label: 'Asistencie' }]} value={kind} onChange={setKind} />
      <Card>
        {list.map((p, i) => (
          <Row key={p.id} p={p} teams={data.teams} sub={`#${i + 1} · ${p.goals_scored} G · ${p.assists} A`}
            badge={String(p[kind])} badgeBg={C.btn} onPress={() => onPlayer(p)} />
        ))}
      </Card>
    </FadeIn>
  );
}

function Injuries({ data, onPlayer }) {
  const list = useMemo(
    () =>
      data.players
        .filter((p) => ['d', 'i', 's'].includes(p.status))
        .sort((a, b) => parseFloat(b.selected_by_percent) - parseFloat(a.selected_by_percent))
        .slice(0, 40),
    [data]
  );
  return (
    <FadeIn key="inj">
      <Text style={s.hint}>Zranení, pochybní a suspendovaní hráči, zoradení podľa toho, koľko manažérov ich má.</Text>
      <Card>
        {list.length === 0 && <Text style={s.hint}>Žiadne hlásené zranenia.</Text>}
        {list.map((p) => (
          <View key={p.id} style={s.injItem}>
            <Row p={p} teams={data.teams} sub={`${healthOf(p)[0]}${p.chance_of_playing_next_round != null ? ' · ' + p.chance_of_playing_next_round + ' %' : ''}`}
              badge={`${p.selected_by_percent} %`} badgeBg={healthOf(p)[1]} onPress={() => onPlayer(p)} />
            {p.news ? <Text style={s.why2}>{p.news}{newsDate(p.news_added)}</Text> : null}
          </View>
        ))}
      </Card>
    </FadeIn>
  );
}

// ---------- Tipovanie
const tipGwOf = (data) => {
  const cur = data.events.find((e) => e.is_current);
  return cur && !cur.finished ? cur.id : data.nextEvent.id;
};
const hasTip = (t) => !!t && t.h !== undefined && t.h !== '' && t.a !== undefined && t.a !== '';
const sign = (a, b) => (a > b ? 1 : a < b ? -1 : 0);
const tipPoints = (t, f) =>
  Number(t.h) === f.team_h_score && Number(t.a) === f.team_a_score
    ? 3
    : sign(Number(t.h), Number(t.a)) === sign(f.team_h_score, f.team_a_score) ? 1 : 0;

function MyTips({ data }) {
  const [gw, setGw] = useState(() => tipGwOf(data));
  const [tips, setTips] = useState(null);
  const evName = data.events.find((e) => e.id === gw);
  const stepper = (
    <Stepper gw={gw} setGw={setGw} min={1} max={data.events.length} label={evName ? evName.name.replace('Gameweek', 'GW') : 'GW' + gw} />
  );
  useEffect(() => {
    setTips(null);
    getCache('tips-' + gw).then((t) => setTips(t || {}));
  }, [gw]);
  const list = useMemo(() => data.fixtures.filter((f) => f.event === gw).sort(byKick), [data, gw]);
  if (!tips) return <>{stepper}<ActivityIndicator style={{ marginTop: 30 }} color={C.accent} /></>;
  const set = (id, side, v) => {
    const clean = v.replace(/[^0-9]/g, '').slice(0, 2);
    const next = { ...tips, [id]: { ...(tips[id] || {}), [side]: clean } };
    setTips(next);
    setCache('tips-' + gw, next);
  };
  const now = new Date();
  const done = list.filter((f) => hasTip(tips[f.id])).length;
  return (
    <FadeIn key={'mt' + gw}>
      {stepper}
      <View style={s.tiles}>
        <Tile value={'GW' + gw} label="kolo" color={C.accent} />
        <Tile value={`${done}/${list.length}`} label="natipované" />
      </View>
      <Text style={s.hint}>Tipy sa ukladajú samy. Po začiatku zápasu sa zamknú. Presný výsledok = 3 body, správny víťaz alebo remíza = 1 bod.</Text>
      <Card>
        {list.map((f) => {
          const h = data.teams[f.team_h];
          const a = data.teams[f.team_a];
          const d = f.kickoff_time ? new Date(f.kickoff_time) : null;
          const locked = f.started || (d && d <= now);
          const t = tips[f.id] || {};
          return (
            <View key={f.id} style={s.fx}>
              <View style={s.fxTop}>
                <View style={s.fxTeam}>
                  <Crest team={h} />
                  <Text style={s.fxName}>{h.short}</Text>
                </View>
                <View style={s.tipMid}>
                  <TextInput style={[s.tipInput, locked && s.tipLocked]} value={t.h || ''} editable={!locked}
                    keyboardType="number-pad" maxLength={2} selectTextOnFocus onChangeText={(v) => set(f.id, 'h', v)} />
                  <Text style={s.fxName}>:</Text>
                  <TextInput style={[s.tipInput, locked && s.tipLocked]} value={t.a || ''} editable={!locked}
                    keyboardType="number-pad" maxLength={2} selectTextOnFocus onChangeText={(v) => set(f.id, 'a', v)} />
                </View>
                <View style={[s.fxTeam, { justifyContent: 'flex-end' }]}>
                  <Text style={s.fxName}>{a.short}</Text>
                  <Crest team={a} />
                </View>
              </View>
              <Text style={[s.why2, { textAlign: 'center' }]}>
                {d ? `${DAYS[d.getDay()]} ${hhmm(d)}` : ''}{locked ? ' · zamknuté' : ''}
              </Text>
            </View>
          );
        })}
      </Card>
    </FadeIn>
  );
}

function TipCompare({ data }) {
  const maxGw = tipGwOf(data);
  const [gw, setGw] = useState(maxGw);
  const [tips, setTips] = useState(null);
  useEffect(() => {
    setTips(null);
    getCache('tips-' + gw).then((t) => setTips(t || {}));
  }, [gw]);
  const list = useMemo(() => data.fixtures.filter((f) => f.event === gw).sort(byKick), [data, gw]);
  const ev = data.events.find((e) => e.id === gw);
  let total = 0;
  let exact = 0;
  let right = 0;
  const rows = tips
    ? list.map((f) => {
        const t = tips[f.id];
        const fin = f.finished || f.finished_provisional;
        let pts = null;
        if (fin && hasTip(t)) {
          pts = tipPoints(t, f);
          total += pts;
          if (pts === 3) exact++;
          if (pts >= 1) right++;
        }
        return { f, t, fin, pts };
      })
    : [];
  return (
    <>
      <Stepper gw={gw} setGw={setGw} min={1} max={maxGw} label={ev ? ev.name.replace('Gameweek', 'GW') : 'GW' + gw} />
      {!tips ? <ActivityIndicator style={{ marginTop: 30 }} color={C.accent} /> : (
        <FadeIn key={'tc' + gw}>
          <View style={s.tiles}>
            <Tile value={String(total)} label="body za tipy" color={C.accent} />
            <Tile value={String(exact)} label="presné výsledky" />
            <Tile value={String(right)} label="správny výsledok" />
          </View>
          <Card>
            {rows.map(({ f, t, fin, pts }) => {
              const h = data.teams[f.team_h];
              const a = data.teams[f.team_a];
              const live = f.started && !fin;
              const bg = pts === 3 ? C.green : pts === 1 ? C.yellow : pts === 0 ? '#ef4565' : '#9a9ac0';
              return (
                <View key={f.id} style={s.fx}>
                  <View style={s.fxTop}>
                    <View style={s.fxTeam}>
                      <Crest team={h} />
                      <Text style={s.fxName}>{h.short}</Text>
                    </View>
                    <View style={s.fxMid}>
                      <Text style={s.score}>{f.started ? `${f.team_h_score || 0} - ${f.team_a_score || 0}` : '- : -'}</Text>
                      <Text style={[s.fxTag, live && { color: C.red }]}>{live ? 'naživo' : fin ? 'FT' : ''}</Text>
                    </View>
                    <View style={[s.fxTeam, { justifyContent: 'flex-end' }]}>
                      <Text style={s.fxName}>{a.short}</Text>
                      <Crest team={a} />
                    </View>
                  </View>
                  <View style={[s.lastRow, { justifyContent: 'center' }]}>
                    <Text style={s.why2}>{hasTip(t) ? `Tvoj tip: ${t.h} - ${t.a}` : 'Bez tipu'}</Text>
                    <View style={[s.resBadge, { backgroundColor: bg, width: 'auto', paddingHorizontal: 6, marginLeft: 8 }]}>
                      <Text style={s.resText}>{pts === null ? '–' : `${pts} b`}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </Card>
        </FadeIn>
      )}
    </>
  );
}


// Na webe SafeAreaView sám pridáva okraje (druhýkrát), preto tam použijeme obyčajný View
const Root = Platform.OS === 'web' ? View : SafeAreaView;

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('my');
  const [ana, setAna] = useState('matches');
  const [fpl, setFpl] = useState('mine');
  const [pl, setPl] = useState('matches');
  const [tipSub, setTipSub] = useState('mine');
  const [entryId, setEntryId] = useState('');
  const [editId, setEditId] = useState(false);
  const [busy, setBusy] = useState(false);
  const [teamInfo, setTeamInfo] = useState(null);
  const [hh, setHh] = useState(null);
  const [squad, setSquad] = useState(null);
  const [squadBusy, setSquadBusy] = useState(false);
  const [squadErr, setSquadErr] = useState(null);
  const [sqMetric, setSqMetric] = useState('_score');
  const [sel, setSel] = useState(null);
  const [leagues, setLeagues] = useState([]);
  const [leaguesFor, setLeaguesFor] = useState(null);
  const [leagueId, setLeagueId] = useState(null);
  const [lg, setLg] = useState(null);
  const [run, setRun] = useState(0);
  const loaded = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const lastLoad = useRef(Date.now());
  const refresh = () => {
    setRefreshing(true);
    setError(null);
    fetchBootstrap()
      .then((d) => { lastLoad.current = Date.now(); setData(d); })
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
  };
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && Date.now() - lastLoad.current > 5 * 60 * 1000) refresh();
    });
    return () => sub && sub.remove && sub.remove();
  }, []);

  useEffect(() => {
    fetchBootstrap().then(setData).catch((e) => setError(e.message));
    loadPrefs().then((p) => {
      if (p.entryId) setEntryId(String(p.entryId));
      if (p.leagueId) setLeagueId(p.leagueId);
      if (p.teamInfo) setTeamInfo(p.teamInfo);
      loaded.current = true;
    });
  }, []);
  useEffect(() => {
    if (loaded.current) savePrefs({ entryId, leagueId, teamInfo });
  }, [entryId, leagueId, teamInfo]);
  useEffect(() => {
    const id = entryId.trim();
    if (!/^\d{4,9}$/.test(id)) return undefined;
    let stop = false;
    const t = setTimeout(() => {
      fetchEntry(id)
        .then((e) => {
          if (stop || !e || !e.name) return;
          setTeamInfo({
            name: e.name,
            manager: `${e.player_first_name || ''} ${e.player_last_name || ''}`.trim(),
            gw: e.current_event, pts: e.summary_event_points, rank: e.summary_event_rank,
          });
        })
        .catch(() => {});
    }, 600);
    return () => { stop = true; clearTimeout(t); };
  }, [entryId]);
  useEffect(() => {
    if (!data) return;
    loadH2H(data.events).then(setHh).catch(() => setHh({ map: null }));
  }, [data]);

  // Zostava sa načíta sama, keď je zadané ID tímu
  useEffect(() => {
    const id = entryId.trim();
    if (!data || !/^\d{4,9}$/.test(id)) return undefined;
    let stop = false;
    const t = setTimeout(async () => {
      setSquadBusy(true);
      setSquadErr(null);
      try {
        const r = await fetchPicks(id, data.events);
        if (!stop) setSquad(r);
      } catch (e) {
        if (!stop) setSquadErr(e.message);
      }
      if (!stop) setSquadBusy(false);
    }, 700);
    return () => { stop = true; clearTimeout(t); };
  }, [entryId, data]);

  const ctx = useMemo(() => (data ? makeCtx(data.teamObjs, data.nextEvent) : null), [data]);
  const lu = useMemo(() => {
    if (!data || !ctx || !squad) return null;
    const deep = deepScores(data.players, data.fixtures, data.nextEvent.id, 1, ctx, hh && hh.map);
    const mine = squad.ids.map((id) => deep.find((p) => p.id === id)).filter(Boolean);
    return mine.length ? lineup(mine, '_score') : null;
  }, [data, ctx, squad, hh]);
  const privateLeagues = useMemo(() => leagues.filter((l) => l.league_type === 'x'), [leagues]);

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

  const loadLeagues = () =>
    guard(async () => {
      const id = needId();
      const e = await fetchEntry(id);
      const all = (e.leagues && e.leagues.classic) || [];
      setLeagues(all);
      setLeaguesFor(id);
      const priv = all.filter((l) => l.league_type === 'x');
      if (priv.length && !priv.some((l) => l.id === leagueId)) setLeagueId(priv[0].id);
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
      const lgi = privateLeagues.find((l) => l.id === leagueId);
      setLg({ ...leagueOwnership(data.players, res.picks, mine.ids), failed: res.failed, gw: mine.gw, name: lgi ? lgi.name : '' });
    });

  useEffect(() => {
    if (tab === 'fpl' && data && /^\d{4,9}$/.test(entryId.trim()) && leaguesFor !== entryId.trim() && !busy) loadLeagues();
  }, [tab, data, entryId, leaguesFor]);

  if (!data && !error) {
    return (
      <Root style={[s.root, s.center]}>
        <ActivityIndicator size="large" color={C.accent} />
        <Text style={[s.text, { marginTop: 12 }]}>Sťahujem dáta z FPL…</Text>
      </Root>
    );
  }

  const gwLabel = data ? data.nextEvent.name.replace('Gameweek', 'GW') : '';
  const dateText = new Date().toLocaleDateString('sk-SK', { weekday: 'short', day: 'numeric', month: 'short' });
  const Btn = ({ label, onPress }) => (
    <TouchableOpacity style={s.button} onPress={onPress} disabled={!data || busy}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>{label}</Text>}
    </TouchableOpacity>
  );
  const idOk = /^\d{4,9}$/.test(entryId.trim());
  const needIdMsg = <Text style={s.hint}>Najprv zadaj ID svojho tímu v záložke Môj tím.</Text>;

  return (
    <Root style={s.root}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <View style={s.logo}>
          <Ionicons name="shield-checkmark" size={26} color="#c4b5fd" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{teamInfo ? teamInfo.name : 'My FPL team'}</Text>
          {teamInfo && teamInfo.manager ? <Text style={s.headerSub}>{teamInfo.manager}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={s.gwPill}><Text style={s.gwText}>{gwLabel}</Text></View>
          <Text style={s.date}>{dateText}</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {error && <Text style={s.error}>{error}</Text>}

        {data && tab === 'my' && (
          <>
            {teamInfo && teamInfo.pts != null && (() => {
              const ev = data.events.find((x) => x.id === teamInfo.gw);
              const fmt = (n) => (n == null ? '-' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
              const cells = [
                [fmt(teamInfo.pts), 'Body v poslednom kole'],
                [fmt(teamInfo.rank), 'Tvoje poradie v kole'],
                [ev ? fmt(ev.average_entry_score) : '-', 'Priemer manažérov'],
                [ev ? fmt(ev.highest_score) : '-', 'Najvyššie skóre'],
              ];
              return (
                <View style={s.hero}>
                  {cells.map(([v, l]) => (
                    <View key={l} style={s.heroCell}>
                      <Text style={s.heroVal}>{v}</Text>
                      <Text style={s.heroLbl}>{l}</Text>
                    </View>
                  ))}
                </View>
              );
            })()}
            {(!squad || editId) && (
              <Card title="Tvoj FPL tím">
                <Text style={s.hint}>ID nájdeš v adrese fantasy.premierleague.com/entry/ID</Text>
                <TextInput style={s.input} value={entryId} onChangeText={setEntryId} keyboardType="number-pad"
                  placeholder="napr. 1234567" placeholderTextColor={C.sub} />
              </Card>
            )}
            {squadBusy && <ActivityIndicator style={{ marginTop: 20 }} color={C.accent} />}
            {squadErr ? <Text style={s.error}>{squadErr}</Text> : null}
            {lu && (
              <FadeIn key="squad">
                <Text style={s.section}>Tvoja zostava</Text>
                <Pills
                  items={[
                    { key: '_score', label: 'Očakávané' },
                    { key: 'form', label: 'Forma' },
                    { key: 'points_per_game', label: 'Ø body/zápas' },
                  ]}
                  value={sqMetric}
                  onChange={setSqMetric}
                />
                <Text style={s.hint}>
                  {sqMetric === '_score' ? 'Čísla = očakávané body v najbližšom kole.' : sqMetric === 'form' ? 'Čísla = aktuálna forma (priemer bodov z posledných zápasov).' : 'Čísla = priemer bodov na zápas v tejto sezóne.'}
                  {' '}Ťukni na hráča pre štatistiky.
                </Text>
                <Pitch lu={lu} teams={data.teams} metric={sqMetric} onPlayer={setSel} />
              </FadeIn>
            )}
            {squad ? (
              <TouchableOpacity onPress={() => setEditId(!editId)}>
                <Text style={[s.hint, { textAlign: 'center', marginTop: 12 }]}>{editId ? 'Skryť ID tímu' : 'Zmeniť ID tímu'}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}

        {data && tab === 'analysis' && (
          <>
            <Segment
              items={[{ key: 'matches', label: 'Zápasy' }, { key: 'best', label: 'Najlepšia zostava' }, { key: 'tip', label: 'Tip na kolo' }]}
              value={ana}
              onChange={setAna}
            />
            <View style={{ height: 6 }} />
            {ana === 'matches' && <FixturesView data={data} entryId={entryId} />}
            {ana === 'best' && <LastBest data={data} onPlayer={setSel} />}
            {ana === 'tip' && <TipsView data={data} ctx={ctx} hh={hh} onPlayer={setSel} />}
          </>
        )}

        {data && tab === 'fpl' && (
          <>
            <Segment
              items={[{ key: 'mine', label: 'Moje ligy' }, { key: 'use', label: 'Využitie hráčov' }]}
              value={fpl}
              onChange={setFpl}
            />
            <View style={{ height: 6 }} />
            {!idOk ? needIdMsg : fpl === 'mine' ? (
              leagues.length ? <MyLeagues leagues={leagues} entryId={entryId} /> : (
                busy ? <ActivityIndicator style={{ marginTop: 30 }} color={C.accent} /> : <Text style={s.hint}>Žiadne ligy sa nenašli.</Text>
              )
            ) : (
              <>
                {privateLeagues.length > 1 && (
                  <>
                    <Text style={s.label}>Vyber ligu</Text>
                    <Pills items={privateLeagues.map((l) => ({ key: l.id, label: l.name }))} value={leagueId} onChange={setLeagueId} />
                  </>
                )}
                {privateLeagues.length === 1 && <Text style={s.hint}>{privateLeagues[0].name}</Text>}
                {privateLeagues.length === 0 ? (
                  <Text style={s.hint}>{busy ? 'Načítavam ligy…' : 'Nemáš žiadnu súkromnú ligu.'}</Text>
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
                          badge={`${Math.round(r.pct)} %`} badgeBg={r.own ? C.btn : '#9a9ac0'} onPress={() => setSel(r.p)} />
                      ))}
                    </Card>
                    <Card title="Tvoji hráči v lige">
                      {lg.mine.map((r) => (
                        <Row key={r.p.id} p={r.p} teams={data.teams} sub={`svet ${r.p.selected_by_percent} %`}
                          badge={`${Math.round(r.pct)} %`} badgeBg={r.pct <= 20 ? '#b45309' : '#2f855a'} onPress={() => setSel(r.p)} />
                      ))}
                    </Card>
                  </FadeIn>
                )}
              </>
            )}
          </>
        )}

        {data && tab === 'pl' && (
          <>
            <Segment
              items={[{ key: 'matches', label: 'Zápasy' }, { key: 'fdr', label: 'Náročnosť' }, { key: 'scorers', label: 'Strelci' }, { key: 'injuries', label: 'Zranenia' }]}
              value={pl}
              onChange={setPl}
            />
            <View style={{ height: 6 }} />
            {pl === 'matches' && <MatchBrowser data={data} />}
            {pl === 'fdr' && <FdrTable data={data} />}
            {pl === 'scorers' && <Scorers data={data} onPlayer={setSel} />}
            {pl === 'injuries' && <Injuries data={data} onPlayer={setSel} />}
          </>
        )}

        {data && tab === 'tips' && (
          <>
            <Segment
              items={[{ key: 'mine', label: 'Moje tipy' }, { key: 'cmp', label: 'Porovnanie' }]}
              value={tipSub}
              onChange={setTipSub}
            />
            <View style={{ height: 6 }} />
            {tipSub === 'mine' ? <MyTips data={data} /> : <TipCompare data={data} />}
          </>
        )}
      </ScrollView>

      <View style={s.nav}>
        {TABS.map(([k, l, icon]) => {
          const on = tab === k;
          return (
            <TouchableOpacity key={k} style={[s.navItem, on && s.navItemOn]} onPress={() => setTab(k)}>
              <Ionicons name={on ? icon : icon + '-outline'} size={22} color={on ? C.accent : C.sub} />
              <Text style={[s.navText, on && { color: C.accent }]} numberOfLines={1}>{l}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {data && sel ? <PlayerModal p={sel} data={data} onClose={() => setSel(null)} /> : null}
    </Root>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  text: { color: C.text },
  header: { flexDirection: 'row', alignItems: 'center', padding: 14, paddingTop: Platform.OS === 'web' ? 'calc(env(safe-area-inset-top, 0px) + 26px)' : 40, paddingBottom: 14, backgroundColor: C.navy },
  logo: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#1c1c8a', borderWidth: 1, borderColor: '#4b3bd6', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  title: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  headerSub: { color: '#b9b9e6', fontSize: 12, marginTop: 1 },
  gwPill: { backgroundColor: C.accent, borderWidth: 1, borderColor: '#8b5cf6', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 3 },
  gwText: { color: '#ffffff', fontWeight: '800', fontSize: 12 },
  date: { color: '#b9b9e6', fontSize: 11, marginTop: 3 },
  segment: { flexGrow: 0, marginTop: 10, marginBottom: 2 },
  segItem: { paddingHorizontal: 16, paddingVertical: 10, marginRight: 4, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, minWidth: 90, alignItems: 'center', justifyContent: 'center' },
  segItemOn: { shadowColor: '#1a1a6e', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  segText: { color: C.text, fontWeight: '600', fontSize: 13, textAlign: 'center' },
  segTextOn: { color: '#ffffff', fontWeight: '800' },
  label: { color: C.sub, fontSize: 12, marginTop: 14, marginBottom: 6, fontWeight: '600' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  pillOn: { borderColor: C.accent, backgroundColor: C.accentDark },
  pillText: { color: C.sub, fontWeight: '600' },
  pillTextOn: { color: C.accent },
  input: { backgroundColor: C.input, color: C.text, borderRadius: 10, padding: 12, fontSize: 16, borderWidth: 1, borderColor: C.border },
  hint: { color: C.sub, fontSize: 12, marginTop: 6, marginBottom: 6 },
  button: { backgroundColor: C.btn, padding: 14, borderRadius: 14, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  error: { color: C.red, marginTop: 10 },
  section: { color: C.text, fontWeight: '800', fontSize: 16, marginTop: 18, marginBottom: 4 },
  card: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 14, marginTop: 12, shadowColor: '#1a1a6e', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2, },
  cardTitle: { color: C.text, fontWeight: '800', fontSize: 15, marginBottom: 8 },
  chipCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, borderLeftWidth: 3, borderLeftColor: C.accent, padding: 12, marginTop: 8 },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 14 },
  tile: { flex: 1, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, paddingVertical: 14, alignItems: 'center', shadowColor: '#1a1a6e', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2, },
  tileValue: { color: C.text, fontSize: 20, fontWeight: '800' },
  tileLabel: { color: C.sub, fontSize: 11, marginTop: 4, textAlign: 'center' },
  pitch: { borderRadius: 14, overflow: 'hidden', marginTop: 12, paddingVertical: 14, borderWidth: 1, borderColor: C.border },
  pitchRow: { flexDirection: 'row', justifyContent: 'space-evenly', paddingVertical: 8 },
  lineOuter: { position: 'absolute', top: 8, left: 8, right: 8, bottom: 8, borderWidth: 1.5, borderColor: '#ffffffaa' },
  lineHalf: { position: 'absolute', top: '50%', left: 8, right: 8, height: 1.5, backgroundColor: '#ffffff55' },
  lineCircle: { position: 'absolute', top: '50%', left: '50%', width: 84, height: 84, borderRadius: 42, marginTop: -42, marginLeft: -42, borderWidth: 1.5, borderColor: '#ffffff55' },
  lineBox: { position: 'absolute', left: '25%', width: '50%', height: 50, borderWidth: 1.5, borderColor: '#ffffff55' },
  benchRow: { flexDirection: 'row', justifyContent: 'space-around' },
  player: { alignItems: 'center', width: 76 },
  shirtFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff', backgroundColor: '#1e88e5' },
  shirtText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  tag: { position: 'absolute', top: -4, right: -6, backgroundColor: C.accent, borderRadius: 9, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  tagText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  pName: { color: C.text, backgroundColor: '#ffffff', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, marginTop: 3, fontSize: 11, fontWeight: '700', overflow: 'hidden', maxWidth: 74 },
  pScore: { color: '#ffffff', fontSize: 11, fontWeight: '800', marginTop: 1, backgroundColor: C.navy, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, overflow: 'hidden' },
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
  resText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  why3: { color: C.text, fontSize: 11 },
  crest: { width: 30, height: 30 },
  why2: { color: C.sub, fontSize: 11, marginTop: 4 },
  thead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 4 },
  th: { color: C.sub, fontSize: 11 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#00000000' },
  photo: { width: 34, height: 44, borderRadius: 6, marginRight: 10, backgroundColor: '#e3e4f1' },
  rowName: { color: C.text, fontWeight: '700' },
  rowSub: { color: C.sub, fontSize: 11 },
  rowPos: { color: C.sub, width: 30, fontSize: 12, fontWeight: '700' },
  dots: { flexDirection: 'row', gap: 2, width: 44, justifyContent: 'center' },
  dot: { width: 8, height: 12, borderRadius: 2 },
  rating: { minWidth: 56, paddingVertical: 5, borderRadius: 7, alignItems: 'center' },
  ratingText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  nav: { flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 6, paddingBottom: Platform.OS === 'web' ? 'calc(env(safe-area-inset-bottom, 0px) + 6px)' : 18, paddingHorizontal: 6 },
  navItem: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 10, marginHorizontal: 2 },
  navItemOn: { backgroundColor: C.accentDark, borderWidth: 1, borderColor: C.accent },
  navText: { color: C.sub, fontSize: 11, marginTop: 2, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  stepBtn: { padding: 10 },
  stepText: { color: C.text, fontWeight: '800', fontSize: 16, minWidth: 80, textAlign: 'center' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  statBox: { width: '31%', flexGrow: 1, backgroundColor: C.bg, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingVertical: 10, alignItems: 'center' },
  statVal: { color: C.text, fontWeight: '800', fontSize: 16 },
  statLbl: { color: C.sub, fontSize: 10, marginTop: 2 },
  modalBg: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '88%', borderWidth: 1, borderColor: C.border },
  modalHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  closeBtn: { padding: 8 },
  newsText: { color: C.yellow, fontSize: 12, marginTop: 6 },
  histRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  tipPos: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  tipPosTitle: { color: C.accent, fontWeight: '800', fontSize: 12, marginBottom: 2 },
  lgRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lgTable: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  lgMe: { backgroundColor: C.accentDark },
  tipMid: { width: 110, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tipInput: { width: 38, height: 38, borderRadius: 8, backgroundColor: C.input, borderWidth: 1, borderColor: C.border, color: C.text, textAlign: 'center', fontSize: 18, fontWeight: '800' },
  tipLocked: { opacity: 0.5 },
  hero: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.accent, borderRadius: 20, padding: 12, marginTop: 4 },
  heroCell: { width: '50%', paddingVertical: 10, paddingHorizontal: 8 },
  heroVal: { color: '#ffffff', fontSize: 26, fontWeight: '800' },
  heroLbl: { color: '#d9ccff', fontSize: 12, marginTop: 2 },
  refreshBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#ffffff22', alignItems: 'center', justifyContent: 'center' },
  hdot: { position: 'absolute', top: -2, left: -4, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#ffffff' },
  healthRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  injItem: { borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 6 },
});
