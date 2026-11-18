# PoolSim — two-seat ride pooling on a Manhattan grid

An early Uber Pool, simulated. K riders and N cabs on a 50 × 50 street grid, run for P seconds, in **two cities at once**:
one where riders who opt in can share a cab and one where everyone rides solo. Riders, request times and cab start
positions are identical in both, so every difference you see comes from pooling alone.

## Enhancements in this version

The original prototype already ran correctly, but its pay, pricing and matching rules let pooling hurt the people it
should help:

- **Drivers often earned less for carrying two people than for carrying them one at a time.**
- **Every rider who opted in got the full discount, even if nobody ever joined them.**
- **The matcher sent pool riders to empty cabs**, even when a cab already carrying a pool rider was nearly as good.
- **Drive to a pickup is unpaid but costs fuel**, so with higher running costs a trip, or a driver's whole shift, could
  end below zero.

This version adds five changes. Each is in the new **Enhancements** group in the sidebar, and all are on by default.
Switch the toggles off and set pool-first to 0, and the engine reproduces the original prototype exactly; a test checks
this against the original code.

### 1. Driver paid per rider carried (no loss from pooling)

**Problem.** Drivers are paid per second with someone in the car, not per rider. While two riders share the cab, that
second is paid once even though two people are being driven. Example with two 20-second trips at $0.35/s:

| | Solo (two separate trips) | Pooled |
|---|---|---|
| Time with riders aboard | 20 s + 20 s = 40 s | A aboard 0–25 s, B 10–30 s → 30 s, 15 s with both |
| Driver pay | 40 × 0.35 = **$14.00** | 30 × 0.35 + 15 × 0.35 × 25% = **$11.81** |

The driver delivered the same two people and earned $2.19 less. Under the original rules, about 70% of pooled trips
paid the driver less than the equivalent solo trips.

