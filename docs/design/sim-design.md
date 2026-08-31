# MADden — Football Simulation & AI Design (authoritative)

Reconciliation note: where this doc says `src/core/...` read `src/sim/...`; the
attribute names are the lowercase keys in `Ratings` (src/sim/types.ts): spd acc
agi str awr cth car btk elu thp tha tak hpw pbk rbk shd mcv zcv kpw kac.
Difficulty params and most tuning constants already live in `src/data/balance.ts`
(MOVE, BLOCK, PASS, TACKLE, MOVES, COVERAGE, QB_AI, KICK, PENALTY, DIFFICULTY,
CALIBRATION) — use them; add missing ones locally with `// TODO(balance)`.
Simplest-that-feels-like-Madden choices are marked [SIMPLE-BY-CHOICE].

## 1. Field & units

Yards; x ∈ [0,53.33] lateral, y ∈ [0,120] long; goal lines y=10 and y=110; hashes
x=23.583/29.75 (constants.ts). Each possession has attack dir +1|-1 (attackDir in
GameState, swapped at quarter ends). Plays are authored in a NORMALIZED frame
(offense drives +y, x offset from ball, +x = offense right); one
`toWorld(vec, dir, ballSpot)` transform mirrors both axes when dir === -1 —
nothing outside a single transform module thinks about direction.

Spotting: dead-ball spot = forward-progress high-water mark of carrier y·dir over
the final 30 ticks (FORWARD_PROGRESS_WINDOW_TICKS). Lateral: keep x within
hashes, else snap to nearest hash. Touchbacks: KO → own 30; punt/INT into EZ →
own 20. Chains: new series lineToGain = ballY + 10·dir (goal line caps it →
"Goal"). First down iff progress spot ·dir ≥ lineToGain·dir.

## 2. Play data model

See frozen schemas in src/sim/types.ts (FormationDef, OffensivePlayDef,
DefensivePlayDef, Route, RouteWaypoint, OffAssignment, DefAssignment, GapId,
ZoneName, ManTarget). Routes are DATA (waypoints), never code. Zones are landmark
points + radius + depth band [SIMPLE-BY-CHOICE], resolved at snap from LOS + hash
position by a table (data/zones.ts), e.g. deepThird-L = {x: ball.x−13, y: LOS+18,
radius 9, minDepth 12}.

## 3. Playbook content (data agent)

Offensive formations (6 + ST): I-Form (21: UC QB, FB+RB, TE, 2WR) · Singleback
(11) · Gun 2x2 (11) · Gun Trips Right (11) · Gun Empty (5 wide) · Goal Line (22:
2TE FB RB 1WR) · Punt, FG/XP, Kickoff, Kick Return, Punt Return.
Defensive (5 + ST): 4-3 · 3-4 · Nickel 4-2-5 · Dime 4-1-6 · Goal Line 5-3 ·
Punt Return, FG Block, Kickoff Coverage, Kick Return.

36 offensive plays:
Runs (10): I-Form HB Dive (A-gap, FB leads) · HB Iso (B-gap) · HB Toss (pitch
edge, pulling G) · FB Dive · Singleback Inside Zone · Outside Zone Stretch ·
HB Counter (backside G pulls) · Gun Inside Zone · Gun HB Draw · QB Sneak.
Quick (7): Gun Slants · Double Hitches · Quick Outs · Gun Stick (Trips) ·
Gun Spacing · Empty Quick Flood · Goal Line Fade.
Medium (8): Curl-Flat · Gun Mesh (crossers rub) · Levels · Smash (corner over
hitch) · Trips Sail/Flood · Drive (shallow + dig) · Y-Cross · Empty Digs.
Deep (5): Four Verticals · Trips Verts Switch · PA Deep Post · PA Deep Cross
(max protect) · Sluggo Shot.
PA/Boots (3): PA Boot Right (flat+crosser+comeback) · PA FB Leak · PA Toss Shot.
Screens (3): HB Slip Screen · WR Bubble (Trips) · WR Tunnel.

