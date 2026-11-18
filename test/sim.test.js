// Engine invariants. Run: node test/sim.test.js
'use strict';
const assert = require('assert');
const S = require('../js/sim.js');
const M = require('../js/metrics.js');

const EPS = 1e-6;
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('  FAIL ' + name + '\n       ' + e.message);
    process.exitCode = 1;
  }
}
function sim(over) {
  return new S.Simulation(Object.assign({}, S.DEFAULTS, over));
}
function runChecked(over, onStep) {
  const s = sim(over);
  while (!s.done) {
    s.step();
    if (onStep) onStep(s);
  }
  return s.finish();
}
const inCar = (r) => r.dropoffAt - r.pickupAt;

const SCENARIOS = [
  {},
  { cabs: 10 },
  { cabs: 80 },
  { riders: 600, cabs: 40, seed: 3 },
  { maxDetour: 1.2, seed: 11 },
  { maxDetour: 2.5, poolOptIn: 100, seed: 5, pingRadius: 6 },
  { gridSize: 20, riders: 300, cabs: 15, cabSpeed: 2.5, seed: 9 },
  { pingRadius: 3, patience: 40, pickupSlip: 0 },
  { pingRadius: 200, reassign: 0, riders: 400 },
  { threatsPer10Min: 8, threatRadius: 6, threatDuration: 50, seed: 2 },
];
const THREATS = SCENARIOS[SCENARIOS.length - 1];
const cache = new Map();
function finished(over) {
  const key = JSON.stringify(over);
  if (!cache.has(key)) cache.set(key, runChecked(over));
  return cache.get(key);
}

console.log('PoolSim engine tests');

test('never more than 2 aboard, now or anywhere in a planned route', () => {
  for (const over of SCENARIOS) {
    runChecked(over, (s) => {
      for (const w of [s.pool, s.base]) {
        for (const c of w.cabs) {
          assert(c.onboard.length <= 2, 'aboard > 2');
          let load = c.onboard.length;
          for (const st of c.plan) {
            load += st.type === 'pickup' ? 1 : -1;
            assert(load <= 2 && load >= 0, `cab ${c.id} plan load ${load}`);
          }
          assert(c.plan.length <= S.MAX_PLAN_STOPS, 'plan too long');
        }
      }
    });
  }
});

test('every pool rider rides at most maxDetour x their solo estimate', () => {
  for (const over of SCENARIOS) {
    const s = finished(over);
    for (const r of s.pool.riders) {
      if (r.state !== 'done' || r.affected) continue;
      assert(inCar(r) <= s.cfg.maxDetour * r.est + EPS,
        `rider ${r.id}: ${inCar(r).toFixed(3)}s > ${s.cfg.maxDetour} x ${r.est.toFixed(3)}s`);
    }
  }
});

test('solo riders (both worlds) ride exactly their estimate and never share', () => {
  for (const over of SCENARIOS) {
    const s = finished(over);
    for (const r of s.base.riders.concat(s.pool.riders.filter((x) => !x.pool))) {
      if (r.state !== 'done' || r.affected) continue;
      assert(Math.abs(inCar(r) - r.est) < EPS, `rider ${r.id} solo ride ${inCar(r)} != ${r.est}`);
      assert(r.sharedSec < EPS && r.coRiders.length === 0, `solo rider ${r.id} shared`);
    }
    for (const c of s.base.cabs) assert(c.time.two < EPS, 'baseline cab carried 2');
  }
});

test('pickups honour the ping radius and the allowed slip', () => {
  for (const over of SCENARIOS) {
    const s = finished(over);
    const cfg = s.cfg;
    for (const w of [s.pool, s.base]) {
      for (const r of w.riders) {
        if (r.pickupAt == null || r.affected) continue;
        assert(r.pickupAt <= r.latestPickupAt + EPS, `rider ${r.id} picked up after the slip window`);
        assert(r.pickupAt - r.assignedAt <= cfg.pingRadius / cfg.cabSpeed + cfg.pickupSlip + EPS,
          `rider ${r.id} picked up from beyond the ping radius`);
        assert(r.pickupAt >= r.requestAt - EPS, `rider ${r.id} picked before request`);
        if (r.dropoffAt != null) assert(r.dropoffAt >= r.pickupAt, `rider ${r.id} dropped before pickup`);
      }
    }
  }
});

