# PoolSim: Uber Pool, enhanced

In the original prototype, a driver who carried two riders together often earned less than if they had carried them
one after the other. That happened on about 70% of pooled trips. Meanwhile, every rider who opted in got 30% off,
even when nobody ever joined them.

This version fixes both, gets more riders to actually share, and shows the difference live.

Run: double-click `start.bat` or open `index.html`. No server.
Check: `node test/sim.test.js` (27 tests), `node test/compare.js` (the numbers below).

## What changed, and where to see it

Everything is in the sidebar under Enhancements. Click "Original rules", run, then "All enhancements" and run again.

1. **Drivers are paid per rider.** A pooled trip never pays less than the same riders would have as solo trips.
   Watch the tile "Pooled trips where the driver lost money": it stays at 0.
2. **The premium adjusts itself.** The extra pay while two riders are aboard is relearned after every pooled trip,
   instead of a fixed 25%. Watch X in the "With Pool" header climb to about 40%.
3. **Sharing is rewarded.** 35% off if the rider actually shared, 25% if nobody joined.
4. **Pool riders get pooled.** A pool rider joins a cab already on a pool trip unless that's 20+ seconds worse than
   an empty cab. Watch "Pool riders who actually shared" go from 55% to 66%, and more orange cabs on the map.
5. **No driver ends below zero.** If a trip costs more in fuel than it pays, the platform covers it. Set "Driver
   running cost" to 0.30: drivers below zero drop from 23 to 0.

The tiles under the maps compare live against the same city running under the original rules. At the end, the report
re-runs your settings on 12 other cities, to show the result isn't luck.

Bonus: under Incidents, turn on "Bomb threats". A cordon closes at random; cabs reroute around it and riders inside
walk to its edge.

## Does it work?

Over 16 random cities at the default settings:

- Drivers earn $88 more per run and are better off in 16 of 16 cities. No pooled trip loses them money.
- Riders save $32 more per run (15 of 16 cities). Sharing rises from 60% to 67%.
- Waits and rides completed are unchanged.
- The platform pays for it: about 18% of its margin.

## What didn't work

Optimal batch matching (Hungarian algorithm) changed nothing: requests arrive about one at a time. Moving idle cabs
to empty areas cut waits, but made drivers pay for empty driving. Holding riders for a match made waits longer.

## Code

The rules are in `js/sim.js` (`closeTrip`, `closeJob`, `matchQueue`, and `dist`/`nextStep` for the cordon). The
before/after report is in `js/metrics.js` and `js/report.js`, and the controls in `js/app.js`. The tests include a
check that switching every enhancement off gives exactly the original engine.