18 defensive plays: 4-3 Cover 3 Sky · 4-3 Cover 2 · 4-3 Cover 1 · 4-3 Cover 2
Man · 4-3 Run Commit · 3-4 Cover 3 · 3-4 OLB Fire · 3-4 Cover 2 Drop-8 · Nickel
Cover 2 · Nickel Cover 3 Match · Nickel Cover 1 Robber · Nickel Double A-Gap ·
Nickel Fire Zone (edge blitz, DE drops) · Nickel Cover 0 All-Out · Dime Quarters
· Dime Cover 2 Sink · GL 5-3 Plug · GL Man Heavy.

Playbook validation vitest suite: exactly 11 assignments per side matching the
formation's roles, exactly one carrier on runs, ≤5 route-runners, progression
roles exist in the play, all waypoints in bounds.

## 4. Movement (physics/movement.ts — constants in balance.MOVE)

Per player derived: vMax = 5.4 + 4.6·(spd/99) yd/s; aFwd = 4.5 + 5.0·(acc/99);
aBrake = 12; aLat = 3.0 + 6.5·(agi/99) (turn radius = v²/aLat); sprint ×1.12
(turn radius tightens ×0.75, cut moves disabled); carrier ×0.97.
Per tick: compute vDesired; dv = vDesired − v; decompose parallel/perpendicular
to v; clamp parallel by aFwd (aBrake if slowing)·DT, perpendicular by aLat·DT;
|v| ≤ vMax. Facing = velocity heading. User: stick dir × vMax (dead zone 0.25);
no input → brake. Separation: overlapping non-engaged teammates get a small
mutual push (0.5 yd radius). No full collision physics [SIMPLE-BY-CHOICE].

AI steering (ai/steering.ts): arrive(target, slowRadius=2), pursue(target) (lead
by t* = dist/mySpeed capped 1.2s), interceptBall(flight) (sample ballistic path
at 5-tick intervals, earliest reachable sample with ball z < 2.6).

## 5. Blocking (balance.BLOCK)

Pairing: pass pro — at snap sort declared rushers into lanes by x; each
pass-blocking OL takes nearest unclaimed rusher in his lane arc (big-on-big,
inside-out C→A first). passProScan RB waits 20 ticks; leaking blitzer inside the
box → attack, else release to checkRoute. Unblocked extras are FREE (Cover 0
scary). Run block: playside-gap = nearest defender over/inside playside gap;
climb = nearest second-level LB; pull-lead = run behind line to aim gap, block
first threat; re-target if man leaves arc (>3 yd). Open field/screens: arrive
between nearest threat and carrier, engage on contact.

Engagement at ≤1.0 yd locks pair {blocker, defender, driftVel}; contest every 15
ticks: blockScore = 0.6·(pbk|rbk) + 0.4·str + gauss·8 vs shedScore = 0.6·shd +
0.4·str + gauss·8. margin > +25 PANCAKE (defender down 90 ticks); > 0 WIN (drift
0.4 yd/s blocker's way); > −15 STALEMATE (defender steers pair slowly toward
carrier); else SHED (defender bursts 0.5s toward QB/carrier; blocker stunned 20
ticks; holding check may fire, §12). Double team: +12 and double drift; extra
blocker climbs after 2 winning contests.

## 6. Passing (balance.PASS)

User throw: receiver keys 1–5 while QB has ball post-snap; tap = lob, hold ≥12
ticks then release = bullet. Throwaway (X) legal only outside the tackle box
[SIMPLE-BY-CHOICE: no grounding penalty; button disabled in pocket]. Crossing
LOS cancels throwing (QB becomes carrier; CONTROL context changes).

Target point: lead receiver — project route position at t = flightTime (iterate
twice). CPU throws add difficulty lead-error sigma.

Flight: ball {pos, z, vel, vz}, gravity 10.72. Bullet: vRel = 14 + 12·(thp/99)
yd/s, minimal arc clearing z=2.8 at LOS; auto-loft beyond range. Lob: apex 5.5 yd
→ T ≈ 2.03s + dist/45; horizontal v = dist/T capped by thp.

