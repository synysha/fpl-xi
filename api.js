// Načítanie dát z oficiálneho FPL API
import { Platform } from 'react-native';
import { WEB_PROXY } from './config';

// Mobil (Expo Go) ide priamo na FPL. Web ide cez Cloudflare Worker, lebo prehliadač blokuje cudzie stránky (CORS).
const BASE = Platform.OS === 'web'
  ? WEB_PROXY.replace(/\/$/, '') + '/'
  : 'https://fantasy.premierleague.com/api/';

async function get(path) {
  const res = await fetch(BASE + path);
  if (res.status === 404) throw new Error(`Nenašlo sa (${path.split('?')[0]}). Skontroluj ID tímu / ligy.`);
  if (!res.ok) throw new Error('FPL API vrátilo chybu ' + res.status);
  return res.json();
}

export async function fetchBootstrap() {
  const [data, fixtures] = await Promise.all([get('bootstrap-static/'), get('fixtures/')]);
  const teams = {};
  data.teams.forEach((t) => (teams[t.id] = { short: t.short_name, code: t.code }));
  const nextEvent =
    data.events.find((e) => e.is_next) ||
    data.events.find((e) => e.is_current) ||
    data.events[0];
  return { players: data.elements, teams, teamObjs: data.teams, events: data.events, nextEvent, fixtures };
}

// Súpiska a rezerva (bank) z posledného kola
export async function fetchPicks(entryId, events) {
  const cur = events.find((e) => e.is_current);
  const next = events.find((e) => e.is_next);
  const gw = Math.max(cur ? cur.id : next ? next.id - 1 : 1, 1);
  const d = await get(`entry/${entryId}/event/${gw}/picks/`);
  return { ids: d.picks.map((p) => p.element), bank: d.entry_history.bank, gw };
}

export const fetchHistory = (id) => get(`entry/${id}/history/`); // použité chipy
export const fetchTransfers = (id) => get(`entry/${id}/transfers/`); // nákupné ceny
export const fetchEntry = (id) => get(`entry/${id}/`); // ligy tímu

export async function fetchLeague(leagueId) {
  const d = await get(`leagues-classic/${leagueId}/standings/?page_standings=1`);
  return d.standings.results;
}

// Zostavy všetkých členov ligy (po dávkach, aby API nepreťažili)
export async function fetchLeaguePicks(entryIds, gw) {
  const picks = [];
  let failed = 0;
  for (let i = 0; i < entryIds.length; i += 8) {
    const chunk = entryIds.slice(i, i + 8);
    const res = await Promise.all(chunk.map((id) => get(`entry/${id}/event/${gw}/picks/`).catch(() => null)));
    res.forEach((r) => {
      if (r) picks.push(r.picks.map((p) => p.element));
      else failed++;
    });
  }
  return { picks, failed };
}

export async function fetchRivalPicks(entryIds, gw) {
  const res = await Promise.all(
    entryIds.map((id) => get(`entry/${id}/event/${gw}/picks/`).catch(() => null))
  );
  return res.filter(Boolean).map((r) => r.picks.map((p) => p.element));
}

// Zápasy a body naživo
export const fetchEventFixtures = (eventId) => get(`fixtures/?event=${eventId}`);
export const fetchLive = (eventId) => get(`event/${eventId}/live/`);
export const fetchPicksFull = (entryId, eventId) => get(`entry/${entryId}/event/${eventId}/picks/`);

// Štatistiky hráča (história zápasov)
export const fetchElementSummary = (id) => get(`element-summary/${id}/`);
