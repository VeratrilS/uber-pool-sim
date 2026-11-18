# PoolSim: Uber Pool, enhanced

The given prototype, extended. Up to 2 riders share a cab, 1 seat per rider. Two cities run side by side with the
same riders and cabs: With Pool and No Pool.

Run: double-click `start.bat` or open `index.html`. No server, no install.
Check: `node test/sim.test.js` (27 tests) and `node test/compare.js` (reproduces the results below).

## What was wrong in the original

- Drivers are paid per second with a rider aboard, so time with two riders is paid once, not twice. About 70% of
  pooled trips paid the driver less than carrying the same riders separately.
- Every pool rider got 30% off even if nobody ever joined them.
- The matcher sent pool riders to empty cabs whenever that was slightly cheaper, so few actually shared.

## Enhancements and how to see them

All are in the sidebar under Enhancements. The "Original rules" and "All enhancements" buttons switch between the two
versions in one click.

1. **Driver paid per rider.** When a pooled trip ends, the driver gets at least what the riders would have paid as
   solo trips; the platform covers the gap.
   See it: the tile "Pooled trips where the driver lost money" stays at 0; hovering a cab shows the extra pay.
2. **Dynamic premium X.** X (extra pay while 2 are aboard) is relearned after every pooled trip to the break-even value
   instead of a fixed 25%.
   See it: the "With Pool" map header shows X rising from 25% to about 40%.
3. **Bigger discount only if matched.** 35% off if the rider actually shared, 25% if they never did (originally 30%
   for everyone).
   See it: the "Pool riders saved" tile shows both rates.
4. **Pool-first matching.** A pool rider joins a cab already on a pool trip unless that is 20+ seconds worse than an
   empty cab.
   See it: the tile "Pool riders who actually shared" goes up (55% → 66% on the default city), and more orange
   (2 aboard) cabs appear on the map.
5. **Pickup cover.** If a trip costs the driver more in fuel than it pays, the platform pays the difference.
   See it: set "Driver running cost" to 0.30 and run; the report row "Drivers below zero" goes from 23 to 0.

While it runs, the tiles under the maps compare against the same city running under the original rules in the
background (green = better). At the end, the report shows the full before/after and re-runs your settings on
12 other random cities to check the result isn't luck.

## Extra: random bomb threats

Under Incidents, set "Bomb threats" above 0. A red cordon closes at random places and times, the same in both cities.
Cabs drive around it on the shortest open route, pickups and drop-offs inside it move to its edge, and drivers are
paid for empty detours.

## Results

From `node test/compare.js`: 16 random cities at 30 cabs, original vs enhanced.

- Trips where the driver lost money: 15.8 → 0 per run.
- Drivers earn $88 more per run (better off in 16 of 16 cities).
- Riders save $32 more per run (15 of 16 cities).
- Pool riders who actually share: 60% → 67% (29% → 47% with 60 cabs).
- Waits and rides completed: unchanged.
- The platform pays for this: margin down about 18%.

Same direction with 15 and 60 cabs, except riders break even with 60 cabs.

## Tried and dropped

- Batch matching with the Hungarian algorithm: no gain, because requests arrive about one at a time.
- Moving idle cabs to empty areas: shorter waits, but drivers pay for the empty driving.
- Holding riders for a match, and widening the ping radius: both made waits longer.

## Code changes

- `js/sim.js`: the new rules (`closeTrip`, `closeJob`, fares, `matchQueue`) and bomb threats (`startThreat`, `dist`,
  `nextStep`).
- `js/metrics.js`, `js/report.js`: before/after on the same city, and the 12-city check.
- `js/app.js`, `index.html`, `styles.css`: sidebar controls, presets, live comparison tiles, cordon on the map.
- `test/`: 11 new tests (including "all enhancements off = original engine"), `compare.js`, and the original engine
  for that test.

Assumptions, as in the original: no traffic, uniform demand, every driver accepts. Opt-in doesn't react to price.
