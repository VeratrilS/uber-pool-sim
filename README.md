# PoolSim: Uber Pool, enhanced

In the original prototype, a driver who carried two riders together was often paid less than one who carried them
one after the other. Pay is per second with someone aboard, so time with two riders was paid once. Every rider who
opted in got 30% off, even if nobody ever joined them. And cabs always drove an L-shaped route, all east-west and
then all north-south, even when that was the slow way.

This version fixes all three, puts the city under real pressure, and lets you watch the difference live.

Run it: double-click `start.bat` or open `index.html`. No server, no install.
Check it: `node test/sim.test.js` runs 28 tests; `node test/compare.js` reproduces the averages below.

## A harder city

Both of these apply to the original and the enhanced version alike, so the comparison stays fair.

- **The right side is slow.** The right half of the city is congested: every street there takes 25% longer. It is
  shaded on both maps. Change it with "Right side slower" under City & money.
- **Bomb threats happen.** At random times and places, a cordon 6 blocks each way closes for 90 seconds, at least
  once per run and in the same spot in both cities. Cabs drive around it, riders inside walk to its edge, and drivers
  are paid for empty detours. Settings are under Incidents.

## Six enhancements, and where to see them

They live in the sidebar under Enhancements. "Original rules" and "All enhancements" switch them all at once.

1. **Drivers paid per rider.** When a pooled trip ends, the driver gets at least what the riders' solo trips would
   have paid on these streets; the platform covers the gap. Watch "Pooled trips where the driver lost money" stay at
   0 (11 under the original rules on the default city). Hover a cab to see the extra pay.
2. **A premium that learns.** X, the extra pay while two riders are aboard, is relearned after every pooled trip to
   the break-even value instead of sitting at 25%. Watch X in the left map's header climb from 25% to about 45%.
3. **Sharing rewarded.** 35% off for riders who actually shared, 25% if nobody joined, instead of 30% for everyone.
   The "Pool riders saved" tile shows both.
4. **Pool-first matching.** A pool rider joins a cab already on a pool trip unless that is 20+ seconds worse than an
   empty cab. Watch "Pool riders who actually shared" climb, and more orange two-rider cabs on the map.
5. **Pickup cover.** If a trip costs the driver more in fuel than it pays, the platform pays the difference, so
   nobody ends below zero. Set "Driver running cost" to 0.30: drivers below zero go from 5 to 0.
6. **Fastest routes.** Cabs take the quickest path over the real street costs (Dijkstra), doing their north-south
   driving on the fast left side and steering around cordons. Watch routes bend left; on the default city the
   average wait drops from 25.6 s to 21.6 s and rides completed rise from 151 to 154.

## Watching the comparison

Above the maps, the "Right-hand map" switch picks Original prototype (given) or No Pool. By default the right map
plays the same city under the model you were given, next to ours on the left. The tiles under the maps compare live against the original
rules; green means better. When the run ends, the report shows the full before and after, a "Bomb threats in this
run" block (default city: 1 cordon, 10 riders delayed, 27 s of delay added, 5 stops moved to the cordon edge), and
your settings replayed on 12 other random cities.

## Does it hold up?

Across 16 random cities at the default settings with 30 cabs, original against enhanced:

- Pooled trips where the driver lost money: 12.7 per run down to 0.
- Drivers earn $53 more per run, and come out ahead in 15 of 16 cities.
- Riders save $45 more per run, ahead in all 16.
- Riders who actually share: 65% to 69%, and 30% to 47% with 60 cabs.
- Average wait: 21.9 s to 21.4 s. Rides completed: 149.0 to 150.7.
- The platform pays for it: its margin is about 19% lower.

## Where the code is

- `js/sim.js`: the rules (`closeTrip`, `closeJob`, `matchQueue`), the roads (`dijkstraTo`, `dist`, `nextStep`) and
  the bombs (`startThreat`).
- `js/metrics.js`, `js/report.js`: the before and after, the bomb effect and the 12-city check.
- `js/app.js`: controls, presets, live comparison and the map switch. `js/render.js`: slow-side shading and cordons.
- Tests confirm that with every enhancement off and the city made uniform again, the engine reproduces the original
  exactly, and that Dijkstra matches a brute-force search.
