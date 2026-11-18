# PoolSim: Uber Pool that's fair to drivers and riders

Two cities, same riders, same cabs, same bomb threat. Left: our model. Right: the one we were given.

![The enhanced model (left) and the original model (right) playing the same city, with a bomb-threat cordon closed and the slow right side shaded](docs/side-by-side.png)

Run it: open `index.html` in a browser. No server, no install.

## The problem we found

In the original prototype a driver is paid per second with someone aboard. Seconds with two riders count once.
So carrying two people together can pay less than carrying them one after the other:

```
Two riders, 20 s trip each, driver paid $0.35 per second with anyone aboard

One after the other   A ████████████████████
                      B                     ████████████████████   paid 40 s   $14.00
Together              A █████████████████████████
                      B           ████████████████████              paid 30 s   $11.81
```

That happened on 63% of pooled trips. Meanwhile every rider who opted in got 30% off even if nobody joined, and
cabs always drove an L-shaped route, even straight through the slow part of town.

## What we changed

Six enhancements, all in the sidebar under **Enhancements**. "Original rules" and "All enhancements" flip them at once.

1. **Drivers paid per rider.** A pooled trip pays at least what the riders' solo trips would have.
2. **A premium that learns.** The extra pay for two riders resets after every pooled trip to the break-even value.
3. **Sharing rewarded.** 35% off if you actually shared, 25% if nobody joined (was 30% for everyone).
4. **Pool-first matching.** A pool rider joins a cab already on a pool trip unless that's 20+ seconds worse.
5. **Pickup cover.** If a trip costs the driver more in fuel than it pays, the platform covers it.
6. **Fastest routes.** Dijkstra over the real street costs, instead of the fixed L-shaped route.

And we made the city harder, the same for both models:

- **The right side is slow.** Every street on the right half takes 25% longer (shaded on the maps).
- **Bomb threats.** A cordon closes at random for 90 s, at least once per run. Cabs route around it, riders inside
  walk to its edge, and drivers are paid for the empty detour.

## How to see it

- **Watch the maps.** Our cabs bend left to avoid the slow side; the original cabs drive straight through it.
- **Read the tiles under the maps.** They compare live against the original rules: green means better. Start with
  "Pooled trips where the driver lost money": ours stays at 0.
- **Check X** in the left map's header: it climbs from 25% to about 45% as it learns.
- **Push the fuel cost.** Set "Driver running cost" to 0.30: drivers below zero drop from 5 to 0.
- **Open the report** at the end: the full before and after, what the bomb did (on the default city, 10 riders
  delayed and 27 s of delay added), and your settings replayed on 12 other random cities.

## Does it hold up?

Across 16 random cities, default settings, 30 cabs, original against enhanced:

- Pooled trips where the driver lost money: **12.7 per run → 0**.
- Drivers earn **$53 more** per run, ahead in 15 of 16 cities.
- Riders save **$45 more** per run, ahead in all 16.
- Riders who actually share: **65% → 69%** (30% → 47% with 60 cabs).
- Waits a little shorter (21.9 s → 21.4 s), a few more rides completed (149.0 → 150.7).
- The cost: the platform's margin is about 19% lower. That money is what pays drivers and riders.

Reproduce it with `node test/compare.js`.

## Under the hood

- `js/sim.js` holds the rules (`closeTrip`, `closeJob`, `matchQueue`), the roads (`dijkstraTo`, `dist`, `nextStep`)
  and the bombs (`startThreat`).
- `js/metrics.js` and `js/report.js` build the before and after, the bomb effect and the 12-city check.
- `js/app.js` runs the controls, the presets, the live comparison and the map switch; `js/render.js` draws the slow
  side and the cordons.
- `node test/sim.test.js` runs 28 tests. Two worth knowing: with every enhancement off and the city made uniform,
  the engine reproduces the original prototype exactly; and Dijkstra matches a brute-force search on every corner.
