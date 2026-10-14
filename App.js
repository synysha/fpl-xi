import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, ScrollView, ActivityIndicator, TouchableOpacity,
  StyleSheet, StatusBar, Image, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchBootstrap, fetchPicks, fetchHistory, fetchTransfers, fetchEntry, fetchLeague, fetchRivalPicks,
  fetchEventFixtures, fetchLive, fetchPicksFull,
} from './api';
import { scorePlayers, deepScores, makeCtx } from './scoring';
import { buildBestSquad, suggestTransfers, metricValue } from './optimizer';
import { chipAdvice } from './chips';
import { sellPrices, priceWatch, leagueDiff, eventLines, liveTotal, lastResults, headToHead } from './insights';
import { loadPrefs, savePrefs } from './storage';
import { loadH2H, loadPastMatches } from './history';

const C = {
  bg: '#0a1620', card: '#10222d', border: '#1c3846', text: '#e8f1f2', sub: '#7f98a3',
  green: '#22c55e', greenDark: '#0f2f20', yellow: '#eab308', red: '#ef4444', input: '#0d1d27',
};
const METRICS = [
  { key: 'ep_next', label: 'Očak. body' },
  { key: 'model', label: 'Vlastný model' },
  { key: 'form', label: 'Forma' },
  { key: 'points_per_game', label: 'Body/zápas' },
];
const TABS = [
  ['best', 'Zostava', 'football'],
  ['my', 'Môj tím', 'people'],
  ['fixtures', 'Zápasy', 'calendar'],
  ['prices', 'Ceny', 'trending-up'],
  ['league', 'Liga', 'trophy'],
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
      <FormDots p={p} />
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
  if (mode === 'last') return [`Minulé kolo: ${p.event_points || 0} b`];
  const w = p._why;
  if (!w) return ['V nasledujúcom kole nehrá.'];
  const lines = [`Ø ${w.ppg.toFixed(1)} b/zápas · ${w.home ? 'doma' : 'vonku'} proti ${w.opp} (FDR ${w.d})`];
  lines.push(
    w.h2hN
      ? `Min. sezóna proti ${w.opp}: Ø ${w.h2hAvg.toFixed(1)} b (${w.h2hN}× nastúpil)`
      : `Min. sezóna proti ${w.opp}: bez údajov`
  );
  lines.push(`Očakávané: ${w.final.toFixed(1)} b (model ${w.model.toFixed(1)}${w.ep != null ? `, FPL ${w.ep.toFixed(1)}` : ''})`);
  return lines;
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
        <Tile value={`${fp.k}/${free}`} label="použité voľné transfery" />
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
          <Text style={s.hint}>
            Celý plán má {hp.moves.length} transfery. Po odpočítaní −4 b ostáva +{hp.net.toFixed(1)} b oproti plánu zadarmo.
          </Text>
          {hp.moves.map((m, i) => <MoveRow key={i} m={m} mode={mode} />)}
        </Card>
      ) : (
        <Text style={s.hint}>Transfer navyše za −4 b sa neoplatí.</Text>
      )}
      <Text style={s.section}>Zostava po odporúčaní</Text>
      <Pitch lu={fp.after} teams={teams} />
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
        <View style={[s.resBadge, { backgroundColor: RES_COLOR[r.res] }]}>
          <Text style={s.resText}>{r.res}</Text>
        </View>
        <Text style={s.why3}>
          {team.short} naposledy: {r.gf}-{r.ga} proti {opp ? opp.short : '?'} ({r.home ? 'doma' : 'vonku'}, GW{r.event})
        </Text>
      </View>
      <View style={s.lastRow}>
        <Text style={s.why2}>Forma (5 zápasov):  </Text>
        {r.form.map((x, i) => (
          <View key={i} style={[s.resBadge, { backgroundColor: RES_COLOR[x], marginRight: 3 }]}>
            <Text style={s.resText}>{x}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function H2H({ r, loading, shortByCode }) {
  if (!r) {
    return <Text style={[s.why2, { marginTop: 6 }]}>{loading ? 'Načítavam vzájomné zápasy…' : 'Vzájomný zápas: v posledných dvoch sezónach nehrali.'}</Text>;
  }
  return (
    <View style={[s.lastRow, { marginTop: 6 }]}>
      <View style={[s.resBadge, { backgroundColor: RES_COLOR[r.res] }]}>
        <Text style={s.resText}>{r.res}</Text>
      </View>
      <Text style={[s.why3, { flex: 1 }]}>
        Posledný vzájomný zápas: {shortByCode[r.hCode] || r.hCode} {r.hs}-{r.ag} {shortByCode[r.aCode] || r.aCode} ({r.where})
      </Text>
    </View>
  );
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
      <View style={s.tiles}>
        <Tile value={gw.name.replace('Gameweek', 'GW')} label="nadchádzajúce kolo" color={C.green} />
        <Tile value={String(list.length)} label="zápasov" />
        <Tile value={dl ? `${dl.getDate()}. ${dl.getMonth() + 1}.` : '-'} label={dl ? `uzávierka ${hhmm(dl)}` : 'uzávierka'} />
      </View>
      <Text style={s.hint}>Farba pri tíme je náročnosť súpera (FDR): zelená = ľahký, červená = ťažký. Dole sú najlepší hráči podľa očakávaných bodov FPL.</Text>
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
                  loading={!past} shortByCode={shortByCode} />
                <Text style={s.why2}>{h.short}: {names(f.team_h) || '-'}</Text>
                <LastResult r={last[f.team_h]} team={h} teams={data.teams} />
                <Text style={s.why2}>{a.short}: {names(f.team_a) || '-'}</Text>
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
        <Tile value={ev.name.replace('Gameweek', 'GW')} label={isLive ? (anyLive ? 'prebieha' : 'aktuálne kolo') : 'minulé kolo'} color={C.green} />
        {isLive ? (
          <Tile value={my ? String(my.total) : '-'} label="moje body naživo" color={C.green} />
        ) : (
          <Tile value={ev.average_entry_score != null ? String(ev.average_entry_score) : '-'} label="priemer manažérov" />
        )}
        {isLive ? (
          <Tile value={String(fx.filter((f) => f.finished || f.finished_provisional).length) + '/' + fx.length} label="odohraných zápasov" />
        ) : (
          <Tile value={ev.highest_score != null ? String(ev.highest_score) : '-'} label="najvyššie skóre" />
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
      <Card title="Najlepší hráči kola">
        {top.map((e) => {
          const p = byId.get(e.id);
          return p ? (
            <Row key={e.id} p={p} teams={data.teams} badge={`${e.stats.total_points} b`} badgeBg={ratingColor(e.stats.total_points)} />
          ) : null;
        })}
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
  const [tab, setTab] = useState('best');
  const [metric, setMetric] = useState('ep_next');
  const [horizon, setHorizon] = useState(1);
  const [entryId, setEntryId] = useState('');
  const [free, setFree] = useState(1);
  const [busy, setBusy] = useState(false);
  const [best, setBest] = useState(null);
  const [tr, setTr] = useState(null);
  const [advice, setAdvice] = useState(null);
  const [mode, setMode] = useState('next');
  const [h2hInfo, setH2hInfo] = useState(null);
  const h2hRef = useRef(null);
  const [own, setOwn] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState(null);
  const [lg, setLg] = useState(null);
  const [run, setRun] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    fetchBootstrap().then(setData).catch((e) => setError(e.message));
    loadPrefs().then((p) => {
      if (p.entryId) setEntryId(String(p.entryId));
      if (p.metric) setMetric(p.metric);
      if (p.horizon) setHorizon(p.horizon);
      if (p.free) setFree(p.free);
      if (p.leagueId) setLeagueId(p.leagueId);
      loaded.current = true;
    });
  }, []);
  useEffect(() => {
    if (loaded.current) savePrefs({ entryId, metric, horizon, free, leagueId });
  }, [entryId, metric, horizon, free, leagueId]);

  const ctx = useMemo(() => (data ? makeCtx(data.teamObjs, data.nextEvent) : null), [data]);
  const scored = () => scorePlayers(data.players, data.fixtures, data.nextEvent.id, horizon, metric, ctx);
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

  const runBest = () =>
    guard(async () => {
      await later();
      setBest(buildBestSquad(scored(), { metric: '_score' }));
    });

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
      const [picks, rows] = await Promise.all([fetchPicks(id, data.events), fetchLeague(leagueId)]);
      const rivals = rows.filter((r) => String(r.entry) !== id).slice(0, 10).map((r) => r.entry);
      const rp = await fetchRivalPicks(rivals, picks.gw);
      setOwn(picks.ids);
      setLg(leagueDiff(scored(), picks.ids, rp));
    });

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
          <Text style={s.headerSub}>Tvoj asistent pre Fantasy Premier League</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={s.gwPill}><Text style={s.gwText}>{gwLabel}</Text></View>
          <Text style={s.date}>{dateText}</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {(tab === 'best' || tab === 'my' || tab === 'league') && (
          <>
            {tab !== 'my' && <Segment items={METRICS} value={metric} onChange={setMetric} />}
            <Text style={s.label}>{tab === 'my' ? 'Analyzovať kolá dopredu' : 'Horizont predikcie (s náročnosťou súperov)'}</Text>
            <Pills items={[1, 3, 5]} value={horizon} onChange={setHorizon}
              render={(h) => (h === 1 ? '1 kolo' : h + ' kolá')} />
          </>
        )}
        {error && <Text style={s.error}>{error}</Text>}

        {tab === 'best' && (
          <>
            <Btn label="Vytvoriť najlepšiu zostavu" onPress={runBest} />
            {best && (
              <FadeIn key={run}>
                <View style={s.tiles}>
                  <Tile value={`£${best.cost.toFixed(1)}m`} label="cena súpisky" />
                  <Tile value={best.points.toFixed(1)} label="body s kapitánom" color={C.green} />
                  <Tile value={formation(best)} label="formácia" />
                </View>
                <Pitch lu={best} teams={data.teams} />
                <Card title="Najlepší hráči">
                  {[...best.starters].sort((a, b) => b._score - a._score).slice(0, 3).map((p) => (
                    <Row key={p.id} p={p} teams={data.teams}
                      badge={p._score.toFixed(1)} badgeBg={ratingColor(p._score)} />
                  ))}
                </Card>
              </FadeIn>
            )}
          </>
        )}

        {tab === 'my' && (
          <>
            <IdBox />
            <Text style={s.label}>Voľné transfery</Text>
            <Pills items={[1, 2, 3, 4, 5]} value={free} onChange={setFree} render={(n) => String(n)} />
            <Btn label="Načítať tím a analyzovať transfery" onPress={runMy} />
            {tr && (
              <FadeIn key={run}>
                <View style={{ height: 12 }} />
                <Segment
                  items={[{ key: 'next', label: 'Podľa budúceho kola' }, { key: 'last', label: 'Podľa minulého kola' }]}
                  value={mode}
                  onChange={setMode}
                />
                {mode === 'next' && h2hInfo ? <Text style={s.hint}>{h2hInfo}</Text> : null}
                {mode === 'last' && <Text style={s.hint}>Rozhodujú len body z posledného kola. Je to menej spoľahlivé ako analýza budúceho kola.</Text>}
                <PlanView res={tr[mode]} free={tr.free} teams={data.teams} mode={mode} />
                {advice && (
                  <>
                    <Text style={s.section}>Chipy (najbližších 8 kôl)</Text>
                    <Text style={s.hint}>Už použité: {advice.used}</Text>
                    {advice.items.map((c) => (
                      <View key={c.title} style={s.chipCard}>
                        <Text style={s.cardTitle}>{c.title}</Text>
                        <Text style={s.text}>{c.text}</Text>
                      </View>
                    ))}
                    <Text style={s.hint}>Dostupnosť chipov over v oficiálnej appke FPL.</Text>
                  </>
                )}
                <Text style={s.hint}>Predajné ceny sú počítané z histórie tvojich transferov.</Text>
              </FadeIn>
            )}
          </>
        )}

        {tab === 'fixtures' && data && <FixturesView data={data} entryId={entryId} />}

        {tab === 'prices' && watch && (
          <FadeIn key="prices">
            <Text style={s.hint}>Odhad podľa čistých transferov v tomto kole. Skutočné prahy FPL nie sú známe.</Text>
            <Card title="Možný rast ceny">
              <TableHead right="Net" />
              {watch.up.map((r) => (
                <Row key={r.p.id} p={r.p} teams={data.teams} sub={r.own ? 'máš ho' : null}
                  badge={`+${Math.round(r.net / 1000)}k`} badgeBg="#16a34a" />
              ))}
            </Card>
            <Card title="Možný pokles ceny">
              <TableHead right="Net" />
              {watch.down.map((r) => (
                <Row key={r.p.id} p={r.p} teams={data.teams} sub={r.own ? 'máš ho' : null}
                  badge={`${Math.round(r.net / 1000)}k`} badgeBg="#b91c1c" />
              ))}
            </Card>
          </FadeIn>
        )}

        {tab === 'league' && (
          <>
            <IdBox />
            <Btn label="Načítať moje ligy" onPress={loadLeagues} />
            {leagues.length > 0 && (
              <>
                <Text style={s.label}>Vyber ligu</Text>
                <Pills items={leagues} value={leagueId} onChange={setLeagueId} render={(l) => l.name} />
                <Btn label="Porovnať s top 10 rivalmi" onPress={runLeague} />
              </>
            )}
            {lg && (
              <FadeIn key={run}>
                <Card title="Tvoje rozdielové voľby (rivali ≤ 20 %)">
                  <TableHead right="Rivali" />
                  {lg.diff.length === 0 && <Text style={s.text}>Nemáš žiadnu výraznú rozdielovú voľbu.</Text>}
                  {lg.diff.map((r) => (
                    <Row key={r.p.id} p={r.p} teams={data.teams} badge={`${Math.round(r.pct)} %`} badgeBg="#2f855a" />
                  ))}
                </Card>
                <Card title="Čo ti chýba (rivali ≥ 50 %)">
                  <TableHead right="Rivali" />
                  {lg.missing.length === 0 && <Text style={s.text}>Máš všetkých hlavných hráčov.</Text>}
                  {lg.missing.map((r) => (
                    <Row key={r.p.id} p={r.p} teams={data.teams} badge={`${Math.round(r.pct)} %`} badgeBg="#b45309" />
                  ))}
                </Card>
                <Text style={s.hint}>Porovnanie s {lg.n} rivalmi na čele ligy.</Text>
              </FadeIn>
            )}
          </>
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
