# PoolSim: Uber Pool simulator, enhanced

A browser simulation of Uber Pool: riders and cabs on a 50 × 50 street grid, at most 2 riders per cab, 1 seat per
rider. Two cities run side by side with the same riders and cabs: one with pooling, one without.

This repo builds on the given prototype. The original logic is kept; five enhancements are added on top, each with an
on/off switch in the sidebar.

## Run

Double-click `start.bat`, or open `index.html` in a browser. No server, no install.

Tests: `node test/sim.test.js` (Node 18+).

## The problem with the original

1. **Drivers lost money by pooling.** Pay is per second with a rider aboard, so time with two riders is paid once, not
   twice. Example: two 20 s trips pay $14.00 solo, but $11.81 pooled. About 70% of pooled trips paid the driver less
   than the same riders would have solo.
2. **Discount wasted.** Every pool rider got the full 30% off even if nobody joined them (about 40% of them).
3. **Matching avoided pooling.** A pool rider went to an empty cab whenever it was slightly cheaper, so few riders
   actually shared when cabs were plentiful.
4. **Pickup driving is unpaid but costs fuel.** With a higher running cost, drivers could end the day below zero.

## What I changed

| # | Enhancement | What it does |
|---|---|---|
| 1 | Driver paid per rider | When a pooled trip ends, the driver gets at least what each rider would have paid as a solo trip. The platform pays the difference. |
| 2 | Dynamic premium X | X is no longer fixed at 25%. After each pooled trip it is updated to the break-even value + 5 points (limit 0–100%). |
| 3 | Full discount only if matched | Pool riders pay 20% off upfront. If they actually shared, they get refunded up to the full 30% at drop-off. |
| 4 | Pool-first matching | A pool rider joins a cab already on a pool trip unless that costs over 20 seconds more than an empty cab. |
| 5 | Pickup cover | If a trip (pickup drive + ride) pays the driver less than its running cost, the platform pays the difference. |

Turn off 1, 2, 3 and 5 and set pool-first to 0, and the simulation is exactly the original (checked by a test).

## Results

Average of 16 random cities, default settings, original → enhanced:

| | 15 cabs | 30 cabs | 60 cabs |
|---|---|---|---|
| Pooled trips paying driver less than solo | 11 → 0 | 16 → 0 | 12 → 0 |
| Driver earnings after costs | +$90 | +$96 | +$85 |
| Pool riders who actually shared | 88% → 87% | 60% → 67% | 29% → 47% |
| Savings of riders who shared | same | +$26 | +$94 |
| Average wait, rides completed | same | same | same |
| Platform margin | −$62 | −$17 | +$27 |

Pickup cover (#5) pays nothing at the default running cost ($0.05/block). At $0.30/block, the original leaves 5–27
drivers below zero per run; with the cover, none.

Trade-off: riders who never get matched pay a little more (20% off instead of 30%), still less than solo.

After each run, the report has a section "What the enhancements changed" that reruns the same city with the original
rules and shows the before/after.

## Tried and dropped

| Idea | Why dropped |
|---|---|
| Batch matching (Hungarian algorithm) | No improvement: requests arrive about one at a time. |
| Moving idle cabs to empty areas | Cut waits 15–23%, but drivers drive empty at their own cost (−$29 with 60 cabs). |
| Holding pool riders 5–20 s for a match | More sharing, but longer waits and fewer rides. |
| Widening the ping radius over time | Longer waits, up to 10 fewer rides in busy cities. |

## Code changes

| File | Change |
|---|---|
| `js/sim.js` | New settings and `ORIGINAL_RULES`. `closeTrip()` applies #1 and #2, `closeJob()` applies #5, fares changed for #3, `matchQueue()` changed for #4. |
| `js/metrics.js` | `ruleStats()` and `originalRules()` for the before/after; per-rider floor added to the earnings breakdown. |
| `js/report.js` | New "What the enhancements changed" section; other text updated for the new rules. |
| `js/app.js`, `index.html`, `styles.css` | Enhancements controls in the sidebar, a row of live tiles, extra info on cab hover. |
| `test/sim.test.js` | 8 new tests (24 total), including "all off = original engine" against `test/original/sim.js`. |
| `start.bat` | Opens the app in the default browser. |

## Assumptions

- No traffic: travel time = distance ÷ speed. Demand is random and uniform, as in the original.
- Every driver accepts every request offered to them.
- Whether a rider opts in to Pool doesn't change with the new discount rule.
- The platform, not riders, pays for #1 and #5.
- Payments from #1 and #5 are made when a trip ends, so a trip still running at the end isn't settled yet.