Accuracy scatter (2D gaussian on landing point):
sigma = (0.35 + 1.6·(1−tha/99))·(1 + airDist/45) + 0.9·pressure01 + (qbSpeed>3 ? 0.8 : 0);
lob ×1.25. Pressure = rusher within 2.5 yd or post-SHED burst.

In-flight: defenders/receivers whose intercept solution beats arrival within
reach (0.9 yd, z<2.4 standing / 3.0 jump) contest early. Rushers within 1.2 yd of
release: 6% tip → randomized cone deflection, live tipped ball, +15 catch bonus
nearest [SIMPLE-BY-CHOICE].

Catch resolution (ball z ≤ 2.4 within 1.5 yd of a player, or ground = incomplete):
candScore = cth + 30·(1 − dist/1.5) + (facing ? +10 : −15) + (intended ? +8 : 0).
Winner attempts; vs best opposing candidate: uncontested → catch if rng < 0.55 +
cth/250 (max 0.97) else DROP. Contested: diff > 20 clean CATCH/INT; 0<diff≤20 →
60% catch/INT, 25% swat, 15% drop. Defenders use min(cth, zcv|mcv) as cth.
QB hit within 6 ticks of release → sigma ×2.5 instead of fumble [SIMPLE-BY-CHOICE].
Sack = tackle of QB behind LOS with ball; strip chance ×3.5.

## 7. Run / carrier (balance.MOVES)

Mesh: QB executes drop/reverse-out; at meshTick ball transfers if back within
1.5 yd (pitch = fast low lob ≤5 yd, interceptable; bad pitch 1%). User QB
sprinting away before meshTick = keeper. CPU hole-hitting: authored path to
aimGap; from handoff to LOS+2, every 10 ticks score aim gap + neighbors
(laneWidth clear of unblocked defenders within 2.5 yd − 1.5·defendersInLaneDepth5)
and steer best; one bounce allowed. Past second level: greedy open-field — max
y·dir progress weighted by distance from two nearest pursuers; sideline use by
clock context.

User moves (active window / cooldown ticks / check): Juke 20/45 agi+elu vs tak;
Spin 25/60 agi vs tak (works vs side/behind); Stiff-arm 30/50 str+car vs tak;
Truck (sprint into contact) /40 str+btk vs tak+hpw (+fumble ×1.5); Dive one-shot
2.5 yd lunge then down (QB slide = instant down, no fumble); Sprint held (+12%
speed, no moves). Moves add +15 to break score during window with correct
geometry. CPU carriers roll moves on imminent tackles (chance by difficulty).

## 8. Tackling (balance.TACKLE)

Attempt: defender within 1.2 yd (0.7 from behind), closing speed ≥ 0, carrier in
frontal arc. AI auto-attempts; user tackle button = wrap, hit-stick = +10 score,
fumble ×2, 40-tick whiff on miss.
tackleScore = tak + 0.25·hpw + momentum(±8) + angle(+6 head-on/−8 behind) + gauss·10
breakScore = btk + 0.2·str + activeMove(+15) + gauss·10.
> break+12 → BIG HIT (down at spot − skid; fumble ×2); > break → WRAP (12-tick
drag at 25% speed, progress accrues, then down); else BROKEN (tackler stumbles
30 ticks; carrier −20% speed). Gang: helpers add +10/tick finish roll, halve
drag; 2+ always finish. Fumble roll per successful tackle: p = 0.012 × mult
(bigHit ×2, truck ×1.5, sack ×3.5, ×clamp(1+(hpw−car)/60, 0.4, 2.2)); slide/
dive/kneel/OOB → 0. Loose ball: small random bounces (≤2), race, recovery within
0.6 yd + 25-tick scoop; defense always falls on it; offense may advance
[SIMPLE-BY-CHOICE: only pre-two-minute].
Dead ball: forward-progress spot on tackle; OOB at x<0.3 / >53.03; TD instant at
goal plane with possession; safety = tackled/OOB behind own goal line with
own-impetus (kick put it there → touchback instead).

