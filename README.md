# Kenya MTB Simulator v2 — NTSA Certified

> **A browser-based 3D driving simulator** that replicates the Kenya National Transport and Safety Authority (NTSA) Model Town Board (MTB) driving assessment — a pass/fail test required before a Kenya driving licence is issued.

---

## Table of Contents

1. [Overview](#overview)
2. [Technical Architecture](#technical-architecture)
3. [Road Topology & World Map](#road-topology--world-map)
4. [Training Scenarios](#training-scenarios)
5. [Implemented Features](#implemented-features)
   - [Violations Engine (22 Rules)](#violations-engine-22-rules)
   - [AI Traffic System](#ai-traffic-system)
   - [Pedestrian Simulation](#pedestrian-simulation)
   - [Parking System](#parking-system)
   - [Traffic Light System (4-Phase)](#traffic-light-system-4-phase)
   - [Lane Detection & Exit Mapping](#lane-detection--exit-mapping)
   - [Player Physics](#player-physics)
   - [Camera System](#camera-system)
   - [HUD & UI Systems](#hud--ui-systems)
   - [AI Instructor](#ai-instructor)
   - [Scoring & Assessment](#scoring--assessment)
6. [Controls (Keyboard)](#controls-keyboard)
7. [Penalty Reference Table](#penalty-reference-table)
8. [NTSA MTB Rules Encoded](#ntsa-mtb-rules-encoded)
9. [Remaining / Planned Features](#remaining--planned-features)

---

## Overview

The Kenya MTB Simulator runs entirely in a **single self-contained HTML file** (`index.html`, ~130 KB) with no build step, no backend, and no external runtime dependencies other than Three.js loaded from CDN. Opening the file in any modern browser is sufficient to run the full assessment.

| Property        | Value                            |
|-----------------|----------------------------------|
| Runtime         | Browser (HTML5 + JavaScript ES6) |
| Renderer        | Three.js r128 (WebGL)            |
| Styling         | Vanilla CSS (embedded)           |
| Started Score   | 100 points                       |
| Pass Threshold  | ≥ 60 points, destination reached |
| Grade Scale     | A ≥ 90 · B ≥ 75 · C ≥ 60 · D ≥ 50 · F < 50 |

---

## Technical Architecture

```
index.html (single file)
├── <head>          — Google Fonts, CSS design system with CSS variables
├── <body>          — 3-column grid layout (left panel | canvas | right panel)
│   ├── #topbar     — score strip, badge, real-time HUD
│   ├── #lp         — scenario list, lane exit map, route info
│   ├── #cw         — Two <canvas> elements (WebGL + 2D overlay/minimap)
│   ├── #rp         — Speedometer canvas, gear display, TL phase, AI instructor
│   └── #bp         — On-screen WASD controls, event log, action buttons
└── <script>
    ├── Constants block (C)
    ├── Three.js world builder (roads, signs, parking, environment)
    ├── AI traffic waypoint chains
    ├── Pedestrian simulation
    ├── Physics engine (player car)
    ├── Violations engine (22 checks)
    ├── Traffic light 4-phase sequencer
    ├── Lane detection & exit mapping
    ├── Camera system (3 modes)
    ├── Speedometer & minimap (Canvas 2D)
    ├── Scenario definitions (8 scenarios)
    └── Main game loop (requestAnimationFrame)
```

---

## Road Topology & World Map

The world is a fixed 300 × 300 unit model town. All coordinates below are world-space (X = East, Z = South).

### Major Roads (Dual Carriageway, 4 lanes × 3.5 m = 14 m wide)

| Road Segment       | Direction  | Centre Z/X          | Speed Limit |
|--------------------|------------|---------------------|-------------|
| EW Upper           | Eastbound ONE-WAY  | Z = −50 | 50 km/h     |
| EW Lower           | Westbound ONE-WAY  | Z = −36 | 50 km/h     |
| NS Left            | Southbound ONE-WAY | X = −70 | 50 km/h     |
| NS Right           | Northbound ONE-WAY | X = −56 | 50 km/h     |

A **raised concrete median with green verge** and yellow kerb lines separates the EW dual carriageway at Z = −43. U-turn gaps exist at X = −100, −40, −10.

### Minor Roads (Two-Way, 3 lanes × 3.2 m = 9.6 m wide)

| Road Segment       | Direction  | Centre Z/X          | Speed Limit |
|--------------------|------------|---------------------|-------------|
| Minor H (EW)       | Two-way    | Z = +30             | 30 km/h     |
| Minor V (NS)       | Two-way    | X = +40             | 30 km/h     |

Both minor roads have a **solid yellow centre line** (no crossing). Broken white lines mark overtaking zones at specified positions.

### Roundabout

| Property        | Value                         |
|-----------------|-------------------------------|
| Centre          | X = 65, Z = −43               |
| Inner radius    | 12 m                          |
| Outer radius    | 24 m                          |
| Lanes           | 4 (clockwise, 3 m each)       |
| Speed limit     | 20 km/h                       |
| Arms            | W (28 m wide), E, N, S        |

The S arm extends 50 units south to connect to the Minor H road. All arms have stop lines, yield signs, zebra crossings, and traffic lights at junction corners.

### Infrastructure & Signage

- **Traffic lights** at all major intersections and all 4 roundabout arm mouths (16+ signal sets)
- **Stop signs** — minor H road entering NS major; minor V road entering minor H
- **Yield signs** — all roundabout arm mouths; parking aisle exits
- **Zebra crossings** — at NS junction flanks (×2), all 4 roundabout arms (×4), minor H (×1), minor V (×1)
- **Keep Left mandatory signs** on EW road verges (×4)
- **No U-Turn signs** on upper EW verge (×1)
- **Warning diamond signs** on roundabout approach verges (×8)
- **Yellow kerb (no-stop zones)** along medians and central reserve
- **Zigzag no-stop markings** before stop sign stop lines

---

## Training Scenarios

| # | Name                    | Rule Focus                             | Difficulty  | AI Cars | Peds | Stall After |
|---|-------------------------|----------------------------------------|-------------|---------|------|-------------|
| 1 | Basic City Driving      | Shortest Route, lane discipline        | BASIC       | 4       | 3    | —           |
| 2 | Roundabout Navigation   | Lane Entry/Exit, Yield                 | INTERMEDIATE| 8       | 2    | —           |
| 3 | Lane Exit Mapping       | Subtraction & Addition Rules           | INTERMEDIATE| 5       | 2    | —           |
| 4 | Stop & Yield Signs      | Priority Sign Compliance               | INTERMEDIATE| 4       | 4    | —           |
| 5 | Pedestrian Crossings    | Zebra Crossing Rules                   | INTERMEDIATE| 4       | 6    | —           |
| 6 | Parking Maneuvers       | Rule 3: Parking Last Resort            | INTERMEDIATE| 3       | 2    | —           |
| 7 | Obstacle Route-Finding  | 3-Route Rule + Stall Avoidance         | HARD        | 8       | 4    | 12 s        |
| 8 | Full MTB Assessment     | All 3 Rules — Complete Test            | EXPERT      | 10      | 8    | 30 s        |

Each scenario defines:
- **startPos** and **startH** (starting world position and heading)
- **destPos** (green pulsing destination marker position)
- **speedLimit** (km/h, enforced by violations engine)
- **ai** (number of AI vehicles spawned)
- **peds** (number of pedestrians spawned)
- **stallAfter** (seconds at which a random AI vehicle stalls, 0 = never)
- **hints** (array of NTSA-certified tips shown in the AI Instructor panel)

---

## Implemented Features

### Violations Engine (22 Rules)

The `checkViolations()` function is called every animation frame and evaluates 22 independent rule checks. Each rule has a **cooldown system** (`cds` map) to prevent score hammering on the same violation.

| # | Rule                              | Trigger Condition                                               | Penalty Pts |
|---|-----------------------------------|-----------------------------------------------------------------|-------------|
| 1 | **Speeding**                      | Speed > limit × 1.08 (soft threshold)                          | 8           |
| 2 | **Red light**                     | Speed > 1.2 m/s when TL state = red, within 10 m               | 20          |
| 2a| **Amber light**                   | Speed > 1 m/s, TL amber, > 5 m before stop line                | 10          |
| 2b| **Red+Amber**                     | Speed > 1 m/s when TL is in red+amber prepare phase            | 10          |
| 3 | **Stop sign — 3-second stop**     | Failed to hold 0 km/h for 3 continuous seconds at stop sign    | 18          |
| 4 | **Yield / Give Way**              | Entered roundabout approach > 2 m/s while ring traffic present | 12          |
| 5 | **Wrong way (one-way road)**      | Heading against traffic direction on EW upper or lower         | 25          |
| 6 | **Yellow centre line crossing**   | Player position inside yellow centre line AABB                  | 25          |
| 7 | **Yellow kerb — no stopping**     | Stopped (< 0.2 m/s) inside yellow kerb AABB                    | 10          |
| 8 | **Solid white edge line**         | Speed > 1 m/s while within 0.3 m of outer road edge            | 20          |
| 9a| **Roundabout island touch**       | Distance from RDT centre < inner radius − 0.5 m                | 20          |
| 9b| **Anti-clockwise in roundabout**  | Heading dot product < −0.45 (wrong direction)                   | 25          |
| 9c| **Lane change inside roundabout** | Lane number changes while inside ring (solid line crossing)     | 15          |
| 9d| **Stopped inside roundabout**     | Speed < 0.15 m/s on ring surface, no AI blocking               | 18          |
| 10| **Wrong roundabout exit**         | Arc traversed does not match entry lane's permitted exits       | 12          |
| 11| **Pedestrian encroachment**       | Vehicle on zebra while pedestrian is on it                      | 25          |
| 11a| **Critical ped fail**            | Car on crossing area while ped present (+ 10 bonus penalty)    | 35          |
| 11b| **Overtaking at zebra**          | Overtakes stopped AI near zebra crossing                        | 20          |
| 12| **Parking gear violation**        | Wrong gear on entry/exit of parking zone                        | 15          |
| 12a| **Parking bay line collision**   | Car edge within 0.35 m of bay boundary while moving            | 20          |
| 12b| **Parking proximity**            | < 1.2 m from adjacent AI vehicle in parking zone               | 10          |
| 13| **No indicator when turning**     | Steer > 0.42 rad at speed > 2 m/s without matching signal      | 6           |
| 14| **No U-Turn zone violation**      | Sharp U-turn (steer > 0.6) inside no-U-turn radius             | 25          |
| 15| **No Entry zone**                 | Speed > 1 m/s inside a no-entry zone                           | 25          |
| 16| **AI collision (Golden Rule)**    | Distance to AI vehicle < 3.5 m                                  | 20          |
| 16a| **Too close warning**            | Distance to AI 3.5–6 m (log warning, no penalty)               | —           |
| 17| **Horn at pedestrian crossing**   | Horn activated within 12 m of a ped on/near a crossing         | 8           |
| 18| **Subtraction rule violation**    | Wrong minor road lane after leaving a major road lane           | 12          |
| 19| **Addition rule violation**       | Wrong major road lane after leaving a minor road lane           | 12          |
| 20| **Roundabout entry lane mapping** | Entered wrong roundabout ring lane for departure major lane     | 15          |
| 22| **Destination reached**          | Auto-ends session when player within 6 m of destination marker | Bonus       |

Positive feedback (score +1) is awarded for stopping for a pedestrian at a zebra crossing.

---

### AI Traffic System

- **8 waypoint chains** each covering a full loop: approach road → roundabout arm → ring arc → exit arm → return road.
- **Ring arc** waypoints are individually tuned per lane radius (lanes 1–4), with 19 waypoints per arc at 10° CW intervals, ensuring smooth lane-accurate ring traversal.
- **Smooth following distance** — each AI vehicle checks all vehicles and the player car ahead in its heading cone (`fwd 0–9 m, lat < 2 m`) and reduces desired speed accordingly.
- **AI stall system** — at the scenario's `stallAfter` time, a random non-stalled AI vehicle is flagged `stalled`, its body colour flashes amber/orange, and a log event fires. After 15–35 s the stall auto-clears.
- **Chain loop** — chains restart at `loopWpi` (index 1 for roundabout chains = x = −60) to avoid visible position reset at the off-screen z-reset at x = −130.
- AI cars have headlights (front white boxes), tail lights (red), and 4 rotating wheels.

---

### Pedestrian Simulation

- Pedestrians are each **assigned to one zebra crossing** at spawn time.
- They **wait on the pavement** and only start crossing when the nearest traffic light is **green**.
- Per-ped `waitTimer` staggers first crossing times to avoid bunching.
- Each ped has a random **skin tone** from 5 values and a unique clothing colour.
- **Walking bob** is applied (y-offset sinusoidal with session time).
- The `onCrossing` boolean is updated each frame and drives violation checks 11 and 17 and the on-screen **ped warning banner**.

---

### Parking System

Two parking zones are defined south of the Minor H road:

| Zone            | Type             | Entry Gear | Exit Gear | Position         |
|-----------------|------------------|------------|-----------|------------------|
| Sedan Diagonal  | Angle parking    | D (Drive)  | R (Reverse)| X = 67, Z ≈ 45   |
| Parallel        | Parallel parking | R (Reverse)| D (Drive) | X = −8, Z ≈ 39   |

The diagonal lot has a centre 2-way aisle with yellow dashed centre line, 5 angled bays each side. The parallel lot has 8 × 5 m bays with bay divider lines. Both lots have yield signs at aisle exits and give-way lines at the road.

Violations checked on parking zone entry and exit:
- Gear check (entry gear, exit gear)
- Adjacent vehicle proximity (< 1.2 m = fail)
- Bay line contact (< 0.35 m from boundary at speed = fail)

---

### Traffic Light System (4-Phase)

Implements the **Kenyan 4-phase traffic light cycle**:

```
RED (5 s) → RED+AMBER (1.5 s) → GREEN (5 s) → AMBER (2 s) → [repeat]
```

- All traffic light sets are controlled by a shared timer with a **per-unit offset** (`trafficLights.length × 2.8 s`) so adjacent signals are staggered.
- The **Traffic Light Phase HUD** (right panel) shows the current phase of the nearest TL set with coloured dots.
- The **sign strip pill** (`🚦`) above the 3D canvas shows the current TL state for any TL within 15 m.

---

### Lane Detection & Exit Mapping

`detectLane()` returns `{roadType, road, dir, lane}` by AABB overlap:

| Road              | Detection Method                              |
|-------------------|----------------------------------------------|
| EW Upper / Lower  | \|pos.z − roadCentre\| < halfWidth             |
| NS Left / Right   | \|pos.x − roadCentre\| < halfWidth             |
| Minor H           | \|pos.z − MIN_H_Z\| < MIN_W / 2               |
| Minor V           | \|pos.x − MIN_V_X\| < MIN_W / 2               |
| Roundabout        | Distance to RDT centre within inner/outer radii|

Lane exit options are defined for major and minor roads:

```
Major road (4 lanes):
  Lane 1: left (90°), straight (0°)
  Lane 2: straight (0°) ONLY
  Lane 3: straight (0°), right (90°)
  Lane 4: right (90°), U-turn (180°), 3rd exit (270°), full circle (360°)

Minor road (3 lanes):
  Lane 1: left (90°), straight (0°)
  Lane 2: straight (0°) ONLY
  Lane 3: straight (0°), right (90°), U-turn (180°), P-turn (270°), full circle (360°)
```

**Subtraction Rule** (Maj → Min): `majorLane − 1 = minorLane`  
**Addition Rule** (Min → Maj): `minorLane + 1 = majorLane`

The **Lane Exit Map** panel (left panel, bottom) updates every frame to highlight the current lane with its permitted exits.

---

### Player Physics

`physicsStep()` runs every frame:

| Property          | Value / Formula                                           |
|-------------------|-----------------------------------------------------------|
| Acceleration      | 5.8 m/s² (D gear + forward key)                          |
| Braking           | 19 m/s² (Space key)                                      |
| Steering rate     | 1.85 rad/s, capped at ±0.78 rad                          |
| Speed-sensitive steer | Effective steer multiplied by `(1 − |spd|/cap × 0.45)` |
| Drag (coast)      | speed × 0.88^(dt×30) per frame                           |
| Reverse speed     | Accel × 0.6, capped at 30% of forward limit              |
| Speed limits enforced | Major 50, Minor 30, Roundabout 20, Parking 8 km/h   |
| Signal blink      | 0.48 s period, alternates MESH colour on car indicators  |
| Wheel spin        | Front/rear cylinders rotate at `speed × dt × 2.6`        |

---

### Camera System

Three camera modes, cycled with **C** or the **CAM** on-screen button:

| Mode     | Key | Description                                                    |
|----------|-----|----------------------------------------------------------------|
| FOLLOW   | C   | 12 m behind car, 6 m high; lerps with factor 0.07             |
| TOP      | C   | Directly overhead at height 48, lerps with factor 0.05        |
| HOOD     | C   | Positioned 1.6 m high, 2.5 m in front of car; hard-set, no lerp|

---

### HUD & UI Systems

| Component           | Element            | Description                                                 |
|---------------------|--------------------|-------------------------------------------------------------|
| Score strip         | `#topbar`          | Live score, violations count, elapsed time (MM:SS), speed  |
| Lane indicator      | `#ts-lane`         | Current lane ("L1", "L2", … "—")                           |
| Speedometer         | `#sc` canvas       | Analogue arc gauge drawn with Canvas 2D; colour-coded arc    |
| TL Phase panel      | `#tl-phase`        | 4 coloured dots for R, R+A, G, A phases                     |
| Gear indicator      | `#gearbox`         | R / N / D, click or keyboard 1/2/3                         |
| Signal indicators   | `#il` / `#ir`      | Left/right arrow icons; activated by Q / E                  |
| Brake indicator     | `#ib`              | Lit when Space held and speed > 0.4 m/s                     |
| Horn indicator      | `#ih`              | Lit while H held                                            |
| Sign strip pills    | `#sign-strip`      | TL state, pedestrian warning, road zone & speed, lane info  |
| Minimap             | `#oc` canvas (2D)  | Top-down 132 × 132 px map in corner; shows all entities     |
| Lane Exit Map       | `#lane-map-rows`   | Dynamically updates with current lane and permitted exits   |
| Route Info          | `#ri-panel`        | Start / Dest / Rule for current scenario                    |
| Event Log           | `#log-list`        | Timestamped event list, max 14 visible entries, newest first |
| Result Modal        | `#res-mod`         | Post-session score, violations, grade, feedback (last 8)    |
| Pedestrian banner   | `#ped-warn`        | Red warning shown when any ped is on a crossing             |
| Violation flash     | `#vf`              | Full-screen red border flash on any penalty (480 ms)        |
| Approach step       | sign strip zone    | Shows sequence "1: Select lane" → "4: Enter roundabout"     |

---

### AI Instructor

A rule-keyed response database (`AI_DB`) of 26 entries maps violation message substrings to NTSA-certified explanations. If no keyword matches, a random tip from the `HINTS` pool (16 entries) is shown. Hints rotate every 10 seconds during active gameplay via `tickHints()`.

---

### Scoring & Assessment

- **Starting score**: 100 points.
- **Penalties** are deducted immediately per violation (see table above).
- **Positive feedback**: stopping for a pedestrian awards +1 point (capped at 100).
- **Cooldown system**: each named violation has a cooldown key; re-trigger is ignored until the cooldown expires (2–8 s depending on rule).
- **Session ends** when:
  - Player reaches within 6 m of the destination marker (`endSession(true)`)
  - Player clicks **END SESSION** (`endSession(false)`)
- **Grade**: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 50, F < 50.
- **PASS** = destination reached AND score ≥ 60.

---

## Controls (Keyboard)

| Key           | Action                      |
|---------------|-----------------------------|
| W / ↑         | Accelerate (requires D gear)|
| S / ↓         | Reverse (requires R gear)   |
| A / ←         | Steer left                  |
| D / →         | Steer right                 |
| Space         | Brake                       |
| Q             | Toggle left indicator       |
| E             | Toggle right indicator      |
| H             | Horn (hold)                 |
| C             | Cycle camera mode           |
| 1             | Gear → Reverse (R)          |
| 2             | Gear → Neutral (N)          |
| 3             | Gear → Drive (D)            |

On-screen button equivalents exist for all controls for touch/pointer input.

---

## Penalty Reference Table

| Constant                | Points | Violation                            |
|-------------------------|--------|--------------------------------------|
| `SPEEDING`              | 8      | Exceeding posted speed limit         |
| `RED_LIGHT`             | 20     | Running a red or red+amber light     |
| `WRONG_WAY`             | 25     | Against one-way road / no U-turn     |
| `WRONG_GEAR`            | 15     | Wrong gear entering/exiting parking  |
| `NO_SIGNAL`             | 6      | Missing indicator when turning       |
| `YLW_KERB`              | 10     | Stopped on yellow no-stop kerb       |
| `RDT_LANE_CHG`          | 15     | Lane change inside roundabout        |
| `NO_STOP`               | 18     | Failed 3-second stop at STOP sign    |
| `COLLISION`             | 20     | Collision with AI vehicle            |
| `YLW_LINE`              | 25     | Crossed yellow centre line           |
| `NO_YIELD`              | 12     | Failed to yield at roundabout entry  |
| `WRONG_LANE_EXIT`       | 12     | Wrong lane at road transition        |
| `PED_ENCROACH`          | 25     | On crossing while ped present        |
| `PED_OVERTAKE`          | 20     | Overtaking at zebra crossing         |
| `PED_HORN`              | 8      | Horn near pedestrian crossing        |
| `SOLID_LINE_CROSS`      | 20     | Crossed solid white edge line        |
| `NO_YIELD_PED`          | 15     | Did not yield to pedestrian          |
| `CONT_WHITE_CROSS`      | 20     | Crossed continuous white line        |

---

## NTSA MTB Rules Encoded

The three NTSA Model Town Board driving rules are fully encoded:

### Rule 1 — Shortest Route
- Destination-based scenario routing; the 3-scenario hierarchy is: shortest route first → next shortest route → parking (last resort only).
- Enforced via AI stall events triggering re-routing (Scenario 7 & 8).

### Rule 2 — Lane Discipline
- **Major road (4 lanes)**: lane exit table enforced on roundabout exits via arc sweep angle.
- **Minor road (3 lanes)**: same exit logic, Power Lane (L3) has 5 options.
- **Subtraction rule** (Maj→Min): `lane − 1`, encoded as `{4:3, 3:2, 2:1}`.
- **Addition rule** (Min→Maj): `lane + 1`, encoded as `{1:2, 2:3, 3:4}`.
- **Roundabout entry map**: Maj L1/L2 → RDT outer lanes; Maj L3/L4 → inner lanes.

### Rule 3 — Parking (Last Resort)
- Angle parking: Forward (D) in, Reverse (R) out.
- Parallel parking: Reverse (R) in, Forward (D) out.
- Farthest bay first (instruction in scenario hints).
- 1 m clearance from bay lines and adjacent vehicles enforced.

---

## Remaining / Planned Features

The following features are partially implemented or not yet started:

### Road & World
- [ ] **Pedestrian traffic light phase** — pedestrians currently cross on any green TL, but a dedicated pedestrian phase (green man / red man) is not implemented; the red-light crossing rule is enforced as a rule but ped movement is green-light-gated rather than ped-phase-gated.
- [ ] **School zone** — `C.SPD_SCHOOL = 20/3.6` constant defined but no physical school zone or signs placed in the world.
- [ ] **No-entry zones** — `noEntryZones` array and violation check (#15) are implemented but no zones are actually placed in any scenario (`buildNoEntrySign()` exists but is commented out).
- [ ] **Central reserve U-turn gaps (visual)** — logic gates (`yieldSigns` with `isUTurnGap:true`) exist at X = −100, −40, −10 but no visible U-turn signs or painted road markings are rendered at those positions.
- [ ] **Solid white centre line on major road arms** — outer solid edge lines exist; inner lane dividers use broken white (correct), but some arm configurations lack explicit no-lane-change solid lines between carriageways.
- [ ] **Additional road environment** — no petrol station, bus stop, school, hospital, or market zone is defined, though NTSA MTB may reference these as waypoints.

### Violations & Scoring
- [ ] **No-overtaking zone enforcement** — broken vs solid overtaking segments on minor roads are visually built, but no active violation checks distinguish overtaking vs non-overtaking sections.
- [ ] **Solid line crossing on minor two-way road** — the `SOLID_LINE_CROSS` penalty constant exists; check #8 only covers the major road outer edge. Crossing the yellow centre of minor roads fires `YLW_LINE` (rule #6) but not `SOLID_LINE_CROSS`.
- [ ] **U-turn gap yield** — yield signs at central reserve gaps (`isUTurnGap:true`) are pushed to `yieldSigns[]`, but the `checkViolations` yield check only processes `isRoundabout:true` signs and ignores U-turn gap signs.
- [ ] **Roundabout signal compliance** — the AI instructor mentions "Signal RIGHT entering roundabout, signal LEFT before exit" but no automated signal check enforces this in `checkViolations`.
- [ ] **Following distance positive feedback** — the Golden Rule distance is checked for violations; there is no positive-feedback score event for maintaining adequate following distance.

### AI & Simulation
- [ ] **NS road AI traffic** — `AI_CHAINS` only define EW and roundabout routes; no AI vehicles travel the NS major roads (left southbound / right northbound).
- [ ] **Minor V road AI** — only Minor H road (Z = 30) has an AI chain. Minor V road (X = 40) has none.
- [ ] **Pedestrian traffic density scaling** — peds are evenly distributed across all zebras; there is no per-zebra density weight or time-of-day variation.
- [ ] **AI signalling** — AI vehicles have indicator meshes but these are never activated; AI does not signal before turning or entering the roundabout.
- [ ] **AI horn** — no horn sound or visual for AI vehicles.

### UI & UX
- [ ] **Audio system** — no sound effects (engine, horn, tyre squeal, TL beeping). `hornTrigger()` triggers violation checks but plays no audio.
- [ ] **Mobile responsive layout** — the UI is designed for desktop (250 px left/right panels, canvas centre). No responsive breakpoints or touch-optimised layout exist for phone screens.
- [ ] **Night mode / time of day** — the scene uses a fixed daytime ambient + directional light. No night mode or headlight illumination is implemented.
- [ ] **Session replay / recording** — no mechanism to record or replay a session's path and events.
- [ ] **Instructor voice-over** — AI instructor text exists but no speech synthesis (Web Speech API) is connected.
- [ ] **Persistent high-score / progress storage** — no `localStorage` or IndexedDB usage; session results are lost on page reload.
- [ ] **Multiple car colours / player name** — `buildPlayerCar()` accepts a colour parameter (defaults to `0x1166ee`) but there is no UI to choose it.

### Assessment & Reporting
- [ ] **Detailed score breakdown PDF/print** — the result modal shows the last 8 feedback items; no full session export or printable report is generated.
- [ ] **Per-rule sub-scores** — total violations count is shown, but no breakdown by rule category (speed, signals, signs, pedestrians, etc.).
- [ ] **Instructor review mode** — post-session replay overlay showing where each violation occurred on the minimap.