**Fix.** A *pooled trip* runs from the moment a cab picks up its first rider until it is empty again, with two riders
aboard at some point. When it ends, the driver is paid at least what each of its riders would have paid as a solo trip
(rate × that rider's solo estimate). The platform pays any difference; fares don't change.

**Who benefits.** Drivers: pooling never costs them money. Riders benefit indirectly: in reality, drivers who lose
money on pool requests decline them, which this simulator doesn't model (every pinged cab accepts).

### 2. Dynamic premium X

**Problem.** A fixed X is too low when detours are short and shared time is long, and wasted money in the opposite
case. The original report already worked out the break-even X for each run (`1 − detour seconds / shared seconds`),
but only *after* the run.

**Fix.** The engine learns that value live. After every pooled trip it updates a moving average of the break-even
premium, weighted by shared seconds, and sets **X = break-even + 5 pts**, clamped to 0–100%. The X slider is now just
the starting value. This uses only data a real platform has as trips finish.

**Who benefits.** Drivers earn more on pooled trips (X averages about 44–52% instead of 25%), so the pay floor in #1
is needed less often.

### 3. Full discount only if matched

**Problem.** Every pool opt-in got Y% off at pickup, even if nobody ever joined them. At the defaults, about 40% of
pool riders never shared, and in a surplus of cabs that wasted discount was larger than everything drivers earned
from the premium.

**Fix.** A pool rider pays the smaller **"discount if never matched"** upfront (default 20%). At drop-off they are
refunded up to the full Y if they actually shared the cab. This follows the natural rule: *opt in to share; if nobody
joins it's effectively a single ride; if someone joins, you get the pool discount.*

**Who benefits.** Riders who share keep exactly the same deal. Riders who never share still pay less than a solo
fare, just not the full discount. The money saved pays for #1 and #2.

### 4. Pool-first matching (the algorithm change)

**Problem.** The matcher picks whichever option has the lowest cost in rider-seconds. A pool rider is often a few
seconds cheaper to serve with an empty cab than by joining a cab already on a pool trip. The empty cab wins, the rider
rides alone, and the next request loses that free cab. With spare cabs, only 29% of pool riders ever shared.

**Fix.** For a pool rider, the best option in a cab already on a pool trip wins unless it costs more than **20
rider-seconds** over the best idle cab (the "Pool-first matching" slider; 0 = the original cheapest-wins rule). Every
hard rule is still checked on the shared option: 2 seats, the 1.5× in-car cap, pickup slip and ping radius.

**Who benefits.** Riders who opted in to pool actually get pooled, and with #3 that means they get the full discount.
The share of pool riders who shared rises from 60% to 67% at the default fleet and from 29% to 47% with spare cabs.
Waits and rides completed stay the same. Driver pay stays within 1%.

### 5. Pickup cover (no net loss for any driver)

**Problem.** A driver is paid only while a rider is aboard, but pays running cost (fuel, wear) for every block,
including the drive to the pickup. At the default $0.05/block this never bites, but the running-cost slider goes up to
$0.50. Measured over 16 cities at **$0.30/block**, the original rules leave **5–27 drivers per run below zero** after
running costs, and 36–78 trips per run cost more to drive than they paid.

**Fix.** A *job* is the drive to a pickup plus the ride, until the cab is empty again (or free, if its rider was moved
to another cab). When a job ends, if its pay (including #1) is less than its running cost, the platform pays the
difference, like a real "long pickup" fee. A cab only drives during a job, so **no driver's net ever drops below
zero**, apart from the one job still in progress when the run stops. The report counts cover already owed on that job.
It applies in both cities, because it protects drivers, not pooling.

**Who benefits.** Drivers. At the default cost it pays $0. At $0.20/block it pays $5–11 per run; at $0.30/block,
$64–124, and drivers below zero go from 5–27 to **0**. If the pay rate per block is below the running cost per block,
every trip loses money; the report then warns that the base pay rate itself needs to rise, rather than hiding it
behind the cover.

### Results (16 random cities per row, default settings unless noted, original rules → all five enhancements)

| | Shortage (15 cabs) | Default (30 cabs) | Surplus (60 cabs) |
|---|---|---|---|
| Pooled trips paying the driver less than solo | 11.2 → **0** | 15.8 → **0** | 12.1 → **0** |
| Driver earnings after running cost (fleet) | $1,094 → **$1,185** | $1,590 → **$1,686** | $1,719 → **$1,804** |
| Drivers vs the no-pool city (fleet) | +$200 → **+$290** | +$60 → **+$156** | **−$34 → +$51** |
| Pool riders who actually shared | 88% → 87% | 60% → **67%** | 29% → **47%** |
| Savings of pool riders who shared | $346 → $344 | $316 → **$342** | $173 → **$267** |
| Discount spent on riders who never shared | $30 → $20 | $157 → $85 | $337 → $159 |
| Average wait for pickup | 42.7 → 43.0 s | 17.5 → 17.7 s | 7.1 → 7.2 s |
| Riders delivered | 109.6 → 109.7 | 160.8 → 160.4 | 173.4 → 172.9 |
| Platform margin | $382 → $320 | $587 → $570 | $605 → $632 |

At the default running cost no job loses money, so #5 pays nothing in this table. See #5 for higher costs.

**Summary.**
- **Drivers gain about $85–96 per run in every regime** and never lose money on a pooled trip. In a surplus, the
  original rules left drivers as a group worse off than without pooling; that is now reversed.
- **Riders who share get more**, because more of them are matched. Riders who never share pay a bit more than before,
  but still less than a solo fare.
- **Waits and rides completed are unchanged** (within 0.3 s and half a ride).
- **The platform pays for it in a shortage** ($62 less margin) and gains in a surplus ($27 more), funded mostly by not
  paying the full discount for pooling that never happened.

The report shows this before/after for the run you just watched, in the **"What the enhancements changed"** section
near the top.

Not fixed, by design: the number of individual drivers who earn less than *their own twin* in the no-pool city barely
changes. That gap comes from which rides each cab happens to get. A real driver has no twin, so no pay rule can target
it. The report shows it for context.

### What we tried and dropped (measured, not guessed)

Each idea was prototyped and run on 8–16 random cities at 15, 30 and 60 cabs before deciding.

| Idea | Result | Why dropped |
|---|---|---|
| Optimal batch matching (Hungarian algorithm, min-cost assignment per dispatch round) | No measurable change: wait 18.4 → 18.0 s, rides completed the same | Requests arrive about one per dispatch round, so the greedy choice is already optimal. |
| Repositioning idle cabs toward empty zones | Wait −15% (30 cabs) to −23% (60 cabs) | Drivers drive empty and unpaid at their own cost: −$29 driver net with 60 cabs. Conflicts with the goal of protecting drivers. |
| Holding a pool rider 5–20 s for a co-rider | Sharing up | Waits +1 to +9 s and fewer rides completed. |
| Money-aware match cost (reward shared seconds) | Similar to pool-first | Noisier and harder to explain than pool-first. |
| Ping radius that widens the longer a rider waits | Fewer give-ups | Waits up to +6 s and up to 10 fewer rides completed in busy cities. |
| Pool-first at 30 s instead of 20 s | Slightly more sharing | Waits and driver pay drift the wrong way at the default fleet. |

### What changed in the code

| File | Change |
|---|---|
| `js/sim.js` | New config keys `driverGuarantee`, `dynamicPremium`, `matchedDiscount`, `unmatchedDiscount`, `poolFirst`, `netFloor` and the `ORIGINAL_RULES` preset. Per-cab trip tracking in `accrue`/`serveStops`, settled in a new `closeTrip()` (pay floor + break-even learning). Per-cab job tracking (`openJob`/`closeJob`) for the pickup cover. Upfront fare at the unmatched discount plus a refund at drop-off. `matchQueue` keeps the best shared option separately and applies the pool-first tolerance. `live()`/`sample()` expose X, top-ups and refunds. |
| `js/metrics.js` | Waterfall gains a "per-rider floor" step and uses the average X actually paid. New `ruleStats()` and `originalRules()`: the report re-runs the same city under the original rules, up to the same moment, for a fair before/after. |
| `js/report.js` | New "What the enhancements changed" section (original vs enhanced table plus a plain-English summary, including the share of pool riders who shared). Waterfall, facts, insights 1–2, parameter chips and the method note reflect the new rules. |
| `js/app.js`, `index.html`, `styles.css` | Enhancements group in the sidebar (toggles + sliders), a live row of enhancement tiles, X shown on the map header, hover tooltip shows each cab's extra pay from the floor and its pooled trips. |
| `test/sim.test.js`, `test/original/sim.js` | 8 new tests: all enhancements off equals the original engine exactly (run against a copy of the original `sim.js`), no pooled trip pays less than solo after the floor, pay accounting closes, X stays in 0–100%, fares follow the matched-discount rule, no driver ends a job below zero with pickup cover (at up to $0.50/block), and pool-first raises sharing while every hard rule still holds. The original pay/fare tests now run under `ORIGINAL_RULES`. |
| `start.bat` | Double-click to open the app in the default browser. No server. |

## Run it

**Windows:** double-click `start.bat`. It opens `index.html` in your default browser.

Or open `index.html` in any browser yourself. There's no build step, no install and no network access; it works from `file://`.

- **Start / Stop**: the main button. Stop pauses; settings stay locked until **Reset**. <kbd>Space</kbd> toggles.
- **Speed**: 1×–50× playback, adjustable while running.
- **Report**: opens automatically at P, or on demand whenever the run is stopped (an interim report).
- **Hover a cab**: shows its riders, how long each has been aboard, the ratio they'll arrive at against the cap, how many co-riders they've had, and how often their cab rerouted.
- **The map shows:**
  - each new request's ping radius as a diamond (the cabs inside it are the ones offered the request);
  - a cab that reroutes mid-ride, drawn with a bold route;
  - riders who give up, marked with a red ×.

Engine tests (Node ≥ 18, no dependencies): `node test/sim.test.js`

## The rules, as implemented

| Rule | How it's enforced |
|---|---|
| At most 2 passengers at a time | Each cab has a plan of upcoming pickups and drop-offs. Occupancy is checked at every point of the plan, not just now. A rider can share with several people in turn over one trip, but never two at once. |
| No one rides longer than 1.5 × the non-pool estimate | Estimate = Manhattan distance ÷ speed. Every time a plan changes, every pool rider in it is re-checked: the riders already aboard (using how long they've already ridden) and those still waiting. Routes are deterministic, so planned = actual (tested). |
| Drivers earn X% more while 2 are aboard | Pay = rate × occupied second, × (1 + X) for each second with 2 aboard. Driving to a pickup is unpaid. *Enhanced:* X is learned live (#2), and a pooled trip pays at least its riders' solo pay (#1). |
| Pool riders get Y% off | Original: upfront fare = fare rate × estimate × (1 − Y), charged at pickup, whether or not a co-rider is ever found. *Enhanced (#3):* the "discount if never matched" is charged upfront, with a refund up to Y at drop-off if the rider shared. |
| Ping radius | A request is offered only to cabs that can reach the pickup within R blocks of driving. For a busy pool cab, that counts the stops it makes first. |
| Rider patience | A rider with no match for this many seconds gives up. Once matched, they wait for their cab. |
| Pickup slip | When a cab reroutes to fit someone in, an already-promised pickup may slip by at most this many seconds. |

**Requests arrive at any time.** Matching runs every simulated second, oldest request first.

- **Solo riders** get the best idle cab in range.
- **Pool riders** can also be slotted into any pool cab in range, at any position in its remaining stops. The cab reroutes to make that happen. Every feasible slot is scored in rider-seconds:
  - the new rider's wait;
  - every extra second anyone spends in the car or waiting;
  - 0.5 × the extra cab-seconds.
- **Re-dispatch** (optional): a rider still waiting for their cab is moved to a cab that frees up much closer (it must save ≥ 8 s and ≥ 30%). Removing stops never makes anyone else later, because Manhattan distance obeys the triangle inequality.

**Driver time.** Every cab-second is classified as idle, driving empty, 1 aboard or 2 aboard. "Engaged" means the last three.

**Driver distance.** Distance is split the same way. A running cost per block gives earnings net of driving.

**The ping-radius sweep.** The report reruns the same city at radii from 2 blocks to unlimited, averaged over three random cities when that's fast enough. It recommends the tightest radius that delivers within 1% of the best.

## What the defaults show (200 riders, 30 cabs, 300 s, original rules)

*These figures come from the original prototype (all enhancements off). See "Enhancements in this version" above for the before/after.*

- **The ping radius has a sweet spot.**
  - Too tight, and riders give up before any cab is in range: 78 lost at 2 blocks.
  - With no limit, the no-pool city delivers about 20 fewer riders than at its best radius. Cabs accept distant pickups and spend the run driving empty while nearer requests wait: empty blocks per pickup roughly double.
  - Pooling tolerates a wider radius than solo (≈ 30 vs 20 blocks): a busy pool cab nearby can absorb a request.
  - In a shortage (N = 15) the best radius tightens to 12–15 blocks. In a surplus (N = 60) the radius barely matters.
- **Rerouting is real and bounded.** About 18% of pool riders had their cab reroute mid-ride, some more than once. A few shared with two different people in turn. Nobody exceeded the cap.
- **Driver time and distance shift.**
  - Pooled cabs drive about 9% fewer blocks per driver and fewer empty blocks per pickup (7.2 vs 10.0).
  - Rider-blocks delivered per cab-block rise from 0.68 to 0.77.
  - Drivers are idle more (28% vs 22%).
  - Gross pay is flat, but earnings after running costs rise.

## Three things worth thinking about

The report computes each of these from the run you just watched. Each comes with a one-click "Try" that changes one setting so you can see the effect.

1. **Y is paid on every opt-in; X is paid only on a match.** The discount cost scales with the opt-in rate, but the efficiency (and the premium) scales with the match rate. Unmatched opt-ins are pure leakage, and the platform margin falls accordingly. Match rate is a density problem (riders per cab per block), not a pricing one.

2. **Whether drivers win depends on what's scarce, not on X.** On a pooled trip, each shared second is paid once instead of twice, detour seconds are paid, and X adds a premium. The report finds the break-even X for this run's routes, then splits the change in driver earnings into a waterfall:
   - shared seconds paid once
   - detour pay
   - premium
   - **fleet effect**: pooled cabs free up sooner and serve more riders

   In a shortage drivers gain. In a surplus the same X and Y leave them idler and poorer. A fixed premium can't be right in both regimes.

3. **The 1.5× promise covers the ride, not the trip, and not equally.** Waiting time isn't covered, so some pool riders arrive later than their no-pool twin even though the cap held. The detour also falls unevenly: the rider already aboard absorbs several times the extra time of the rider who joins, for the same Y. A fairer design would bound door-to-door time against the solo option and price the detour each rider actually absorbs.

## Files

```
index.html        page shell
styles.css        light + dark themes, responsive layout
js/sim.js         engine: demand, movement, plans, insertion, re-dispatch, accounting (no DOM)
js/metrics.js     twin-city comparison, earnings decomposition, ping-radius sweep (no DOM)
js/render.js      canvas map: cabs, routes, ping radius, reroutes, give-ups
js/report.js      formatting, SVG charts, end-of-run report and insights
js/app.js         controls, run loop, live tiles, hover inspector, radius sweep in Web Workers
start.bat         Windows launcher: opens index.html in the default browser
test/sim.test.js  24 invariants: capacity along every plan, the cap, radius + slip, patience, time accounting,
                  the pay floor, pickup cover, dynamic X bounds, matched-discount fares, pool-first, all-off == original engine, …
test/original/    the original prototype's sim.js, used only by the tests
```

## Simplifications

- No traffic: travel time is distance ÷ speed, so ETAs are exact. Real pooling also has to absorb ETA error.
- Idle cabs wait where they are; there's no repositioning toward demand.
- Every pinged cab accepts. Drivers declining pool requests would shrink the effective radius.
- Demand is uniform random in space and time. Real commute corridors would raise match rates.
- A cab's plan holds at most 6 pending stops (3 riders lined up), which keeps matching fast.
- Requests late in the run may still be waiting or riding at P. They're reported, not dropped.
- Opt-in is fixed per rider. In reality a smaller discount for unmatched riders (#3) could lower the opt-in rate; try a lower opt-in % to see the effect.
- The per-rider pay floor (#1) and the pickup cover (#5) are settled when a trip or job ends, so one still in progress at P hasn't been paid yet (the report counts the cover already owed).
