# PoolSim: Uber Pool, enhanced

The given prototype, extended. Up to 2 riders share a cab, 1 seat per rider. Two cities run side by side with the
same riders and cabs: **With Pool** and **No Pool**.

**Run:** double-click `start.bat` or open `index.html` in a browser. No server, no install.
**Check:** `node test/sim.test.js` (27 tests) and `node test/compare.js` (reproduces the results table below).

## What was wrong in the original

- Drivers are paid per second with a rider aboard, so time with two riders is paid once, not twice. About 70% of
  pooled trips paid the driver less than carrying the same riders separately would have.
- Every pool rider got 30% off even if nobody ever joined them.
- The matcher sent pool riders to empty cabs whenever that was slightly cheaper, so few actually shared.

## Enhancements and how to see them

Each one is a control in the sidebar under **Enhancements**. The **Original rules** / **All enhancements** buttons
switch between the two versions in one click.

| # | Enhancement | What it does | Where to see it |
|---|---|---|---|
| 1 | Driver paid per rider | When a pooled trip ends, the driver gets at least what the riders would have paid as solo trips; the platform covers the gap. | Tile "Pooled trips where the driver lost money" stays at 0. Hover a cab: "incl. per-rider pay floor". |
| 2 | Dynamic premium X | X (premium while 2 are aboard) is relearned after every pooled trip to the break-even value, instead of a fixed 25%. | Map header "With Pool": X climbs from 25% to about 40%. |
| 3 | Bigger discount only if matched | 35% off if the rider actually shared, 25% if they never did (original: 30% for everyone). | Tile "Pool riders saved" shows both rates; report row "…of which went to riders who shared". |
| 4 | Pool-first matching | A pool rider joins a cab already on a pool trip unless that is 20+ s worse than an empty cab. | Tile "Pool riders who actually shared" (e.g. 55% → 66%); more orange (2 aboard) cabs on the map. |
| 5 | Pickup cover | If a trip costs the driver more in fuel than it pays, the platform pays the difference. | Set "Driver running cost" to 0.30: report row "Drivers below zero" goes from many to 0. |

**Live comparison:** the four tiles under the maps ("Enhanced vs original rules") come from the same city running under
the original rules in the background. Green = better than the original.

**Report** (opens at the end of the run): the section "What the enhancements changed" has the full before/after table,
then **"Does it hold in other cities?"** re-runs your settings on 12 other random cities.

## Extra: random bomb threats

Under **Incidents**, set "Bomb threats" above 0. A red cordon closes at random places and times, the same in both
cities. Cabs drive around it on the shortest open route, pickups and drop-offs inside it move to its edge, and drivers
are paid for empty detours. The report counts threats, riders caught and stops moved.

## Results

`node test/compare.js`: 16 random cities per row, default settings, original → enhanced.

| Fleet | Trips where driver lost money | Drivers per run | Riders per run | Riders who share | Avg wait | Platform per run |
|---|---|---|---|---|---|---|
| 15 cabs | 11.2 → 0 | +$79 (16/16 cities) | +$50 (16/16) | 88% → 87% | 42.7 → 43.0 s | −$129 |
| 30 cabs | 15.8 → 0 | +$88 (16/16) | +$32 (15/16) | 60% → 67% | 17.5 → 17.7 s | −$105 |
| 60 cabs | 12.1 → 0 | +$80 (16/16) | ±$0 (8/16) | 29% → 47% | 7.1 → 7.2 s | −$68 |

Drivers and riders gain; the platform pays for it out of its margin (about 18% at 30 cabs). Waits and rides completed
are unchanged: these changes move money and improve sharing, they don't make cabs faster.

## Tried and dropped (measured)

Batch matching with the Hungarian algorithm (no gain: about one request per dispatch round); moving idle cabs to empty
areas (shorter waits, but drivers pay for the empty driving); holding riders for a match and widening the ping radius
(both made waits longer).

## Code changes

- `js/sim.js`: the rules (`closeTrip`, `closeJob`, fares, `matchQueue`), bomb threats (`startThreat`, `dist`, `nextStep`)
- `js/metrics.js`, `js/report.js`: before/after on the same city, 12-city check (`validatePoint`)
- `js/app.js`, `index.html`, `styles.css`: sidebar controls, presets, live comparison tiles, cordon on the map
- `test/sim.test.js`: 11 new tests, including "all enhancements off = original engine" against `test/original/sim.js`
- `test/compare.js`: reproduces the results table; `start.bat`: launcher

Assumptions: no traffic, uniform demand (as in the original); every driver accepts; opt-in doesn't react to price.