test('only unmatched riders give up, and only after their patience runs out', () => {
  for (const over of SCENARIOS) {
    const s = finished(over);
    for (const w of [s.pool, s.base]) {
      for (const r of w.riders) {
        if (r.state !== 'lost') continue;
        assert(r.pickupAt == null && r.assignedAt == null, `rider ${r.id} lost after being matched`);
        assert(r.lostAt - r.requestAt >= s.cfg.patience - EPS, `rider ${r.id} gave up early`);
      }
    }
  }
  const tight = finished({ pingRadius: 3, patience: 40, pickupSlip: 0 });
  assert(tight.base.totals.lost > 0, 'a tight radius should strand some riders');
});

test('every cab-second is idle, empty, 1 aboard or 2 aboard', () => {
  for (const over of SCENARIOS) {
    const s = finished(over);
    for (const w of [s.pool, s.base]) {
      for (const c of w.cabs) {
        const t = c.time.idle + c.time.empty + c.time.one + c.time.two;
        assert(Math.abs(t - w.t) < 1e-6, `cab ${c.id} time ${t} != ${w.t}`);
      }
    }
  }
});

test('original rules: driver pay = rate x (occupied s + X x 2-aboard s), and sums across cabs', () => {
  for (const over of SCENARIOS) {
    const s = finished(Object.assign({}, over, S.ORIGINAL_RULES));
    const X = s.cfg.driverPremium / 100;
    for (const w of [s.pool, s.base]) {
      let total = 0;
      for (const c of w.cabs) {
        const expect = s.cfg.driverRate * (c.time.one + c.time.two + X * c.time.two);
        assert(Math.abs(c.earnings - expect) < 1e-6, `cab ${c.id} pay mismatch`);
        total += c.earnings;
      }
      assert(Math.abs(total - w.totals.driverPay) < 1e-6, 'fleet pay mismatch');
    }
  }
});

test('original rules: pool riders pay (1 - Y) x standard fare, everyone else full fare', () => {
  const s = runChecked(Object.assign({ poolDiscount: 40 }, S.ORIGINAL_RULES));
  for (const w of [s.pool, s.base]) {
    for (const r of w.riders) {
      if (r.pickupAt == null) continue;
      const expect = r.fullFare * (r.pool ? 0.6 : 1);
      assert(Math.abs(r.fare - expect) < 1e-9, `rider ${r.id} fare`);
    }
  }
});

test('cabs reroute mid-ride and riders can share with more than one co-rider', () => {
  const s = finished({ riders: 600, cabs: 40, seed: 3 });
  assert(s.pool.totals.reroutes > 0, 'no mid-ride reroutes');
  const multi = s.pool.riders.filter((r) => r.coRiders.length >= 2);
  assert(multi.length > 0, 'no rider had two co-riders');
  // ...but never two at the same time: each co-rider pair overlapped one at a time.
  for (const r of multi) {
    const spans = r.coRiders.map((id) => s.pool.riders[id])
      .map((o) => [Math.max(o.pickupAt, r.pickupAt), Math.min(o.dropoffAt ?? Infinity, r.dropoffAt ?? Infinity)])
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++) assert(spans[i][0] >= spans[i - 1][1] - EPS, `rider ${r.id} had 2 co-riders at once`);
  }
});

test('re-dispatch only runs when enabled', () => {
  assert.strictEqual(finished({ pingRadius: 200, reassign: 0, riders: 400 }).pool.totals.reassigned, 0);
  // Needs free cabs to move riders to, so use default demand with no radius cap.
  assert(runChecked({ pingRadius: 200 }).base.totals.reassigned > 0, 'expected some re-dispatches');
});

test('with 0% opt-in the pool world is identical to the baseline', () => {
  const s = runChecked({ poolOptIn: 0, riders: 300 });
  assert.strictEqual(s.pool.totals.completed, s.base.totals.completed);
  assert(Math.abs(s.pool.totals.driverPay - s.base.totals.driverPay) < 1e-9);
  s.pool.riders.forEach((r, i) => assert.strictEqual(r.dropoffAt, s.base.riders[i].dropoffAt));
});

test('same seed reproduces the run exactly; another seed differs', () => {
  const a = sim({}).runToEnd(), b = sim({}).runToEnd(), c = sim({ seed: 8 }).runToEnd();
  assert.strictEqual(a.pool.totals.driverPay, b.pool.totals.driverPay);
  assert.strictEqual(a.pool.totals.completed, b.pool.totals.completed);
  assert.notStrictEqual(a.pool.totals.driverPay, c.pool.totals.driverPay);
});

