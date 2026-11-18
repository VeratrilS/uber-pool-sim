# PoolSim: Uber Pool, enhanced

In the original prototype, a driver who picked up a second rider was often punished for it. On about 70% of pooled
trips, carrying two people together paid less than carrying them one after the other. Riders had the opposite deal:
everyone who opted in got 30% off, even if nobody ever joined them.

This version makes sharing pay for both sides, and lets you watch it happen.

Open `index.html` (or double-click `start.bat`). No server, no install.

## Five changes, and where to spot them

1. **Drivers are paid per rider.** A pooled trip never pays less than the same riders would have paid solo.
   The tile "Pooled trips where the driver lost money" stays at 0. Hover any cab to see the extra it earned.
2. **The premium sets itself.** Instead of a fixed 25%, the extra pay for two riders is relearned after every pooled
   trip. Watch X in the "With Pool" header climb to about 40%.
3. **Sharing is rewarded.** Riders who actually share get 35% off; riders nobody joined get 25%. Both rates show in
   the "Pool riders saved" tile.
4. **Pool riders actually get pooled.** A pool rider now joins a cab already on a pool trip unless that costs 20+
   seconds more than an empty one. On the default city, "Pool riders who actually shared" goes from 55% to 66%, and
   the map fills with more orange two-rider cabs.
5. **No driver ends the day below zero.** If a trip burns more fuel than it pays, the platform covers it. Set
   "Driver running cost" to 0.30 and the report's count of drivers below zero falls from 23 to 0.

To see the difference, click "Original rules" in the sidebar, run, then "All enhancements" and run again. While it
runs, the tiles under the maps compare live against the same city under the old rules (green means better). When it
ends, the report replays your settings on 12 other random cities, so one lucky city can't fake a result.

Bonus: under Incidents, switch on "Bomb threats". A red cordon drops at random, the same in both cities. Cabs find
the shortest way around it, riders inside walk to its edge, and drivers are paid for the detour.

## The numbers

Across 16 random cities at default settings:

- Drivers earn $88 more per run and come out ahead in all 16. No pooled trip loses them money.
- Riders save $32 more per run (15 of 16 cities), and sharing rises from 60% to 67%.
- Waits and rides completed stay the same.
- The platform funds it, giving up about 18% of its margin.

Reproduce them with `node test/compare.js`; run the 27 tests with `node test/sim.test.js`.

## Code

The rules live in `js/sim.js` (`closeTrip`, `closeJob`, `matchQueue`, plus `dist` and `nextStep` for the cordon).
The before/after report is `js/metrics.js` and `js/report.js`; the controls are in `js/app.js`. One test switches
every enhancement off and checks the result matches the original engine exactly.