## 9. Defensive AI (balance.COVERAGE + DIFFICULTY)

Fixed per-role FSM tick order. Difficulty injects DELAYS AND NOISE only.
Man: pre-snap leverage shade ±0.7 yd + cushion; post-snap backpedal holding
cushion; react to receiver velocity sampled reactionTicks ago (ring buffer;
delay drawn per-play from difficulty range minus up to 4 ticks for high mcv);
after final break → pursue with trail offset. Openness = separation.
Zone: arrive at landmark (deep zones backpedal facing QB); pattern-match nearest
eligible whose projected path enters zone; mirror within zone bounds; release on
exit. Deep zones never chase below minDepth until throw. Curl-flat squeezes curl,
breaks flat late.
Break on ball: on PASS_THROWN, defenders within 12 yd of landing abandon after
breakOnBallDelay; intercept solution beats arrival → INT attempt if zcv|mcv ≥ 80
else swat (swat wins contest = incomplete). After completion → pursuit.
Rush: lane checkpoint 1 yd behind LOS then QB; contain caps depth, mirrors QB x;
spy mirrors at 4 yd. Run defense: recognition = mesh done OR carrier crosses LOS
OR PA window expiry, delayed rng(6..14)+difficulty (+fakeTicks for PA-frozen box
defenders — this is what makes PA work); gap players constrict their gap mouth;
pursuit leads carrier toward sideline-cutoff intersection with difficulty angle
noise. Open field: two nearest go direct, others rank-assigned cutoff lanes.

## 10. Offensive AI

Route running: arrive through waypoints; atTick pacing throttles speed; sharp
break = decel ≤4 yd/s within 1 yd then snap turn (agi shortens decel); vsZoneSettle
at final WP vs zone posture (nearest defender slow + facing QB) → sit in largest
gap between two nearest zone defenders. After throw: target runs interceptBall;
others blockNearest if catch point behind them. After catch → carrier brain.

CPU QB (balance.QB_AI + DIFFICULTY; timers ×0.85 at awr≥90, ×1.15 at awr<70):
DROPPING → READING(i): dwell cpuQbReadDwellTicks per progression slot; openness =
separation + breaking-away bonus 0.5 − DEAD if any zone defender's intercept
beats ball by >6 ticks; openness ≥ threshold → THROW (lead + difficulty error).
Threshold decays 15%/read, 25% more under pressure (forced balls → organic INTs).
Exhausted → CHECKDOWN if ≥1.5 yd sep, else hold 20 ticks, re-scan once.
SCRAMBLE: pressure01 > 0.6 AND escape lane (no defender within 3.5 yd of arc)
AND spd > 75 (else 1.5 yd pocket slide). Scrambler = CPU carrier, slides when
gain secured. THROWAWAY: outside box, >3.2s, nothing open.

## 11. Special teams (balance.KICK)

Kick meter: 3-press vertical meter — press start → power fills over 50 ticks,
press locks power → accuracy marker sweeps 50 ticks, press locks accuracy; miss
distance → angular error. Pure function of ticks (rules/kickMeter.ts,
deterministic, unit-tested). CPU presses with gaussian error (difficulty).
Kickoff: from own 35, aim ±15°; dist = 45 + 30·power01·(kpw/99), hang 3.6–4.2s;
EZ → kneel (touchback 30) or return; coverage 10 lanes (contain outermost),
return wedge + nearest-threat blocks. Punt: dist = 35 + 25·power01·(kpw/99),
hang 4.3s; gunners release; returner fair-catches if nearest gunner arrival <12
ticks after ball, lets deep punts bounce; muff 1%; coverage downs grounded punt;
untouched EZ → touchback 20. Rare organic blocks: shed win in get-off window →
20% (punt) / 15% (FG) roll ≈ ≤0.7%/0.5% overall. FG/XP: 55-tick snap-hold-kick;
geometric make vs uprights (crossbar 3.33, half-width 3.083 at y=0/120); max
range 30 + 35·(kpw/99); miss → opponent at kick spot; XP from 15; 2pt from the 2.
Onside behind enableOnside flag.