test('changing the opt-in % does not move riders or cabs', () => {
  const a = S.makeScenario(S.normalizeConfig({ poolOptIn: 20 }));
  const b = S.makeScenario(S.normalizeConfig({ poolOptIn: 90 }));
  a.riders.forEach((r, i) => {
    const q = b.riders[i];
    assert(r.ox === q.ox && r.oy === q.oy && r.dx === q.dx && r.dy === q.dy && r.requestAt === q.requestAt);
  });
});

test('driver-earnings decomposition adds up to the pool-world total', () => {
  for (const over of SCENARIOS) {
    const d = M.summarize(finished(over)).drivers.steps;
    const total = d.base + d.lostToSharing + d.detourPay + d.premium + d.topup + d.fleet;
    assert(Math.abs(total - d.pool) < 1e-6, 'waterfall does not close');
  }
});

test('radius sweep: points cover the current radius and recommend one of them', () => {
  const cfg = S.normalizeConfig(S.DEFAULTS);
  const radii = M.sweepRadii(cfg);
  assert(radii.includes(cfg.pingRadius));
  const pts = radii.map((R) => M.sweepPoint(cfg, R, 1));
  assert(radii.includes(M.recommendRadius(pts, 'pool')));
  assert(pts[0].pool.lost > pts[pts.length - 1].pool.lost, 'tightest radius should lose more riders');
});

test('metrics survive degenerate runs (no riders, one cab)', () => {
  const s = M.summarize(sim({ riders: 0, cabs: 1 }).runToEnd());
  assert.strictEqual(s.pool.completed, 0);
  assert.strictEqual(s.passengers.matchRate, null);
});

// ------------------------------------------------------------ enhancements

test('all enhancements off reproduces the original prototype exactly', () => {
  const O = require('./original/sim.js');
  for (const over of SCENARIOS.filter((o) => !o.threatsPer10Min)) {
    const cfg = Object.assign({}, O.DEFAULTS, over);
    const a = new O.Simulation(cfg).runToEnd();
    const b = new S.Simulation(Object.assign({}, cfg, S.ORIGINAL_RULES)).runToEnd();
    for (const k of ['pool', 'base']) {
      for (const key of ['completed', 'lost', 'driverPay', 'revenue', 'premium', 'reroutes', 'reassigned']) {
        assert.strictEqual(b[k].totals[key], a[k].totals[key], `${k}.${key} differs for ${JSON.stringify(over)}`);
      }
      a[k].riders.forEach((r, i) => assert.strictEqual(b[k].riders[i].dropoffAt, r.dropoffAt, `rider ${i} drop-off differs`));
    }
  }
});

test('driver guarantee: no pooled trip pays less than its riders solo would have', () => {
  const orig = S.World.prototype.closeTrip;
  let checked = 0;
  S.World.prototype.closeTrip = function (cab) {
    const trip = cab.trip, before = cab.topup;
    orig.call(this, cab);
    if (trip.twoSec > EPS) {
      checked++;
      assert(trip.pay + (cab.topup - before) >= trip.soloPay - EPS, `cab ${cab.id} pooled trip short after top-up`);
    }
  };
  try {
    for (const over of SCENARIOS) runChecked(over);
  } finally {
    S.World.prototype.closeTrip = orig;
  }
  assert(checked > 50, 'too few pooled trips checked');
  // Without the guarantee, the same cities do have pooled trips that pay less.
  const off = finished(Object.assign({}, SCENARIOS[0], S.ORIGINAL_RULES));
  assert(off.pool.totals.shortTrips > 0 && off.pool.totals.topup === 0, 'expected short trips and no top-ups when off');
});

test('enhanced pay = rate x occupied s + premium + top-ups + pickup cover, and sums across cabs', () => {
  for (const over of SCENARIOS.concat([{ costPerBlock: 0.3 }])) {
    const s = finished(over);
    for (const w of [s.pool, s.base]) {
      let total = 0, topup = 0, cover = 0;
      for (const c of w.cabs) {
        const expect = s.cfg.driverRate * (c.time.one + c.time.two) + c.premium + c.topup + c.cover + c.threatPay;
        assert(Math.abs(c.earnings - expect) < 1e-6, `cab ${c.id} pay mismatch`);
        total += c.earnings;
        topup += c.topup;
        cover += c.cover;
      }
      assert(Math.abs(total - w.totals.driverPay) < 1e-6, 'fleet pay mismatch');
      assert(Math.abs(topup - w.totals.topup) < 1e-6, 'fleet top-up mismatch');
      assert(Math.abs(cover - w.totals.cover) < 1e-6, 'fleet cover mismatch');
    }
  }
});

