// Reproduces the README's results: original rules vs enhanced, same cities.
// Run: node test/compare.js   (about 15 s)
'use strict';
const S = require('../js/sim.js');
const M = require('../js/metrics.js');

const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);
const FLEETS = [15, 30, 60];
const sign = (v, d = 0) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);

console.log(`Original rules vs enhanced, ${SEEDS.length} random cities per fleet size, other settings default.\n`);
const rows = [];
for (const cabs of FLEETS) {
  const sum = { drv: 0, rid: 0, plat: 0, oLoss: 0, eLoss: 0, oShare: 0, eShare: 0, oWait: 0, eWait: 0, oDone: 0, eDone: 0 };
  const wins = { drv: 0, rid: 0 };
  for (const seed of SEEDS) {
    const cfg = Object.assign({}, S.DEFAULTS, { cabs, seed });
    const e = M.ruleStats(new S.Simulation(cfg).runToEnd());
    const o = M.ruleStats(new S.Simulation(Object.assign({}, cfg, S.ORIGINAL_RULES)).runToEnd());
    sum.drv += e.netPay - o.netPay; sum.rid += e.saved - o.saved; sum.plat += e.margin - o.margin;
    sum.oLoss += o.shortAfterTopup; sum.eLoss += e.shortAfterTopup;
    sum.oShare += o.shareRate || 0; sum.eShare += e.shareRate || 0;
    sum.oWait += o.avgWait; sum.eWait += e.avgWait; sum.oDone += o.completed; sum.eDone += e.completed;
    if (e.netPay > o.netPay) wins.drv++;
    if (e.saved > o.saved) wins.rid++;
  }
  const n = SEEDS.length, a = (k) => sum[k] / n;
  rows.push([`${cabs} cabs`,
    `${a('oLoss').toFixed(1)} → ${a('eLoss').toFixed(1)}`,
    `${sign(a('drv'))} (${wins.drv}/${n})`,
    `${sign(a('rid'))} (${wins.rid}/${n})`,
    `${(a('oShare') * 100).toFixed(0)}% → ${(a('eShare') * 100).toFixed(0)}%`,
    `${a('oWait').toFixed(1)} → ${a('eWait').toFixed(1)} s`,
    `${a('oDone').toFixed(1)} → ${a('eDone').toFixed(1)}`,
    `${sign(a('plat'))}`]);
}
const head = ['Fleet', 'Driver-loss trips', 'Drivers $ (wins)', 'Riders $ (wins)', 'Riders who share', 'Avg wait', 'Rides done', 'Platform $'];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (r) => r.map((c, i) => c.padEnd(widths[i])).join('  ');
console.log(line(head));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
rows.forEach((r) => console.log(line(r)));
console.log('\n$ columns: average change per run vs original rules. (wins) = cities where that group came out ahead.');
