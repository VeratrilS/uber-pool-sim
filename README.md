# PoolSim: Uber Pool, enhanced

Uber Pool simulation in the browser: up to 2 riders per cab, 1 seat per rider. A city with pooling runs next to the same
city without it. Built on top of the given prototype.

**Run:** double-click `start.bat` (or open `index.html`). No server. **Tests:** `node test/sim.test.js`

## Enhancements (each can be turned on/off in the sidebar)

1. **Driver paid per rider:** a pooled trip never pays the driver less than the riders' solo trips would.
   Before, about 70% of pooled trips did.
2. **Dynamic premium X:** X updates after every pooled trip to the break-even value, instead of a fixed 25%.
3. **Bigger discount only if matched:** riders who actually share get 35% off (was 30%); riders who never get matched
   get 25%.
4. **Pool-first matching:** a pool rider joins a cab already carrying a pool rider unless that's 20+ s worse than an
   empty cab.
5. **Pickup cover:** if a trip costs the driver more in fuel than it pays, the platform pays the difference.

All off = original prototype (tested).

While it runs, the tiles under the maps show **enhanced vs original rules live**: the same city also runs under the original
prototype's rules in the background. After the run, the report re-checks the same settings on 12 other random cities
(drivers better off in 12/12, riders in 11/12 at the defaults), so the result isn't one lucky city.

## Incidents: random bomb threats

Set "Bomb threats" in the sidebar (default 0 = off). At a random time and place, a square cordon closes for a while,
the same in both cities:

- Cabs drive around it on the shortest open route.
- Pickups and drop-offs inside it move to its edge.
- Drivers are paid for empty detours around it.

The report counts threats, riders caught, and stops moved.

## Results (16 random cities, 30 cabs)

- Pooled trips where the driver loses money: 16 → 0
- Drivers: +$88 per run. Riders: +$32 saved per run. (Same direction with 15 and 60 cabs.)
- Pool riders who actually share: 60% → 67% (29% → 47% with 60 cabs)
- Wait times and rides completed: unchanged
- Cost: the platform's margin drops about 18% ($105 per run); that money goes to drivers and riders

## Code changes

- `js/sim.js`: the five rules (`closeTrip`, `closeJob`, fares, `matchQueue`) and bomb threats (`startThreat`, `dist`, `nextStep`)
- `js/metrics.js`, `js/report.js`: original vs enhanced on the same city, plus the 12-city check (`validatePoint`)
- `js/app.js`, `index.html`, `styles.css`: sidebar controls and live tiles
- `test/sim.test.js`: 11 new tests (27 total); `start.bat`: launcher