test('dynamic premium stays in [0, 100%] and only moves when enabled', () => {
  for (const over of SCENARIOS) {
    const s = finished(over);
    for (const p of s.pool.series) assert(p.X >= 0 && p.X <= 1, `X out of range: ${p.X}`);
    if (s.pool.totals.pooledTrips) assert(s.pool.series.some((p) => p.X !== s.cfg.driverPremium / 100), 'X never moved');
    for (const p of s.base.series) assert.strictEqual(p.X, s.cfg.driverPremium / 100, 'no-pool city has no pooled trips, X fixed');
  }
  const off = finished(Object.assign({}, SCENARIOS[0], S.ORIGINAL_RULES));
  for (const p of off.pool.series) assert.strictEqual(p.X, off.cfg.driverPremium / 100);
});

test('matched discount: full Y only for riders who shared, the smaller discount otherwise', () => {
  for (const over of SCENARIOS) {
    const s = finished(over);
    const Y = s.cfg.poolDiscount / 100, U = s.cfg.unmatchedDiscount / 100;
    let revenue = 0;
    for (const w of [s.pool, s.base]) {
      revenue = 0;
      for (const r of w.riders) {
        if (r.pickupAt == null) continue;
        revenue += r.fare;
        let pct = 0;
        if (r.pool) pct = r.state === 'done' && r.sharedSec > EPS ? Y : U;
        assert(Math.abs(r.fare - r.fullFare * (1 - pct)) < 1e-9, `rider ${r.id} fare ${r.fare} vs ${r.fullFare} x ${1 - pct}`);
      }
      assert(Math.abs(revenue - w.totals.revenue) < 1e-6, 'revenue does not match fares');
    }
  }
});

test('enhancements leave riders, cabs and the opt-in draw untouched (twin cities still paired)', () => {
  const a = S.makeScenario(S.normalizeConfig(Object.assign({}, S.DEFAULTS, S.ORIGINAL_RULES)));
  const b = S.makeScenario(S.normalizeConfig(S.DEFAULTS));
  assert.deepStrictEqual(a, b);
});

test('pickup cover: no driver ever ends a job, or the run, below zero; off means losses are real', () => {
  for (const over of [{ costPerBlock: 0.3 }, { costPerBlock: 0.5, cabs: 15 }, { costPerBlock: 0.2, cabs: 60, seed: 4 }, {}]) {
    const s = runChecked(over);
    for (const w of [s.pool, s.base]) {
      for (const c of w.cabs) {
        const blocks = c.blocks.empty + c.blocks.one + c.blocks.two;
        const net = c.earnings - w.cfg.costPerBlock * blocks;
        // A job still open at P has not been settled yet: allow exactly its unsettled loss.
        const open = c.job ? Math.max(0, c.job.cost - c.job.pay) : 0;
        assert(net >= -open - 1e-6, `cab ${c.id} net ${net.toFixed(3)} below zero`);
      }
    }
  }
  const off = runChecked(Object.assign({ costPerBlock: 0.3 }, S.ORIGINAL_RULES));
  assert(off.pool.totals.lossJobs > 0 && off.pool.totals.cover === 0, 'expected uncovered losing jobs when off');
  assert(off.pool.cabs.some((c) => c.earnings - 0.3 * (c.blocks.empty + c.blocks.one + c.blocks.two) < 0), 'expected some driver below zero when off');
  // At the default running cost no job loses money, so the cover changes nothing.
  assert.strictEqual(finished({}).pool.totals.cover, 0);
});

test('pool-first: 0 restores the cheapest-wins rule; on, more pool riders share and every rule still holds', () => {
  const settings = [{ cabs: 30 }, { cabs: 60 }];
  let onShared = 0, offShared = 0;
  for (const st of settings) {
    for (const seed of [1, 2, 3]) {
      const on = runChecked(Object.assign({ seed }, st), (s) => {
        for (const c of s.pool.cabs) assert(c.onboard.length <= 2, 'aboard > 2');
      });
      const off = runChecked(Object.assign({ seed, poolFirst: 0 }, st));
      for (const [s, add] of [[on, (n) => { onShared += n; }], [off, (n) => { offShared += n; }]]) {
        add(s.pool.riders.filter((r) => r.pool && r.state === 'done' && r.sharedSec > EPS).length);
        for (const r of s.pool.riders) {
          if (r.state === 'done') assert(inCar(r) <= s.cfg.maxDetour * r.est + EPS, `rider ${r.id} over the cap`);
          if (r.pickupAt != null) assert(r.pickupAt <= r.latestPickupAt + EPS, `rider ${r.id} slipped`);
        }
      }
    }
  }
  assert(onShared > offShared, `pool-first should raise sharing (${onShared} vs ${offShared})`);
});

