/*
 * PoolSim engine — pure simulation, no DOM.
 *
 * Two "twin" worlds are built from one scenario (same riders, same request
 * times, same cab start positions). One world allows pooling, the other
 * serves everyone solo. Comparing them isolates the effect of Pool.
 *
 * Model
 *  - City: G x G intersections, Manhattan metric. Cabs move one edge at a
 *    time and only turn at intersections, so a planned stop time is exactly
 *    the realised time (no traffic noise).
 *  - Requests arrive at random times over the whole run. A rider's "original
 *    estimate" is the solo in-car time: manhattan(origin, destination) / speed.
 *  - Each cab has a plan: an ordered list of pickups and drop-offs. A new pool
 *    request may be inserted anywhere in a pool cab's plan (the cab reroutes),
 *    so one rider can share with several co-riders over a single trip.
 *  - Hard rules checked on every insertion, for every rider in the plan:
 *      * never more than 2 riders aboard at any point of the plan;
 *      * a pool rider's in-car time <= maxDetour x their estimate;
 *      * an assigned rider's pickup slips at most pickupSlip seconds past
 *        the time they were promised;
 *      * the new rider's pickup is within pingRadius blocks of driving.
 *  - Unmatched riders give up after `patience` seconds.
 *  - Optional re-dispatch: an assigned rider still waiting for pickup is moved
 *    to a free cab that can reach them much sooner.
 *  - Driver pay: driverRate per occupied second, x(1 + X) while 2 are aboard.
 *    Driving to a pickup is unpaid. Running cost accrues per block driven.
 *  - Rider fare: fareRate x estimate, x(1 - Y) for pool opt-ins, charged at
 *    pickup whether or not a co-rider is ever found.
 *
 * Enhancements (each is a config toggle; all off = the original rules)
 *  - driverGuarantee: a "pooled trip" runs from the moment a cab picks up its
 *    first rider until it is empty again, with two riders aboard at some
 *    point. When it ends, the driver is paid at least what those riders would
 *    have paid as solo trips (driverRate x each rider's estimate). Any
 *    shortfall is topped up by the platform.
 *  - dynamicPremium: X is no longer fixed. After every pooled trip the engine
 *    learns the break-even premium (1 - detour s / shared s) as a moving
 *    average weighted by shared seconds, and sets X = break-even + a small
 *    bonus, clamped to [0, 100%]. Uses only data a platform has live.
 *  - matchedDiscount: a pool rider is charged upfront at a small discount
 *    (unmatchedDiscount) and refunded up to the full Y at drop-off only if
 *    they actually shared the cab. Stops paying Y for pooling that never happened.
 *  - poolFirst (matching): when a pool rider could take an idle cab or join a
 *    cab already on a pool trip, the shared option wins unless it costs more
 *    than poolFirst extra rider-seconds. Keeps idle cabs free for the next
 *    request and raises the share of pool riders who actually share.
 *    0 = the original rule (cheapest option wins outright).
 *  - netFloor (pickup cover): a "job" is the drive to a pickup plus the ride,
 *    until the cab is empty again (or free, if its rider was moved to another
 *    cab). If the job's pay is less than its running cost (pickup driving
 *    included, which is otherwise unpaid), the platform pays the difference.
 *    A cab only drives during a job, so a driver's net never drops below zero
 *    except for the one job still in progress.
 *    Applies in both cities: it is a driver protection, not a pooling rule.
 */
