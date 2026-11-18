/*
 * PoolSim metrics — turns the twin worlds into the end-of-run comparison,
 * and runs the ping-radius sweep. Pure functions; shared by the browser
 * report and the Node tests.
 *
 * Bases used
 *  - Passenger time and money: riders whose trip is complete at time P.
 *  - Door-to-door deltas: riders complete in BOTH worlds (paired by id).
 *  - Driver earnings, time use, distance and platform margin: everything
 *    accrued by time P (pay accrues per second; fares are charged at pickup).
 */
// Wrapped in a named factory so app.js can also boot it inside a Web Worker.
function definePoolMetrics(root) {
  'use strict';

  var Sim = typeof module !== 'undefined' && module.exports ? require('./sim.js') : root.PoolSim;
  var EPS = 1e-6;

  function sum(arr, f) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += f ? f(arr[i]) : arr[i];
    return s;
  }
  function mean(arr, f) { return arr.length ? sum(arr, f) / arr.length : null; }
  function inCar(r) { return r.dropoffAt - r.pickupAt; }
  function wait(r) { return r.pickupAt - r.requestAt; }
  function doorToDoor(r) { return r.dropoffAt - r.requestAt; }
  function pickedUp(r) { return r.state === 'riding' || r.state === 'done'; }

  function histogram(values, lo, hi, width) {
    var n = Math.max(1, Math.ceil((hi - lo) / width - EPS));
    var bins = [];
    for (var i = 0; i < n; i++) bins.push({ lo: lo + i * width, hi: lo + (i + 1) * width, matched: 0, unmatched: 0 });
    values.forEach(function (v) {
      var idx = Math.min(n - 1, Math.max(0, Math.floor((v.ratio - lo) / width + EPS)));
      bins[idx][v.matched ? 'matched' : 'unmatched']++;
    });
    return bins;
  }

  function owed(c) { return c.job ? Math.max(0, c.job.cost - c.job.pay) : 0; }

  function worldStats(w) {
    var cfg = w.cfg, cabs = w.cabs;
    var picked = w.riders.filter(pickedUp);
    var done = w.riders.filter(function (r) { return r.state === 'done'; });
    var time = {
      idle: sum(cabs, function (c) { return c.time.idle; }),
      empty: sum(cabs, function (c) { return c.time.empty; }),
      one: sum(cabs, function (c) { return c.time.one; }),
      two: sum(cabs, function (c) { return c.time.two; }),
    };
    var timeTotal = time.idle + time.empty + time.one + time.two;
    var engaged = time.empty + time.one + time.two;
    var blocks = {
      empty: sum(cabs, function (c) { return c.blocks.empty; }),
      one: sum(cabs, function (c) { return c.blocks.one; }),
      two: sum(cabs, function (c) { return c.blocks.two; }),
    };
    var blocksTotal = blocks.empty + blocks.one + blocks.two;
    var riderBlocks = sum(done, function (r) { return r.direct; });
    var runningCost = cfg.costPerBlock * blocksTotal;
    return {
      requested: w.totals.requested,
      completed: w.totals.completed,
      lost: w.totals.lost,
      inProgress: w.totals.pickedUp - w.totals.completed,
      stillWaiting: w.totals.requested - w.totals.pickedUp - w.totals.lost,
      avgWait: mean(picked, wait),
      driverPay: w.totals.driverPay,
      premium: w.totals.premium,
      revenue: w.totals.revenue,
      discount: w.totals.discount,
      margin: w.totals.revenue - w.totals.driverPay,
      reroutes: w.totals.reroutes,
      reassigned: w.totals.reassigned,
      time: time,
      timeTotal: timeTotal,
      engagedShare: timeTotal > 0 ? engaged / timeTotal : 0,
      idleShare: timeTotal > 0 ? time.idle / timeTotal : 0,
      payPerEngagedMin: engaged > 0 ? w.totals.driverPay / (engaged / 60) : null,
      blocks: blocks,
      blocksTotal: blocksTotal,
      blocksPerDriver: blocksTotal / cabs.length,
      emptyPerPickup: w.totals.pickedUp ? blocks.empty / w.totals.pickedUp : null,
      riderBlocks: riderBlocks,
      // Rider-blocks delivered per cab-block driven: > 1 only if pooling saves driving.
      efficiency: blocksTotal > 0 ? riderBlocks / blocksTotal : null,
      runningCost: runningCost,
      netPay: w.totals.driverPay - runningCost,
      // Enhancements
      pooledTrips: w.totals.pooledTrips,
      shortTrips: w.totals.shortTrips,
      shortfall: w.totals.shortfall,
      topup: w.totals.topup,
      topupTrips: w.totals.topupTrips,
      refunds: w.totals.refunds,
      jobs: w.totals.jobs,
      lossJobs: w.totals.lossJobs,
      jobLoss: w.totals.jobLoss,
      cover: w.totals.cover,
      // Cover already owed on jobs still in progress at P (paid when they end).
      coverOwed: cfg.netFloor ? sum(cabs, owed) : 0,
      driversBelowZero: cabs.filter(function (c) {
        var net = c.earnings - cfg.costPerBlock * (c.blocks.empty + c.blocks.one + c.blocks.two);
        return net + (cfg.netFloor ? owed(c) : 0) < -EPS;
      }).length,
      finalX: w.X,
      // Premium actually paid per 2-aboard second, as a share of the base rate.
      avgX: time.two > EPS ? w.totals.premium / (cfg.driverRate * time.two) : null,
      perDriver: cabs.map(function (c) {
        return {
          id: c.id, earnings: c.earnings,
          net: c.earnings - cfg.costPerBlock * (c.blocks.empty + c.blocks.one + c.blocks.two),
          time: c.time, blocks: c.blocks,
        };
      }),
    };
  }

  function twinDeltas(pairs) {
    if (!pairs.length) return { n: 0 };
    return {
      n: pairs.length,
      wait: mean(pairs, function (p) { return wait(p[0]) - wait(p[1]); }),
      ride: mean(pairs, function (p) { return inCar(p[0]) - inCar(p[1]); }),
      total: mean(pairs, function (p) { return doorToDoor(p[0]) - doorToDoor(p[1]); }),
      later: pairs.filter(function (p) { return doorToDoor(p[0]) > doorToDoor(p[1]) + EPS; }).length / pairs.length,
    };
  }

  function summarize(sim) {
    var cfg = sim.cfg;
    var P = sim.pool, B = sim.base;
    var rate = cfg.driverRate;
    var X = cfg.driverPremium / 100;
    var cap = cfg.maxDetour;

    var pw = worldStats(P);
    var bw = worldStats(B);

    // ---- pool riders (pool world, completed)
    var poolDone = P.riders.filter(function (r) { return r.pool && r.state === 'done'; });
    var matched = poolDone.filter(function (r) { return r.sharedSec > EPS; });
    var unmatched = poolDone.filter(function (r) { return r.sharedSec <= EPS; });
    var ratioOf = function (r) { return inCar(r) / r.est; };
    var ratios = poolDone.map(function (r) { return { ratio: ratioOf(r), matched: r.sharedSec > EPS }; });
    var saved = sum(poolDone, function (r) { return r.fullFare - r.fare; });
    var extraSec = sum(poolDone, function (r) { return inCar(r) - r.est; });
    var maxRatio = ratios.length ? Math.max.apply(null, ratios.map(function (v) { return v.ratio; })) : null;
    var withinCap = ratios.length
      ? ratios.filter(function (v) { return v.ratio <= cap + EPS; }).length / ratios.length
      : null;

    // How many different people each pool rider shared with over one trip.
    var coCounts = [0, 0, 0, 0];
    poolDone.forEach(function (r) { coCounts[Math.min(3, r.coRiders.length)]++; });
    var rerouted = poolDone.filter(function (r) { return r.reroutes > 0; });

    // Who absorbs the detour: the rider already aboard, or the one who joins?
    var hosts = matched.filter(function (r) { return r.hosted && !r.joinedOccupied; });
    var joiners = matched.filter(function (r) { return r.joinedOccupied && !r.hosted; });

    // ---- twin comparison (riders complete in both worlds)
    var poolPairs = [], soloPairs = [];
    for (var i = 0; i < P.riders.length; i++) {
      var p = P.riders[i], b = B.riders[i];
      if (p.state !== 'done' || b.state !== 'done') continue;
      (p.optIn ? poolPairs : soloPairs).push([p, b]);
    }
    var poolTwin = twinDeltas(poolPairs);
    var soloTwin = twinDeltas(soloPairs);
    poolTwin.beyondCap = poolPairs.length
      ? poolPairs.filter(function (q) { return doorToDoor(q[0]) > cap * doorToDoor(q[1]) + EPS; }).length / poolPairs.length
      : null;

    // ---- driver earnings decomposition (pool world minus no-pool world)
    // For the completed pool riders, compare what the driver was paid with what
    // the same riders would have paid the driver riding solo (rate x estimate):
    //   detour seconds are paid (+), a shared second is paid once not twice (-),
    //   and the premium is paid on that shared second (+X).
    // Whatever remains is the fleet effect: more or fewer rides fitted into P.
    var pairShared = sum(poolDone, function (r) { return r.sharedSec; }) / 2;
    var lostToSharing = -rate * pairShared;
    var detourPay = rate * extraSec;
    // With a dynamic premium, use the X actually paid on average.
    var xPaid = pw.avgX != null ? pw.avgX : X;
    var premiumPart = rate * xPaid * pairShared;
    var topupPart = pw.topup;
    var deltaPay = pw.driverPay - bw.driverPay;
    var fleetEffect = deltaPay - (lostToSharing + detourPay + premiumPart + topupPart);
    var breakEvenX = pairShared > EPS ? 1 - extraSec / pairShared : null;

    var optInsRequested = P.riders.filter(function (r) { return r.pool && r.state !== 'scheduled'; }).length;

    return {
      cfg: cfg,
      t: P.t,
      pool: pw,
      base: bw,
      passengers: {
        optInsRequested: optInsRequested,
        poolCompleted: poolDone.length,
        matched: matched.length,
        unmatched: unmatched.length,
        matchRate: poolDone.length ? matched.length / poolDone.length : null,
        saved: saved,
        savedPerRider: poolDone.length ? saved / poolDone.length : null,
        leaked: sum(unmatched, function (r) { return r.fullFare - r.fare; }),
        extraSec: extraSec,
        detourBlocks: extraSec * cfg.cabSpeed,
        avgExtraSec: poolDone.length ? extraSec / poolDone.length : null,
        avgExtraPct: mean(ratios, function (v) { return v.ratio - 1; }),
        maxRatio: maxRatio,
        withinCap: withinCap,
        dollarsPerExtraMinute: extraSec > EPS ? saved / (extraSec / 60) : null,
        histogram: histogram(ratios, 1, Math.max(cap, maxRatio || 1), Math.max(0.05, (cap - 1) / 10)),
        coCounts: coCounts,
        multiCo: coCounts[2] + coCounts[3],
        reroutedShare: poolDone.length ? rerouted.length / poolDone.length : null,
        maxReroutes: poolDone.length ? Math.max.apply(null, poolDone.map(function (r) { return r.reroutes; })) : 0,
        hostRatio: mean(hosts, ratioOf),
        joinerRatio: mean(joiners, ratioOf),
        hosts: hosts.length,
        joiners: joiners.length,
      },
      twin: { pool: poolTwin, solo: soloTwin },
      drivers: {
        delta: deltaPay,
        deltaPct: bw.driverPay > EPS ? deltaPay / bw.driverPay : null,
        perDriver: deltaPay / cfg.cabs,
        netDelta: pw.netPay - bw.netPay,
        premium: pw.premium,
        pairShared: pairShared,
        steps: {
          base: bw.driverPay,
          lostToSharing: lostToSharing,
          detourPay: detourPay,
          premium: premiumPart,
          topup: topupPart,
          fleet: fleetEffect,
          pool: pw.driverPay,
        },
        breakEvenX: breakEvenX,
      },
      series: { pool: P.series, base: B.series },
      rules: ruleStats(sim),
      original: originalRules(sim),
    };
  }

  // ---------------------------------------------------------------- enhancements

  function anyEnhancement(cfg) {
    return !!(cfg.driverGuarantee || cfg.dynamicPremium || cfg.matchedDiscount || cfg.poolFirst || cfg.netFloor);
  }

  // The before/after numbers for one rule set, from its pool and no-pool worlds.
  function ruleStats(sim) {
    var P = sim.pool, B = sim.base, pw = worldStats(P), bw = worldStats(B);
    var worse = 0, worseBy = 0;
    pw.perDriver.forEach(function (d, i) {
      var gap = d.net - bw.perDriver[i].net;
      if (gap < -0.005) { worse++; worseBy -= gap; }
    });
    var poolDone = P.riders.filter(function (r) { return r.pool && r.state === 'done'; });
    var shared = poolDone.filter(function (r) { return r.sharedSec > EPS; });
    var alone = poolDone.filter(function (r) { return r.sharedSec <= EPS; });
    var off = function (r) { return r.fullFare - r.fare; };
    return {
      completed: pw.completed, lost: pw.lost, avgWait: pw.avgWait,
      baseCompleted: bw.completed, baseWait: bw.avgWait,
      pooledTrips: pw.pooledTrips,
      shortTrips: pw.shortTrips,
      shortAfterTopup: pw.shortTrips - pw.topupTrips,
      shortfall: pw.shortfall,
      topup: pw.topup,
      avgX: pw.avgX,
      finalX: pw.finalX,
      driverPay: pw.driverPay,
      netPay: pw.netPay,
      lossJobs: pw.lossJobs,
      lossJobsAfterCover: P.cfg.netFloor ? 0 : pw.lossJobs,
      jobLoss: pw.jobLoss,
      cover: pw.cover,
      driversBelowZero: pw.driversBelowZero,
      netVsTwin: pw.netPay - bw.netPay,
      driversWorseThanTwin: worse,
      driversWorseBy: worseBy,
      margin: pw.margin,
      poolCompleted: poolDone.length,
      saved: sum(poolDone, off),
      sharedRiders: shared.length,
      shareRate: poolDone.length ? shared.length / poolDone.length : null,
      sharedSaved: sum(shared, off),
      aloneRiders: alone.length,
      leaked: sum(alone, off),
    };
  }

  // Re-run the same city under the original prototype's rules, stopped at the
  // same moment, so the report can show exactly what the enhancements changed.
  function originalRules(sim) {
    if (!anyEnhancement(sim.cfg)) return null;
    var o = new Sim.Simulation(Object.assign({}, sim.cfg, Sim.ORIGINAL_RULES));
    while (o.pool.t < sim.pool.t - EPS) o.step();
    o.finish();
    return ruleStats(o);
  }

  // ---------------------------------------------------------------- radius sweep

  function sweepRadii(cfg) {
    var maxR = 2 * (cfg.gridSize - 1); // farther than any two points: "unlimited"
    var list = [2, 3, 4, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 70].filter(function (r) { return r < maxR; });
    if (cfg.pingRadius < maxR && list.indexOf(cfg.pingRadius) < 0) list.push(cfg.pingRadius);
    list.sort(function (a, b) { return a - b; });
    list.push(maxR);
    return list;
  }

  function compact(w) {
    var s = worldStats(w);
    return {
      completed: s.completed, lost: s.lost, avgWait: s.avgWait,
      emptyPerPickup: s.emptyPerPickup, driverPay: s.driverPay, idleShare: s.idleShare,
    };
  }

  // One radius, averaged over `seeds` random cities built from the same settings.
  function sweepPoint(cfg, radius, seeds) {
    var acc = null;
    for (var k = 0; k < seeds; k++) {
      var sim = new Sim.Simulation(Object.assign({}, cfg, { pingRadius: radius, seed: cfg.seed + k })).runToEnd();
      var p = compact(sim.pool), b = compact(sim.base);
      if (!acc) acc = { pool: p, base: b };
      else {
        [['pool', p], ['base', b]].forEach(function (pair) {
          var a = acc[pair[0]];
          for (var key in a) a[key] = (a[key] || 0) + (pair[1][key] || 0);
        });
      }
    }
    ['pool', 'base'].forEach(function (w) {
      for (var key in acc[w]) acc[w][key] /= seeds;
    });
    return { radius: radius, pool: acc.pool, base: acc.base };
  }

  // The tightest radius that still delivers within 1% of the best radius:
  // anything wider only adds longer empty drives to pickups.
  function recommendRadius(points, world) {
    var best = Math.max.apply(null, points.map(function (p) { return p[world].completed; }));
    for (var i = 0; i < points.length; i++) {
      if (points[i][world].completed >= best * 0.99 - EPS) return points[i].radius;
    }
    return points[points.length - 1].radius;
  }

  var api = {
    summarize: summarize, histogram: histogram, worldStats: worldStats,
    ruleStats: ruleStats, anyEnhancement: anyEnhancement,
    sweepRadii: sweepRadii, sweepPoint: sweepPoint, recommendRadius: recommendRadius,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PoolMetrics = api;
}
definePoolMetrics(this);