// ------------------------------------------------------------ bomb threats

test('cordon distance equals the true shortest path (BFS) on the grid', () => {
  const G = 16;
  const w = sim({ gridSize: G, riders: 0, cabs: 1 }).pool;
  const rnd = (n) => Math.floor(Math.random() * n);
  for (let k = 0; k < 40; k++) {
    const R = 1 + rnd(5), cx = rnd(G), cy = rnd(G);
    w.zone = { x1: Math.max(0, cx - R), x2: Math.min(G - 1, cx + R), y1: Math.max(0, cy - R), y2: Math.min(G - 1, cy + R) };
    // BFS from one free corner over free corners.
    let ax, ay;
    do { ax = rnd(G); ay = rnd(G); } while (w.inZone(ax, ay));
    const D = new Array(G * G).fill(-1), q = [[ax, ay]];
    D[ax * G + ay] = 0;
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= G || ny >= G || w.inZone(nx, ny) || D[nx * G + ny] >= 0) continue;
        D[nx * G + ny] = D[x * G + y] + 1;
        q.push([nx, ny]);
      }
    }
    for (let bx = 0; bx < G; bx++) for (let by = 0; by < G; by++) {
      if (w.inZone(bx, by)) continue;
      assert.strictEqual(w.dist(ax, ay, bx, by), D[bx * G + by], `zone ${JSON.stringify(w.zone)} (${ax},${ay})->(${bx},${by})`);
    }
  }
});

test('bomb threats: cabs never drive into a closed cordon, no stop inside it, both cities hit alike', () => {
  let sawZone = false;
  const s = sim(THREATS);
  const allowed = new WeakSet(); // cabs inside (or entering) when the cordon closed may drive out
  let lastZone = null;
  while (!s.done) {
    s.step();
    for (const w of [s.pool, s.base]) {
      const z = w.zone;
      if (!z) continue;
      sawZone = true;
      if (z !== lastZone && w === s.pool) lastZone = z;
      for (const c of w.cabs) {
        const inNow = w.inZone(c.x, c.y), nextIn = c.next && w.inZone(c.next.x, c.next.y);
        if ((inNow || nextIn) && w.t - z.at < 1.05) allowed.add(c);
        if (!allowed.has(c)) assert(!inNow && !nextIn, `cab ${c.id} entered the cordon`);
        for (const st of c.plan) assert(!w.inZone(st.x, st.y), `cab ${c.id} has a stop inside the cordon`);
      }
    }
  }
  s.finish();
  assert(sawZone, 'no threat happened');
  assert(s.pool.totals.threats > 0 && s.pool.totals.threats === s.base.totals.threats, 'both cities get the same threats');
  assert(s.pool.totals.affected > 0 && s.pool.totals.movedStops > 0, 'expected riders affected and stops moved');
  // Empty detours are rare at a 15-block ping radius (pickups are near), so use a wide one.
  const paid = [1, 2, 3].some((seed) => sim(Object.assign({}, THREATS, { seed, pingRadius: 40 })).runToEnd().pool.totals.threatPay > 0);
  assert(paid, 'drivers should be paid for empty detours around a cordon');
});

test('threats leave riders and cabs where they were, and 0 threats changes nothing', () => {
  const a = S.makeScenario(S.normalizeConfig(Object.assign({}, S.DEFAULTS, THREATS)));
  const b = S.makeScenario(S.normalizeConfig(Object.assign({}, S.DEFAULTS, THREATS, { threatsPer10Min: 0 })));
  assert.deepStrictEqual(a.riders, b.riders);
  assert.deepStrictEqual(a.cabs, b.cabs);
  assert(a.threats.length > 0 && b.threats.length === 0);
  for (let i = 1; i < a.threats.length; i++) assert(a.threats[i].at >= a.threats[i - 1].until, 'cordons overlap');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
