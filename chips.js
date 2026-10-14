import { scorePlayers } from './scoring';
import { lineup, buildBestSquad } from './optimizer';

const NAMES = { wildcard: 'Wildcard', freehit: 'Free Hit', bboost: 'Bench Boost', '3xc': 'Triple Captain' };

// Odporúčanie chipov na najbližších 8 kôl pre danú súpisku
export function chipAdvice(players, fixtures, startGw, squadIds, bank, metric, ctx, sell, usedChips) {
  const H = 8;
  const sc = scorePlayers(players, fixtures, startGw, H, metric, ctx);
  const squad = squadIds.map((id) => sc.find((p) => p.id === id)).filter(Boolean);
  const rows = [];
  for (let i = 0; i < H; i++) {
    const sq = squad.map((p) => ({ ...p, _g: p._gw[i] }));
    const lu = lineup(sq, '_g');
    rows.push({
      gw: startGw + i,
      bench: lu.bench.reduce((s, p) => s + p._g, 0),
      tc: lu.captain ? lu.captain._g : 0,
      tcName: lu.captain ? lu.captain.web_name : '-',
      playing: lu.starters.filter((p) => p._n[i] > 0).length,
    });
  }
  const top = (key, dir = 1) => rows.reduce((a, b) => (dir * (b[key] - a[key]) > 0 ? b : a));
  const bb = top('bench');
  const tc = top('tc');
  const fh = top('playing', -1);

  // Wildcard: zostava od nuly vs. súčasný tím na 5 kôl
  const sc5 = scorePlayers(players, fixtures, startGw, 5, metric, ctx);
  const cur = lineup(squadIds.map((id) => sc5.find((p) => p.id === id)).filter(Boolean), '_score');
  const budget = squadIds.reduce((t, id) => t + (sell[id] !== undefined ? sell[id] : 0), 0) + bank;
  const best = buildBestSquad(sc5, { metric: '_score', budget });
  const gain = best.points - cur.points;

  return {
    used: (usedChips || []).map((c) => `${NAMES[c.name] || c.name} (GW${c.event})`).join(', ') || 'zatiaľ žiadny',
    items: [
      { title: 'Bench Boost', text: `Najlepšie v GW${bb.gw}: lavička ~${bb.bench.toFixed(1)} b.` },
      { title: 'Triple Captain', text: `GW${tc.gw}: ${tc.tcName}, navyše ~${tc.tc.toFixed(1)} b.` },
      {
        title: 'Free Hit',
        text:
          fh.playing <= 8
            ? `GW${fh.gw}: zápas má len ${fh.playing} zo 11 hráčov základu. Hodí sa.`
            : 'V najbližších kolách ti nechýba veľa hráčov, zatiaľ netreba.',
      },
      {
        title: 'Wildcard',
        text: `Tím od nuly by dal ~${gain.toFixed(1)} b navyše za 5 kôl. ${
          gain >= 25 ? 'Oplatí sa zvážiť.' : 'Zatiaľ sa neoplatí.'
        }`,
      },
    ],
  };
}