## 12. Penalties (balance.PENALTY; all organic; ≤1 flag/play; target 3–6/game)

| Penalty | Trigger | Enforcement |
|---|---|---|
| False start | user pre-snap move input to lineman/aborted snap; CPU 0.6%/snap | 5 yd, replay down, dead ball |
| Offside/Encroach | defender across NZ at snap (CPU jump 1.2%, 4% vs hard count); contact pre-snap = dead | 5 yd; live offside = free play |
| Delay of game | play clock 0 pre-snap | 5 yd, replay down |
| Holding (off) | SHED margin < −25 then re-engage within 10 ticks: 20% roll | 10 yd from previous spot |
| DPI | ball in air >1 yd downfield: defender initiates contact (closing >2 yd/s) pre-arrival while not in intercept mode | spot foul, auto 1st |
| OPI | mirror check on receiver pre-arrival (pick collisions): 15% | 10 yd previous spot |

Flow: flag logged mid-play with spot; play runs to completion; PLAY_DEAD computes
withPenalty/declined branches; CPU picks by EV (down/distance/spot value table);
user prompt (auto-enforce pre-snap fouls). Half-the-distance near goal lines.
Skipped v1: facemask, roughing, grounding, block-in-back, offsetting.

## 13. CPU play-calling (ai/coach.ts)

Situation {down, toGo, yardLine, scoreDiff, quarter, secLeft, timeouts,
isTwoMinute} → bucket → tag weight table (1st&10, 2nd&short/long, 3rd&2-/3-6/7+,
red zone, goal-to-go, 2-min trailing, 4-min leading) → play within tag scored by
base + per-game EWMA yards-per-tag memory + variety penalty (−40% if called in
last 4 snaps) → softmax with difficulty temperature. Defense mirrors: situation →
shell/tag weights + user run/pass EWMA read at All-Pro+. 4th down: punt default;
FG if dist ≤ maxRange−4; go chart by difficulty. 2pt chart classic. Clock:
hurry-up trailing Q2/Q4 <4:00 (snap ~14s left); milk leading Q4 (snap ~3s);
kneel when leading and secLeft < (4−down)·41 − 41·oppTimeouts; spike when
needing score, clock running, no TOs, <0:35; defensive timeouts trailing Q4
<3:00; offensive TO to avoid delay only if Q4 and it matters.

## 14. Difficulty

See DIFFICULTY table in src/data/balance.ts. Invariant: user-side players always
run true ratings/best AI; difficulty tunes only CPU decision quality, reaction
latency, execution noise. All-Madden = zero lead error + 5-tick reactions, never
stat cheating.

## 15. Testing

Rules suites (table-driven, pure — no physics): downs, scoring, clock (stoppage
matrix: runs after in-bounds tackle; stops on incomplete/score/turnover/penalty/
timeout; OOB stops-until-snap only inside 2:00 H1 / 5:00 Q4 else restart-on-ready
+12s... [SIMPLE-BY-CHOICE ok: OOB always stops <2:00 either half, else restarts];
two-minute once per half; play clock 40/25; quarter end preserves drive state;
halftime possession per deferral), overtime (10:00, both teams possess unless
first-possession... use modified sudden death: first score wins EXCEPT
first-possession FG allows answer; simplest compliant version acceptable),
penalties (spots, half-distance, EV comparator), special teams spots, turnovers
(INT/fumble flip + direction, EZ INT touchback, fumble OOB stays with fumbling
team at spot). Micro-sim suites with scripted Rng: movement (40-yd dash band,
turn radius monotone in agi), catch matrix, tackle/break rates, block
pancake/shed rates at extremes, ball flight range/hang, playbook validation.
Balance soak: tests/soak.test.ts (32 games, CALIBRATION bounds) + difficulty
monotonicity. Determinism: same seed → identical event logs + hashes.