// Wrapped in a named factory so app.js can also boot it inside a Web Worker.
function definePoolSim(root) {
  'use strict';

  var DEFAULTS = {
    gridSize: 50,       // intersections per side
    riders: 200,        // K
    cabs: 30,           // N
    duration: 300,      // P, simulated seconds
    poolOptIn: 60,      // % of riders who opt in to Pool
    maxDetour: 1.5,     // max in-car time / original estimate
    driverPremium: 25,  // X, % extra per second while 2 riders are aboard
    poolDiscount: 30,   // Y, % off the standard fare for opting in
    pingRadius: 15,     // blocks of driving from a cab to a pickup
    patience: 120,      // seconds a rider waits unmatched before giving up
    pickupSlip: 20,     // seconds a promised pickup may slip when a cab reroutes
    reassign: 1,        // 1 = move waiting riders to a cab that frees up closer
    cabSpeed: 1,        // blocks per second
    fareRate: 0.5,      // $ per second of original estimate
    driverRate: 0.35,   // $ per occupied second
    costPerBlock: 0.05, // driver's running cost, $ per block driven
    seed: 7,
    // Enhancements (1 = on). See the header comment.
    driverGuarantee: 1,   // top up a pooled trip to its solo-equivalent pay
    dynamicPremium: 1,    // X follows the observed break-even premium
    matchedDiscount: 1,   // full Y only if the rider actually shared
    unmatchedDiscount: 20, // % off for a pool rider who never shared
    poolFirst: 20,        // s of matching cost a shared option may exceed an idle cab by and still win
    netFloor: 1,          // no job pays the driver less than its running cost
    // Incidents: random bomb threats that close a square cordon for a while.
    threatsPer10Min: 0,   // average threats per 10 simulated minutes (0 = none)
    threatRadius: 4,      // cordon half-width, blocks
    threatDuration: 60,   // seconds the cordon stays closed
  };

  // The original prototype's rules: every enhancement switched off.
  var ORIGINAL_RULES = { driverGuarantee: 0, dynamicPremium: 0, matchedDiscount: 0, poolFirst: 0, netFloor: 0 };

  var DT = 0.1;               // simulation step, seconds
  var DISPATCH_EVERY = 1;     // matching batch interval, seconds
  var MIN_TRIP_BLOCKS = 3;
  var MAX_PLAN_STOPS = 6;     // pending stops a cab may hold
  var VEHICLE_WEIGHT = 0.5;   // value of a cab-second relative to a rider-second
  var MAX_QUEUE_SCAN = 250;   // riders considered per dispatch batch (oldest first)
  var REASSIGN_MIN_GAIN = 8;  // seconds of pickup a re-dispatch must save...
  var REASSIGN_MIN_RATIO = 0.7; // ...and the new ETA must be <= 70% of the old
  var EPS = 1e-6;
  var DYN_X_DECAY = 0.85;     // weight kept by older pooled trips in the break-even average
  var DYN_X_BONUS = 0.05;     // X sits this far above break-even, so drivers come out ahead
  var DYN_X_MIN = 0, DYN_X_MAX = 1;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function manhattan(ax, ay, bx, by) {
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }

  function normalizeConfig(input) {
    var cfg = {};
    for (var k in DEFAULTS) {
      var v = input && input[k] != null ? Number(input[k]) : DEFAULTS[k];
      cfg[k] = isFinite(v) ? v : DEFAULTS[k];
    }
    cfg.gridSize = Math.max(10, Math.round(cfg.gridSize));
    cfg.riders = Math.max(0, Math.round(cfg.riders));
    cfg.cabs = Math.max(1, Math.round(cfg.cabs));
    cfg.duration = Math.max(1, cfg.duration);
    cfg.maxDetour = Math.max(1, cfg.maxDetour);
    cfg.pingRadius = Math.max(1, cfg.pingRadius);
    cfg.patience = Math.max(1, cfg.patience);
    cfg.pickupSlip = Math.max(0, cfg.pickupSlip);
    cfg.reassign = cfg.reassign ? 1 : 0;
    cfg.cabSpeed = Math.max(0.1, cfg.cabSpeed);
    cfg.seed = Math.round(cfg.seed) >>> 0;
    ['driverGuarantee', 'dynamicPremium', 'matchedDiscount', 'netFloor'].forEach(function (k) {
      cfg[k] = cfg[k] ? 1 : 0;
    });
    cfg.unmatchedDiscount = Math.max(0, Math.min(cfg.poolDiscount, cfg.unmatchedDiscount));
    cfg.poolFirst = Math.max(0, cfg.poolFirst);
    cfg.threatsPer10Min = Math.max(0, cfg.threatsPer10Min);
    // Keep a free street on at least one side of the cordon in each direction.
    cfg.threatRadius = Math.max(1, Math.min(Math.floor((cfg.gridSize - 3) / 2), Math.round(cfg.threatRadius)));
    cfg.threatDuration = Math.max(1, cfg.threatDuration);
    return cfg;
  }

  // Demand: uniform random origins/destinations, request times uniform over [0, P).
  function makeScenario(cfg) {
    var rng = mulberry32(cfg.seed);
    var G = cfg.gridSize;
    function node() {
      return { x: Math.floor(rng() * G), y: Math.floor(rng() * G) };
    }
    var cabs = [];
    for (var i = 0; i < cfg.cabs; i++) cabs.push(node());
    var riders = [];
    for (var j = 0; j < cfg.riders; j++) {
      var requestAt = rng() * cfg.duration;
      var o = node();
      var d = node();
      while (manhattan(o.x, o.y, d.x, d.y) < MIN_TRIP_BLOCKS) d = node();
      // Drawn for every rider so changing the opt-in % never moves anyone.
      var optIn = rng() * 100 < cfg.poolOptIn;
      riders.push({ requestAt: requestAt, ox: o.x, oy: o.y, dx: d.x, dy: d.y, optIn: optIn });
    }
    riders.sort(function (a, b) { return a.requestAt - b.requestAt; });
    riders.forEach(function (r, idx) { r.id = idx; });
    return { cabs: cabs, riders: riders, threats: makeThreats(cfg) };
  }

  // Bomb threats: random times (Poisson) and places, one cordon at a time.
  // Own random stream, so turning threats on never moves riders or cabs.
  function makeThreats(cfg) {
    var rng = mulberry32((cfg.seed ^ 0x5bd1e995) >>> 0);
    var G = cfg.gridSize, R = cfg.threatRadius, rate = cfg.threatsPer10Min / 600;
    var out = [], t = 0;
    while (rate > 0) {
      t += -Math.log(1 - rng()) / rate;
      if (t >= cfg.duration) break;
      var cx = Math.floor(rng() * G), cy = Math.floor(rng() * G);
      if (out.length && t < out[out.length - 1].until) continue;
      out.push({
        at: t, until: t + cfg.threatDuration, x: cx, y: cy,
        x1: Math.max(0, cx - R), x2: Math.min(G - 1, cx + R),
        y1: Math.max(0, cy - R), y2: Math.min(G - 1, cy + R),
      });
    }
    return out;
  }

  // Extra blocks to go around a cordon spanning [lo, hi] when going from a
  // to b along the other axis: detour via the free street just outside it.
  function aroundExtra(a, b, lo, hi, G) {
    var best = Infinity, straight = Math.abs(a - b);
    if (lo - 1 >= 0) best = Math.min(best, Math.abs(a - lo + 1) + Math.abs(b - lo + 1) - straight);
    if (hi + 1 <= G - 1) best = Math.min(best, Math.abs(a - hi - 1) + Math.abs(b - hi - 1) - straight);
    return best;
  }

  function World(cfg, scenario, poolEnabled) {
    this.cfg = cfg;
    this.poolEnabled = poolEnabled;
    this.speed = cfg.cabSpeed;
    this.X = cfg.driverPremium / 100;   // premium in force now (moves if dynamicPremium)
    this.Y = cfg.poolDiscount / 100;
    this.Yu = cfg.matchedDiscount ? cfg.unmatchedDiscount / 100 : this.Y; // charged upfront
    this.xLearn = { two: 0, extra: 0 };  // decayed sums behind the break-even estimate
    this.steps = 0;
    this.t = 0;
    this.nextDispatchAt = 0;
    this.arrivalIdx = 0;
    this.queue = [];
    this.series = [];
    this.lostLog = [];
    this.totals = {
      revenue: 0, driverPay: 0, premium: 0, discount: 0,
      requested: 0, pickedUp: 0, completed: 0, lost: 0, waitSum: 0,
      reroutes: 0, reassigned: 0,
      // Enhancement accounting
      pooledTrips: 0,     // pooled trips finished (two aboard at some point)
      shortTrips: 0,      // ...that paid less than the solo-equivalent before any top-up
      shortfall: 0,       // $ those trips fell short by
      topup: 0,           // $ paid by the guarantee
      topupTrips: 0,
      refunds: 0,         // $ refunded at drop-off to riders who shared
      jobs: 0,            // jobs finished (free -> busy -> free)
      lossJobs: 0,        // ...whose pay was below their running cost before any cover
      jobLoss: 0,         // $ those jobs fell short by
      cover: 0,           // $ paid by the pickup cover (netFloor)
      threats: 0,         // bomb threats that closed a cordon
      affected: 0,        // riders whose trip was under way (or requested) while a cordon was closed
      movedStops: 0,      // pickups/drop-offs moved out of a cordon to its edge
      threatPay: 0,       // $ paid to drivers for empty detours around a cordon
    };
    this.threats = scenario.threats;
    this.threatIdx = 0;
    this.zone = null;     // the cordon closed right now, if any

    var speed = this.speed;
    this.cabs = scenario.cabs.map(function (p, i) {
      return {
        id: i, x: p.x, y: p.y, next: null, progress: 0,
        plan: [],       // pending stops, in order
        riders: [],     // riders committed: assigned or aboard
        onboard: [],
        time: { idle: 0, empty: 0, one: 0, two: 0 },
        blocks: { empty: 0, one: 0, two: 0 },
        earnings: 0, premium: 0, trips: 0, reroutes: 0,
        topup: 0, pooledTrips: 0, cover: 0, threatPay: 0,
        trip: null,     // the trip in progress: from first pickup until empty again
        job: null,      // the job in progress: from being given a rider until free again
        planVersion: 0, rerouteVersion: 0,
        _base: null, _baseKey: '',
      };
    });
    this.riders = scenario.riders.map(function (r) {
      var direct = manhattan(r.ox, r.oy, r.dx, r.dy);
      return {
        id: r.id, requestAt: r.requestAt, ox: r.ox, oy: r.oy, dx: r.dx, dy: r.dy,
        optIn: r.optIn,
        pool: poolEnabled && r.optIn,
        direct: direct,
        est: direct / speed,
        fullFare: direct / speed * cfg.fareRate,
        fare: 0,
        refund: 0,              // part of the fare given back at drop-off (matchedDiscount)
        state: 'scheduled',     // scheduled -> waiting -> assigned -> riding -> done | lost
        cab: null,
        assignedAt: null, promisedPickupAt: null, latestPickupAt: null,
        pickupAt: null, dropoffAt: null, lostAt: null,
        sharedSec: 0,
        coRiders: [],           // ids of everyone this rider shared the cab with
        reroutes: 0,            // times their cab changed course while they were aboard
        reassigned: 0,          // times moved to a closer cab before pickup
        joinedOccupied: false,  // boarded a cab that already had a rider
        hosted: false,          // someone boarded while this rider was aboard
        affected: false,        // a bomb-threat cordon was closed during their trip
      };
    });
  }

  World.prototype.step = function () {
    // Bomb threats: open the next cordon, close the current one when it expires.
    if (this.zone && this.t >= this.zone.until - EPS) this.endThreat();
    if (this.threatIdx < this.threats.length && this.t >= this.threats[this.threatIdx].at - EPS) {
      this.startThreat(this.threats[this.threatIdx++]);
    }
    // Riders who requested before this instant join the queue.
    while (this.arrivalIdx < this.riders.length && this.riders[this.arrivalIdx].requestAt <= this.t) {
      var r = this.riders[this.arrivalIdx++];
      r.state = 'waiting';
      if (this.zone) this.affect(r);
      this.queue.push(r);
      this.totals.requested++;
    }
    if (this.t >= this.nextDispatchAt - EPS) {
      this.dispatch();
      this.sample();
      this.nextDispatchAt += DISPATCH_EVERY;
    }
    for (var i = 0; i < this.cabs.length; i++) this.advance(this.cabs[i]);
    this.steps++;
    this.t = this.steps * DT;
  };

  // ---------------------------------------------------------------- movement

  // ---------------------------------------------------------------- bomb threats

  World.prototype.inZone = function (x, y) {
    var z = this.zone;
    return !!z && x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2;
  };

  // Shortest driving distance. With no cordon it is the Manhattan distance.
  // A single rectangular cordon only lengthens a trip when it blocks every
  // shortest path: it covers the whole span between the two points along one
  // axis and sits strictly between them along the other. Then the cab goes
  // round via the nearest free street beside it. (From inside the cordon a
  // cab simply drives straight out.)
  World.prototype.dist = function (ax, ay, bx, by) {
    var d = manhattan(ax, ay, bx, by), z = this.zone, G = this.cfg.gridSize;
    if (!z || this.inZone(ax, ay) || this.inZone(bx, by)) return d;
    if (Math.min(ax, bx) >= z.x1 && Math.max(ax, bx) <= z.x2 && Math.min(ay, by) < z.y1 && Math.max(ay, by) > z.y2) {
      return d + aroundExtra(ax, bx, z.x1, z.x2, G);
    }
    if (Math.min(ay, by) >= z.y1 && Math.max(ay, by) <= z.y2 && Math.min(ax, bx) < z.x1 && Math.max(ax, bx) > z.x2) {
      return d + aroundExtra(ay, by, z.y1, z.y2, G);
    }
    return d;
  };

  // Next street to drive. No cordon: the original L-shaped route (x leg, then
  // y leg). With a cordon: the first neighbour on a shortest path that does
  // not enter the cordon (a cab already inside may drive out through it).
  World.prototype.nextStep = function (cab, s) {
    var x = cab.x, y = cab.y, sx = Math.sign(s.x - x), sy = Math.sign(s.y - y);
    if (this.zone) {
      var d = this.dist(x, y, s.x, s.y), inside = this.inZone(x, y), G = this.cfg.gridSize;
      var moves = [[sx, 0], [0, sy], [1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < moves.length; i++) {
        var nx = x + moves[i][0], ny = y + moves[i][1];
        if ((nx === x && ny === y) || nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
        if (!inside && this.inZone(nx, ny)) continue;
        if (this.dist(nx, ny, s.x, s.y) === d - 1) {
          return { x: nx, y: ny, away: manhattan(nx, ny, s.x, s.y) > manhattan(x, y, s.x, s.y) };
        }
      }
    }
    return sx ? { x: x + sx, y: y } : { x: x, y: y + sy };
  };

  // Nearest street corner just outside the cordon.
  World.prototype.safePoint = function (x, y) {
    var z = this.zone, G = this.cfg.gridSize, best = null;
    [[z.x1 - 1, y], [z.x2 + 1, y], [x, z.y1 - 1], [x, z.y2 + 1]].forEach(function (p) {
      if (p[0] < 0 || p[1] < 0 || p[0] >= G || p[1] >= G) return;
      if (!best || manhattan(x, y, p[0], p[1]) < manhattan(x, y, best[0], best[1])) best = p;
    });
    return best;
  };

  // A rider caught by a cordon: pickup and drop-off inside it move to its edge
  // (the rider walks out; nobody is driven into a closed area).
  World.prototype.affect = function (r) {
    if (!r.affected) { r.affected = true; this.totals.affected++; }
    var p;
    if (r.state !== 'riding' && this.inZone(r.ox, r.oy)) {
      p = this.safePoint(r.ox, r.oy); r.ox = p[0]; r.oy = p[1]; this.totals.movedStops++;
    }
    if (this.inZone(r.dx, r.dy)) {
      p = this.safePoint(r.dx, r.dy); r.dx = p[0]; r.dy = p[1]; this.totals.movedStops++;
    }
  };

  World.prototype.startThreat = function (th) {
    this.zone = th;
    this.totals.threats++;
    var i, j, c;
    for (i = 0; i < this.riders.length; i++) {
      var r = this.riders[i];
      if (r.state === 'waiting' || r.state === 'assigned' || r.state === 'riding') this.affect(r);
    }
    for (i = 0; i < this.cabs.length; i++) {
      c = this.cabs[i];
      if (!c.plan.length) continue;
      for (j = 0; j < c.plan.length; j++) {
        var s = c.plan[j];
        if (s.type === 'pickup') { s.x = s.rider.ox; s.y = s.rider.oy; } else { s.x = s.rider.dx; s.y = s.rider.dy; }
      }
      c.planVersion++;
      if (c.onboard.length) c.rerouteVersion++;
    }
  };

  // Lifting a cordon only shortens routes, so every plan stays valid.
  World.prototype.endThreat = function () {
    this.zone = null;
    for (var i = 0; i < this.cabs.length; i++) this.cabs[i].planVersion++;
  };

  World.prototype.advance = function (cab) {
    var budget = this.speed * DT; // blocks this step
    var now = this.t;
    for (var guard = 0; guard < 10000; guard++) {
      if (!cab.next) {
        this.serveStops(cab, now);
        if (!cab.plan.length) {
          if (cab.job) this.closeJob(cab);
          cab.time.idle += budget / this.speed;
          return;
        }
        if (budget <= EPS) return;
        cab.next = this.nextStep(cab, cab.plan[0]);
        cab.progress = 0;
      }
      var move = Math.min(1 - cab.progress, budget);
      var sec = move / this.speed;
      this.accrue(cab, sec, move);
      // Empty detour around a cordon: each block driven away from the target
      // costs two blocks (out and back), and the platform pays for both.
      if (cab.next.away && !cab.onboard.length) {
        var tp = 2 * sec * this.cfg.driverRate;
        cab.earnings += tp;
        cab.threatPay += tp;
        this.totals.driverPay += tp;
        this.totals.threatPay += tp;
        if (cab.job) cab.job.pay += tp;
      }
      cab.progress += move;
      budget -= move;
      now += sec;
      if (cab.progress >= 1 - EPS) {
        cab.x = cab.next.x;
        cab.y = cab.next.y;
        cab.next = null;
        cab.progress = 0;
      }
      if (budget <= EPS) {
        if (!cab.next) this.serveStops(cab, now);
        return;
      }
    }
  };

  World.prototype.accrue = function (cab, sec, blocks) {
    var n = cab.onboard.length;
    if (cab.job) cab.job.cost += this.cfg.costPerBlock * blocks;
    if (n === 0) {
      cab.time.empty += sec;
      cab.blocks.empty += blocks;
      return;
    }
    var rate = this.cfg.driverRate;
    var pay = rate * sec;
    var trip = cab.trip;
    if (n === 1) {
      cab.time.one += sec;
      cab.blocks.one += blocks;
    } else {
      var prem = rate * this.X * sec;
      pay += prem;
      cab.premium += prem;
      cab.time.two += sec;
      cab.blocks.two += blocks;
      this.totals.premium += prem;
      cab.onboard[0].sharedSec += sec;
      cab.onboard[1].sharedSec += sec;
      trip.twoSec += sec;
    }
    trip.pay += pay;
    cab.job.pay += pay;
    cab.earnings += pay;
    this.totals.driverPay += pay;
  };

  World.prototype.openJob = function (cab) {
    if (!cab.job) cab.job = { pay: 0, cost: 0 };
  };

  // The cab is free again. If the job paid less than it cost to drive
  // (usually a long unpaid pickup), the pickup cover pays the difference.
  World.prototype.closeJob = function (cab) {
    var job = cab.job, T = this.totals;
    cab.job = null;
    T.jobs++;
    var loss = job.cost - job.pay;
    if (loss <= EPS) return;
    T.lossJobs++;
    T.jobLoss += loss;
    if (this.cfg.netFloor) {
      cab.earnings += loss;
      cab.cover += loss;
      T.driverPay += loss;
      T.cover += loss;
    }
  };

  // A trip ends when the cab is empty again. If two riders were ever aboard,
  // compare what the driver earned with what the same riders would have paid
  // as solo trips, top up any shortfall (driverGuarantee) and update the
  // break-even premium (dynamicPremium).
  World.prototype.closeTrip = function (cab) {
    var trip = cab.trip, cfg = this.cfg, T = this.totals;
    cab.trip = null;
    if (trip.twoSec <= EPS) return;
    T.pooledTrips++;
    cab.pooledTrips++;
    var shortfall = trip.soloPay - trip.pay;
    if (shortfall > EPS) {
      T.shortTrips++;
      T.shortfall += shortfall;
      if (cfg.driverGuarantee) {
        cab.earnings += shortfall;
        cab.topup += shortfall;
        cab.job.pay += shortfall;
        T.driverPay += shortfall;
        T.topup += shortfall;
        T.topupTrips++;
      }
    }
    if (cfg.dynamicPremium) {
      // Break-even X for a trip: rate x (shared s) x X must make up for the
      // shared seconds being paid once, net of the detour seconds paid on top.
      var L = this.xLearn;
      L.two = L.two * DYN_X_DECAY + trip.twoSec;
      L.extra = L.extra * DYN_X_DECAY + trip.extraSec;
      var be = 1 - L.extra / L.two;
      this.X = Math.min(DYN_X_MAX, Math.max(DYN_X_MIN, be + DYN_X_BONUS));
    }
  };

  World.prototype.serveStops = function (cab, now) {
    while (cab.plan.length && cab.plan[0].x === cab.x && cab.plan[0].y === cab.y) {
      var stop = cab.plan.shift();
      var r = stop.rider;
      cab.planVersion++;
      if (stop.type === 'pickup') {
        if (!cab.onboard.length) {
          cab.trip = { pay: 0, soloPay: 0, twoSec: 0, extraSec: 0 };
        }
        if (cab.onboard.length === 1) {
          var host = cab.onboard[0];
          host.hosted = true;
          host.coRiders.push(r.id);
          r.joinedOccupied = true;
          r.coRiders.push(host.id);
        }
        cab.onboard.push(r);
        r.state = 'riding';
        r.pickupAt = now;
        // Upfront fare. With matchedDiscount the pool rider pays the smaller
        // unmatched discount now and is refunded the rest if they share.
        r.fare = r.fullFare * (r.pool ? 1 - this.Yu : 1);
        this.totals.revenue += r.fare;
        this.totals.discount += r.fullFare - r.fare;
        this.totals.pickedUp++;
        this.totals.waitSum += now - r.requestAt;
      } else {
        cab.onboard.splice(cab.onboard.indexOf(r), 1);
        cab.riders.splice(cab.riders.indexOf(r), 1);
        r.state = 'done';
        r.dropoffAt = now;
        cab.trips++;
        this.totals.completed++;
        if (r.pool && r.sharedSec > EPS && this.Y > this.Yu) {
          r.refund = r.fullFare * (this.Y - this.Yu);
          r.fare -= r.refund;
          this.totals.revenue -= r.refund;
          this.totals.discount += r.refund;
          this.totals.refunds += r.refund;
        }
        cab.trip.soloPay += this.cfg.driverRate * r.est;
        cab.trip.extraSec += (now - r.pickupAt) - r.est;
        if (!cab.onboard.length) {
          // Empty again: settle the trip (pay floor), then the job (pickup
          // cover). A busy cab with more riders lined up starts a new job
          // for the drive to its next pickup.
          this.closeTrip(cab);
          this.closeJob(cab);
          if (cab.riders.length) this.openJob(cab);
        }
      }
    }
  };

  // ---------------------------------------------------------------- planning

  function pickupStop(r) { return { type: 'pickup', rider: r, x: r.ox, y: r.oy }; }
  function dropoffStop(r) { return { type: 'dropoff', rider: r, x: r.dx, y: r.dy }; }

  // Blocks the cab must still drive to reach (x, y) directly. A cab that is
  // mid-edge finishes the edge first.
  World.prototype.reach = function (cab, x, y) {
    return cab.next
      ? 1 - cab.progress + this.dist(cab.next.x, cab.next.y, x, y)
      : this.dist(cab.x, cab.y, x, y);
  };

  // Time the plan and check every rule. Returns null if any rule breaks.
  // `newRider` is the rider being inserted (their pickup must be within the
  // ping radius); pass check=false to time a plan already committed.
  World.prototype.evalPlan = function (cab, plan, newRider, check) {
    var speed = this.speed, limit = this.cfg.maxDetour;
    var maxPick = this.cfg.pingRadius / speed;
    var t = this.t, x, y;
    if (cab.next) {
      t += (1 - cab.progress) / speed;
      x = cab.next.x; y = cab.next.y;
    } else {
      x = cab.x; y = cab.y;
    }
    var load = cab.onboard.length;
    var picks = {}, drops = {}, newPick = null;
    for (var i = 0; i < plan.length; i++) {
      var s = plan[i], r = s.rider;
      t += this.dist(x, y, s.x, s.y) / speed;
      x = s.x; y = s.y;
      if (s.type === 'pickup') {
        load++;
        if (check) {
          if (load > 2) return null;
          if (r === newRider) {
            if (t - this.t > maxPick + EPS) return null;
          } else if (t > r.latestPickupAt + EPS) {
            return null;
          }
        }
        if (r === newRider) newPick = t;
        picks[r.id] = t;
      } else {
        load--;
        var pt = r.state === 'riding' ? r.pickupAt : picks[r.id];
        // Cap vs the solo route as it is now (a cordon can make it longer).
        if (check && t - pt > limit * Math.max(r.est, this.dist(r.ox, r.oy, r.dx, r.dy) / speed) + EPS) return null;
        drops[r.id] = t;
      }
    }
    return { end: t, picks: picks, drops: drops, newPick: newPick };
  };

  World.prototype.baseEval = function (cab) {
    var key = cab.planVersion + '@' + this.steps;
    if (cab._baseKey !== key) {
      cab._base = this.evalPlan(cab, cab.plan, null, false);
      cab._baseKey = key;
    }
    return cab._base;
  };

  // Best place to slot rider r into the cab's plan, by matching cost (in
  // rider-seconds): the new rider's wait, every extra in-car or waiting second
  // the change imposes on anyone, plus a weight on the extra cab-seconds.
  World.prototype.bestInsertion = function (cab, r) {
    var base = this.baseEval(cab);
    var P = pickupStop(r), D = dropoffStop(r);
    var S = cab.plan, n = S.length, best = null;
    for (var i = 0; i <= n; i++) {
      for (var j = i; j <= n; j++) {
        var plan = S.slice(0, i);
        plan.push(P);
        for (var k = i; k < j; k++) plan.push(S[k]);
        plan.push(D);
        for (k = j; k < n; k++) plan.push(S[k]);
        var res = this.evalPlan(cab, plan, r, true);
        if (!res) continue;
        var delay = 0;
        for (var id in base.drops) delay += res.drops[id] - base.drops[id];
        var cost = (res.newPick - this.t) + (res.drops[r.id] - res.newPick - r.est) + delay
          + VEHICLE_WEIGHT * (res.end - base.end);
        if (!best || cost < best.cost) {
          best = { cab: cab, plan: plan, cost: cost, res: res, base: base };
        }
      }
    }
    return best;
  };

  World.prototype.isPoolCab = function (cab) {
    if (!cab.riders.length || cab.plan.length + 2 > MAX_PLAN_STOPS) return false;
    for (var i = 0; i < cab.riders.length; i++) if (!cab.riders[i].pool) return false;
    return true;
  };

  World.prototype.commit = function (opt, r) {
    var cab = opt.cab, cfg = this.cfg;
    var rerouted = false;
    for (var i = 0; i < cab.onboard.length; i++) {
      var a = cab.onboard[i];
      if (opt.res.drops[a.id] > opt.base.drops[a.id] + EPS) {
        a.reroutes++;
        rerouted = true;
      }
    }
    if (rerouted) {
      cab.reroutes++;
      cab.rerouteVersion++;
      this.totals.reroutes++;
    }
    cab.plan = opt.plan;
    cab.planVersion++;
    cab.riders.push(r);
    r.state = 'assigned';
    r.cab = cab.id;
    r.assignedAt = this.t;
    r.promisedPickupAt = opt.res.newPick;
    r.latestPickupAt = opt.res.newPick + cfg.pickupSlip;
    this.openJob(cab);
  };

  // ---------------------------------------------------------------- dispatch

  World.prototype.dispatch = function () {
    var cfg = this.cfg, now = this.t;

    // Riders who waited too long without a match give up.
    if (this.queue.length) {
      var keep = [];
      for (var q = 0; q < this.queue.length; q++) {
        var w = this.queue[q];
        if (now - w.requestAt >= cfg.patience - EPS) {
          w.state = 'lost';
          w.lostAt = now;
          this.totals.lost++;
          this.lostLog.push(w.id);
        } else {
          keep.push(w);
        }
      }
      this.queue = keep;
    }

    var idle = [], poolable = [], i, c;
    for (i = 0; i < this.cabs.length; i++) {
      c = this.cabs[i];
      if (!c.riders.length) idle.push(c);
      else if (this.poolEnabled && this.isPoolCab(c)) poolable.push(c);
    }

    if (this.queue.length) this.matchQueue(idle, poolable);
    if (cfg.reassign && idle.length) this.redispatch(idle);
  };

  World.prototype.matchQueue = function (idle, poolable) {
    var radius = this.cfg.pingRadius;
    var remaining = [];
    var scanned = 0;
    for (var q = 0; q < this.queue.length; q++) {
      var r = this.queue[q];
      if (scanned >= MAX_QUEUE_SCAN || (!idle.length && !(r.pool && poolable.length))) {
        remaining.push(r);
        continue;
      }
      scanned++;
      var best = null, shared = null, opt, j, c;
      // Ping only cabs whose direct drive to the pickup fits in the radius.
      for (j = 0; j < idle.length; j++) {
        c = idle[j];
        if (this.reach(c, r.ox, r.oy) > radius + EPS) continue;
        opt = this.bestInsertion(c, r);
        if (opt && (!best || opt.cost < best.cost)) best = opt;
      }
      if (r.pool) {
        for (j = 0; j < poolable.length; j++) {
          c = poolable[j];
          if (this.reach(c, r.ox, r.oy) > radius + EPS) continue;
          opt = this.bestInsertion(c, r);
          if (opt && (!shared || opt.cost < shared.cost)) shared = opt;
        }
        // Pool-first: joining a cab already on a pool trip beats an idle cab
        // unless it costs more than poolFirst extra rider-seconds.
        if (shared && (!best || shared.cost < best.cost + this.cfg.poolFirst)) best = shared;
      }
      if (!best) {
        remaining.push(r);
        continue;
      }
      var cab = best.cab;
      var wasIdle = !cab.riders.length;
      this.commit(best, r);
      if (wasIdle) {
        idle.splice(idle.indexOf(cab), 1);
        if (r.pool && this.isPoolCab(cab)) poolable.push(cab);
      } else if (!this.isPoolCab(cab)) {
        poolable.splice(poolable.indexOf(cab), 1);
      }
    }
    this.queue = remaining;
  };

  // Re-dispatch: a rider still waiting for pickup moves to a free cab that can
  // reach them much sooner. Removing stops never makes anyone else later
  // (Manhattan distances obey the triangle inequality), so the old cab's
  // remaining riders stay within every rule.
  World.prototype.redispatch = function (idle) {
    var radius = this.cfg.pingRadius, speed = this.speed;
    for (var i = 0; i < this.cabs.length && idle.length; i++) {
      var c = this.cabs[i];
      if (!c.riders.length) continue;
      var waiting = c.riders.filter(function (r) { return r.state === 'assigned'; });
      for (var w = 0; w < waiting.length && idle.length; w++) {
        var r = waiting[w];
        var cur = this.baseEval(c).picks[r.id] - this.t;
        if (cur < REASSIGN_MIN_GAIN) continue;
        var bestCab = null, bestEta = Infinity;
        for (var j = 0; j < idle.length; j++) {
          var d = this.reach(idle[j], r.ox, r.oy);
          if (d <= radius + EPS && d / speed < bestEta) { bestEta = d / speed; bestCab = idle[j]; }
        }
        if (!bestCab || bestEta > cur - REASSIGN_MIN_GAIN || bestEta > cur * REASSIGN_MIN_RATIO) continue;

        c.plan = c.plan.filter(function (s) { return s.rider !== r; });
        c.riders.splice(c.riders.indexOf(r), 1);
        c.planVersion++;
        if (c.onboard.length) c.rerouteVersion++;

        bestCab.plan = [pickupStop(r), dropoffStop(r)];
        bestCab.riders.push(r);
        bestCab.planVersion++;
        this.openJob(bestCab);
        r.cab = bestCab.id;
        r.assignedAt = this.t;
        r.promisedPickupAt = this.t + bestEta;
        r.latestPickupAt = r.promisedPickupAt + this.cfg.pickupSlip;
        r.reassigned++;
        this.totals.reassigned++;

        idle.splice(idle.indexOf(bestCab), 1);
        if (!c.riders.length) idle.push(c);
      }
    }
  };

  // ---------------------------------------------------------------- readouts

  World.prototype.live = function () {
    var shared = 0, busy = 0;
    for (var i = 0; i < this.cabs.length; i++) {
      var c = this.cabs[i];
      if (c.onboard.length === 2) shared++;
      if (c.riders.length) busy++;
    }
    var T = this.totals;
    return {
      t: this.t,
      waiting: T.requested - T.pickedUp - T.lost,
      unassigned: this.queue.length,
      riding: T.pickedUp - T.completed,
      completed: T.completed,
      lost: T.lost,
      sharedCabs: shared,
      busyCabs: busy,
      idleCabs: this.cabs.length - busy,
      avgWait: T.pickedUp ? T.waitSum / T.pickedUp : null,
      driverPay: T.driverPay,
      revenue: T.revenue,
      discount: T.discount,
      X: this.X,
      topup: T.topup,
      topupTrips: T.topupTrips,
      pooledTrips: T.pooledTrips,
      refunds: T.refunds,
      cover: T.cover,
      lossJobs: T.lossJobs,
    };
  };

  World.prototype.sample = function () {
    var l = this.live();
    this.series.push({
      t: this.t, waiting: l.waiting, riding: l.riding, completed: l.completed, lost: l.lost,
      sharedCabs: l.sharedCabs, idleCabs: l.idleCabs, driverPay: l.driverPay, X: this.X,
    });
  };

  function Simulation(input) {
    this.cfg = normalizeConfig(input);
    this.scenario = makeScenario(this.cfg);
    this.pool = new World(this.cfg, this.scenario, true);
    this.base = new World(this.cfg, this.scenario, false);
  }

  Simulation.prototype.step = function () {
    this.pool.step();
    this.base.step();
  };

  Object.defineProperty(Simulation.prototype, 't', {
    get: function () { return this.pool.t; },
  });

  Object.defineProperty(Simulation.prototype, 'done', {
    get: function () { return this.pool.t >= this.cfg.duration - EPS; },
  });

  Simulation.prototype.finish = function () {
    this.pool.sample();
    this.base.sample();
    return this;
  };

  Simulation.prototype.runToEnd = function () {
    while (!this.done) this.step();
    return this.finish();
  };

  var api = {
    DEFAULTS: DEFAULTS,
    ORIGINAL_RULES: ORIGINAL_RULES,
    DYN_X_BONUS: DYN_X_BONUS,
    DT: DT,
    EPS: EPS,
    DISPATCH_EVERY: DISPATCH_EVERY,
    MAX_PLAN_STOPS: MAX_PLAN_STOPS,
    VEHICLE_WEIGHT: VEHICLE_WEIGHT,
    normalizeConfig: normalizeConfig,
    makeScenario: makeScenario,
    manhattan: manhattan,
    World: World,
    Simulation: Simulation,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PoolSim = api;
}
definePoolSim(this);
