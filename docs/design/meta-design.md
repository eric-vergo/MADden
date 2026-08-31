# MADden — Meta-Game, Content & Presentation Design (authoritative)

Reconciliation notes: module paths follow docs/design/architecture.md
(`src/meta/*`, `src/save/*`, `src/ui/*`, `src/audio/*`, `src/render/logo.ts`).
Frozen contracts: `src/meta/types.ts`, `src/save/schemas.ts`, `src/sim/types.ts`
(Ratings has 20 lowercase keys — spd acc agi str awr cth car btk elu thp tha tak
hpw pbk rbk shd mcv zcv kpw kac; the archetype tables below map onto them; where
the original design said cov/blk/prs use mcv+zcv / pbk+rbk / shd+str+acc
respectively). Difficulty has FOUR levels: rookie, pro, allPro, allMadden.
RNG: use `Rng` + `hashSeed` from src/sim/rng.ts — sub-seed convention
`hashSeed(leagueSeed, "roster", teamId)`, `hashSeed(leagueSeed, "sim", gameId)`.

## 1. League

16 teams, 2 conferences (Atlantic, Pacific) × 2 divisions (North, South) × 4.
League = "CFA" (Continental Football Association); championship = Apex Bowl.
Fixed canonical 16 identities (data/teams.ts):

| Id | City | Nickname | Primary | Secondary | Motif |
|----|------|----------|---------|-----------|-------|
| ASH | Ashford | Aviators | #1B3A6B | #E8B93E | wing |
| BAY | Bayport | Barracudas | #0E7C86 | #C0C7CE | fang |
| COB | Cobalt City | Comets | #2244CC | #F2F2F2 | orbit |
| DUN | Dunmore | Drifters | #5B4A8A | #D9D3C2 | chevron |
| EMB | Emberton | Emperors | #8A1C1C | #E8B93E | crest-stripes |
| FAI | Fairhaven | Firehawks | #D34E24 | #26211E | wing |
| GRA | Grandview | Gladiators | #7A1F3D | #B8B8B8 | initial |
| HAR | Harborview | Hammerheads | #4A6FA5 | #12213A | fang |
| IRO | Ironvale | Icebreakers | #7FB3D5 | #1F2A36 | peak |
| JUN | Junction City | Jackrabbits | #6B4F2A | #EDE3CF | chevron |
| KIN | Kingsport | Kodiaks | #3E2723 | #C89B3C | claw |
| LAK | Lakemont | Leviathans | #123A5C | #3FB8AF | fang |
| MER | Meridian | Monarchs | #5C2D91 | #F0A500 | star |
| NOR | Northgate | Nighthawks | #22252B | #9B111E | wing |
| OAK | Oakcrest | Outlaws | #2F2F2F | #A6192E | star |
| PAL | Palisade | Pioneers | #8C5A2B | #243E5F | peak |

Conference/division assignment: ASH BAY COB DUN = Atlantic North; EMB FAI GRA
HAR = Atlantic South; IRO JUN KIN LAK = Pacific North; MER NOR OAK PAL =
Pacific South. Field green ≈ #3A7D2C/#357029 stripes — no mid-green primaries.
Jersey conflict rule: if two primaries have hue delta < 40° AND lightness delta
< 25%, away team renders in secondary as jersey base.

Logos (render/logo.ts): 64×64 offscreen canvas, LogoSpec grammar (frozen in
meta/types.ts): frame (shield/circle/hexagon/diamond/roundel) filled frameColor
with 3px accent stroke; motif path fn (~10–20 canvas commands) centered at 60%
scale — bolt zigzag, star, chevron ×N, wing (mirrored quad-curve blades), fang
(downward triangles), claw (3 arcs), peak (mountain), orbit (ellipse ring +
dot), crest-stripes, city initial fillText, shield-in-shield. Cache
Map<teamId, canvas>; draw scaled (96px select / 20px HUD / 16px standings).

## 2. Rosters (meta/league.ts + data/ratings.ts)

40 players/team: QB2 RB3 WR5 TE2 OL7 DL6 LB6 CB4 S3 K1 P1 (matches the depth
plan in tests/harness/fixtures.ts). Base defense 4-3; nickel swaps 3rd LB for
CB3. KR = highest spd+agi among {RB2,RB3,WR3,WR4,WR5}; PR = second (TeamRoster.returners).

Archetype primary attributes (roll near group mean; non-primary floor 40–65):
QB tha thp awr spd agi · RB spd acc agi str car cth btk elu · WR spd acc agi cth
awr elu · TE cth rbk pbk str spd · OL pbk rbk str awr agi · DL shd str tak acc
hpw · LB tak shd mcv zcv spd awr hpw · CB mcv zcv spd acc agi awr · S zcv mcv
tak spd awr hpw · K/P kpw kac awr.

Generation (rng = Rng(hashSeed(leagueSeed,'roster',teamId))):
1. Team tier: roll 75 + gauss·6 per team, then rank all 16 and linearly remap
   onto [66..86] preserving order (+jitter) — guarantees good/bad teams.
2. Position-group means: clamp(base + gauss·4, 55, 92).
3. Per-slot: target = groupMean − k·dropoff + gauss·3 (dropoff QB8 RB5 WR4 TE6
   OL3 DL4 LB4 CB5 S5); primary attrs = clamp(round(target + gauss·4), 40, 99);
   non-primary 40–65.
4. Stars: 1–2 per team (+1 top tier); boost a starter's primaries +8..14 and one
   signature attr to 93–99; league-wide guarantee ≥6 players with an attr ≥93.
Ages: QB 22–38, RB 21–30, others 21–34. Jersey pools: QB 1–19, RB 20–39, WR
10–19/80–89, TE 80–89/40–49, OL 50–79, DL 90–99/60–79, LB 40–59/90–99, CB
20–39, S 20–49, K/P 1–9 (unique per team).

Names (data/names.ts): ~110 first names (Aaron, Andre, Antoine, Austin, Blake,
Brandon, Bryce, Caleb, Cameron, Carl, Cedric, Chase, Chris, Cole, Colin,
Cordell, Curtis, Damon, Dante, Darius, Darnell, DeAndre, Dennis, Derek, Devin,
Dexter, Dominic, Donte, Dwayne, Eli, Elijah, Emmett, Evan, Ezra, Felix, Gabe,
Garrett, Grant, Hakeem, Hank, Hector, Hugo, Isaiah, Ivan, Jabari, Jamal, Jared,
Jasper, Javon, Jerome, Jonah, Jordan, Julius, Kareem, Keenan, Kelvin, Kendall,
Khalil, Kyle, Lamont, Landon, Levi, Lionel, Logan, Lucas, Malcolm, Marcel,
Mario, Marshall, Mason, Maurice, Micah, Miles, Mitchell, Nate, Nico, Noah, Omar,
Orlando, Oscar, Otis, Paul, Preston, Quentin, Quincy, Rashad, Reggie, Rex,
Ricardo, Roman, Ronnie, Roy, Ruben, Russell, Santiago, Saul, Sean, Silas,
Simeon, Spencer, Sterling, Tariq, Terrence, Theo, Tobias, Trent, Trevon, Tucker,
Victor, Vince, Wade, Warren, Xavier, Zane) × ~130 last names (Abernathy, Alston,
Ashworth, Banks, Barrow, Beaumont, Bellamy, Blackwood, Boone, Bowers, Brantley,
Briggs, Calloway, Carmichael, Carver, Chastain, Coleman, Colvin, Crawford,
Crenshaw, Cross, Dalton, Deveraux, Dillard, Donovan, Draper, Driscoll, Dunbar,
Easley, Eastwood, Ellsworth, Fairbanks, Fallon, Farrow, Finch, Fontaine,
Forsythe, Foster, Gainey, Galloway, Garner, Gentry, Goodwin, Granger, Greaves,
Gresham, Hale, Halloran, Hargrove, Harmon, Hawthorne, Hayes, Hendrix, Holloway,
Holt, Huxley, Ingram, Irons, Jarvis, Jennings, Keating, Kemp, Kendrick, Kincaid,
Lachlan, Landry, Langston, Larkin, Latimer, Ledger, Lockhart, Lowery, Maddox,
Marlow, Mercer, Merritt, Monroe, Montgomery, Mosley, Nash, Newsome, Northcutt,
Oakes, Ormond, Osborne, Pemberton, Pennington, Presley, Quimby, Radcliffe,
Rainey, Ramsey, Redmond, Renner, Rhodes, Ridley, Rockwell, Rowan, Saldana,
Satterfield, Sexton, Shepard, Slade, Stanton, Steele, Stokes, Sutton, Talley,
Tanner, Thackery, Thorne, Tillman, Trask, Truitt, Vance, Vaughn, Wexley,
Whitaker, Whitfield, Wilder, Winslow, Woodard, Wren, Yardley, York, Zeller).
BLOCKED_FULL_NAMES set (~40 famous NFL exact combos); re-roll on collision or
league duplicate (20 tries then middle initial).

## 3. OVR formulas (weights sum 1.0; compute once, cache)

QB .30tha .20thp .25awr .10spd .10agi .05acc · RB .25spd .15acc .20agi .10str
.15car .15btk (elu folded into agi weight ok) · WR .28spd .15acc .15agi .30cth
.12awr · TE .35cth .25(rbk+pbk)/2 .20str .12spd .08awr · OL .45(pbk+rbk)/2
.30str .15awr .10agi · DL .35shd .30str .20tak .15acc · LB .28tak
.20(mcv+zcv)/2 .17shd .20spd .15awr · CB .35(mcv·.7+zcv·.3) .25spd .15acc
.15agi .10awr · S .30(zcv·.7+mcv·.3) .25tak .25spd .20awr · K/P .55kac .35kpw
.10awr.
Team: OFF = QB1·.30 + RB1·.12 + avg(WR1..3)·.25 + TE1·.08 + avgOLstarters·.25;
DEF = avgDLstarters·.35 + avgLBstarters·.25 + avg(CB1,CB2)·.25 + avg(FS,SS)·.15;
OVR = round(.5·OFF + .45·DEF + .05·K). Color ramp: ≥85 gold, 78–84 green,
70–77 white, <70 gray.

## 4. Season (meta/schedule.ts, standings.ts, playoffs.ts)

14 games / 14 weeks / no byes; 8 games per week. Per team: 6 divisional (circle
method over each division's 4 teams: 3 rounds ×2, then H/A flipped), 4
sister-division (Latin square: team i vs team (i+w) mod 4, home if (i+w) even),
4 inter-conference (division pairing rotates by seasonIndex). Interleave:
[D1, C1, I1, D2, C2, I2, D3, C3, I3, D4, C4, I4, D5, D6]. gameId
"S{season}-W{week:02}-{AWY}@{HOM}". Property tests: every team 14 games, 7H/7A,
no double-booking, valid weekly perfect matchings.

Standings sort: win% → head-to-head (exactly-2 tie only) → division win% →
point diff → hashSeed coin flip. (Ties impossible in playoffs; regular season
ties allowed if config.allowTies.)

Playoffs: per conference 2 division winners (seeds 1–2) + 2 wildcards; W15
semis 1v4, 2v3; W16 conference championships; W17 Apex Bowl (neutralSite=true).
Eliminated user: SIM WEEK advances one round per press.

Week flow (meta/seasonState.ts pure reducer): user plays (or SIM MY GAME with
confirm) → SIM WEEK quick-sims remaining → standings/stats update → week++.
After W14 compute seeds → playoffs. After Apex Bowl: champion + awards (MVP =
max 2·passTD + passYds/25 + 6·(rushTD+recTD) + (rushYds+recYds)/10) → new
season (same identities, new rosters from hashSeed(leagueSeed,'season',n+1),
age+1 cosmetic).

## 5. QuickSim (meta/quickSim.ts) — seeded per gameId

Edges (OVR points): passOff = .45·QB1 + .30·avg(WR1..3,TE1) + .25·avgOL;
rushOff = .50·RB1 + .50·avgOL; passDef = .40·avg(CB1,CB2,FS,SS) + .35·avgDL +
.25·avgLB; rushDef = .50·avgDL + .35·avgLB + .15·SS. form = gauss·4 + (home &&
week<17 ? 1.5 : 0). edge = .58·passEdge + .42·rushEdge.
Possessions: 10 + int(0..2) per team. Per possession: pTD = clamp(.20 +
edge·.011, .04, .48); pFG-attempt = clamp(.15 + edge·.003, .08, .22) (made by
kac-mapped .72–.97 distance bucket); pTO = clamp(.11 − edge·.004, .04, .20);
else punt. Drive yards: TD 62+gauss·12 (min 25); FG 48+gauss·14; TO 16+gauss·12;
punt 20+gauss·13. TD = 7 (2% missed XP → 6). Tie → weighted OT coin
(pWin = clamp(.5 + (edgeA−edgeB)·.02, .25, .75)), winner +3, ot=true.
Box synthesis: passShare = clamp(.58 + (passEdge−rushEdge)·.006, .45, .72);
QB1 gets passYds, att = yds/(6.9 + passEdge·.05), comp% = clamp(.55 + tha·.0022
+ passEdge·.002, .48, .72); INT split .58 of TOs. Rush: RB1 62% / RB2 26% / QB
12%. Receiving: WR1 .30 WR2 .21 WR3 .13 TE1 .17 RB1 .12 WR4 .07; rec = yds/(11
+ spd·.04). Defense: teamSacks = clamp(round(1.5 − oppPassEdge·.12 + gauss), 0,
7) 50% to best DL; INTs to CB/S by coverage; 55–70 team tackles spread LB-heavy.
K: FGA/FGM + XPs. Team: totalYds, TOs, synthesized 3rd downs + TOP. Calibration
shared with engine via data/balance.ts CALIBRATION; validate: 100 seasons →
mean pts ≈ 23, +10 OVR ≈ 75–80% win.

## 6. Stats

GameStats/PlayerGameStats/TeamGameStats frozen in sim/types.ts; sim/stats.ts
accumulates from SimEvents (PLAY_RESULT primarily); quickSim fabricates the same
shapes with simmed=true. Season aggregation into PlayerSeasonStats keyed by
athleteId. Leaders: Pass Yds/TD, Rush Yds/TD, Rec Yds/TD, Tackles, Sacks, INTs,
FG Made — top 10, user team highlighted.

## 7. Persistence

Frozen: save/schemas.ts + storage.ts. Save after every completed game/sim-week
and on hub entry; beforeunload flush. No mid-game saves — quit confirm warns.

## 8. Screens (ui/) — keyboard only

FocusManager grid/list nav (arrows/WASD move focus, Enter confirm, Esc back,
Q/E tabs); 3px focus outline pulse; bottom key-legend strip every screen.
ScreenManager = stack (push/pop/replace).

1. Title: league logo, "PRESS ENTER" (unlocks AudioContext), any key → menu.
2. Main Menu: Exhibition / New Season / Continue Season (if save) / Settings +
   save summary footer.
3. Team Select: 4×4 team cards (logo, city+nickname, OVR/OFF/DEF, color bar)
   grouped by division; right panel top-3 stars with signature attr. Exhibition:
   pick away then home. Esc backs one pick.
4. Difficulty select (+ quarter length on season create): rookie/pro/allPro/
   allMadden with one-line descriptions.
5. Season Hub tabs: Overview (next-game card, PLAY GAME / SIM MY GAME / SIM
   WEEK — disabled until user game resolved — other matchups w/ results),
   Schedule (user 14 games, Enter → box score), Standings (4 division tables,
   L/R conference toggle), Leaders (L/R categories), Bracket (playoffs).
6. Settings: volumes (master/sfx/crowd 0–10), default difficulty, quarter length
   3/5/7 (default 5), coverage hints auto/on/off, key reference, reset save
   (double-confirm).
7. Play-call (in-game DOM overlay): left formation list, right 3×2 play cards
   with procedural mini route diagrams (60×48 canvas drawn FROM play data:
   O/X dots, route polylines with arrowheads in team secondary, run arrows);
   C = Ask Coach (dims all but 3 situation-appropriate suggestions); play clock
   visible; expiry = delay of game.
8. Pause: Resume / Timeout / Settings / Restart (exhibition) / Quit (confirm).
9. Penalty prompt: name/team/yards + computed ACCEPT/DECLINE outcome lines
   (from PendingPenaltyDecision), L/R + Enter, auto-pick better after 8s.
10. Halftime stats: team comparison (yds, pass/rush, 3rd down, TOP, TOs) + 3
    leaders per team.
11. Game summary: final + quarter line score, comparisons, player tables
    (Tab OFF/DEF/ST), Player of the Game, → hub/menu.
12. Champion screen: confetti in team colors, Apex Bowl result, awards, new
    season / menu.

## 9. HUD (canvas, bottom-anchored)

Scoreboard strip ~55% width 44px: [logo] AWY 14 ●●○ | Q2 04:32 | HOM 21 ●●●
[logo] + possession football icon. Left: "2nd & 7 · BALL ON HOM 34". Right:
play clock (red pulse ≤5). Coverage hint (rookie/pro or setting): "COVERAGE:
MAN?" above strip 2s after huddle break, accuracy 55% + QB awr·0.4%. Post-play
yardage popup at spot (+7 green / −3 red, rise+fade 0.8s). Ticker line above
strip, typewriter ~40 chars/s. Big-play banners full-width slab, team colored,
1.4s: TOUCHDOWN / FLAG ON THE PLAY (yellow) / TURNOVER / FIELD GOAL IS GOOD /
SACK / FIRST DOWN (small) / TWO-MINUTE WARNING / HALFTIME / FINAL.

Ticker templates (game/PlayByPlay.ts, seeded variant pick, "F. Lastname"):
1 "{carrier} up the middle for {yds} yards." 2 "{carrier} bounces it outside
for {yds}." 3 "{carrier} stuffed at the line by {defender}." 4 "{qb} hits
{receiver} over the middle for {yds}." 5 "{qb} finds {receiver} down the
sideline for {yds} yards!" 6 "{qb}'s pass falls incomplete, intended for
{receiver}." 7 "{qb} throws it away under pressure." 8 "{qb} scrambles for
{yds} yards." 9 "SACK! {defender} drops {qb} for a loss of {yds}."
10 "INTERCEPTED! {defender} picks off {qb} at the {spot}." 11 "FUMBLE!
{defender} comes up with it for {team}." 12 "TOUCHDOWN {team}! {scorer} from
{yds} yards out!" 13 "{kicker}'s {dist}-yard field goal attempt is GOOD."
14 "{kicker}'s {dist}-yarder is NO GOOD, wide {side}." 15 "{punter} booms it
{dist} yards, downed at the {spot}." 16 "{returner} brings the kick out {yds}
yards to the {spot}." 17 "Flag down: {penalty} on {team}, {yds} yards."
18 "{team} burns a timeout. {n} remaining."

## 10. Replay UX

Trigger: PLAY_RESULT with TD || turnover || yds ≥ 40 (not kneel); letterbox
bars, "REPLAY" banner blink, 0.5× playback, 1.15× zoom on carrier path, any key
skips. Never back-to-back within 20 game-sec; disabled in final 2:00 of halves
except TDs.

## 11. Audio SFX recipes (audio/synth.ts)

whistle: 2 squares 2093Hz + ×1.01 beat, sharp attack, 0.45s, down-bend release,
bandpass 2000 Q4. hitLight: sine 90→45Hz 120ms + noise burst lowpass 300 80ms.
hitBig: + bandpass 500 Q1.2 crunch layer, +30% gain. catch: 30ms noise tick
highpass 1.2k. kickThump: sine 65Hz 150ms + 10ms click; puntThump 55Hz longer.
menuMove: square 660 35ms. menuSelect: 660→990 60ms each. menuBack: 440→330.
menuError: 220 90ms down-bend. firstDownChime: triangles 880+1108 200ms.
touchdownFanfare: saw arpeggio C4-E4-G4-C5 70ms steps + held triad 500ms lowpass
sweep 800→3k + detuned width. fgGood: first two fanfare notes. turnoverSting:
A3+Bb3 saws 400ms lowpass 900. flag: short whistle + error layered. timeoutHorn:
square 311Hz 500ms lowpass 1k vibrato. clockWarning: soft 880 tick.
Crowd (audio/WebAudioEngine.ts): looped brown noise (leaky-integrated white) →
lowpass 500–1400Hz + 0.1Hz gain LFO ±10%; intensity 0..1 → gain .15–.9 & cutoff;
swell = 300ms attack / 4s release + bandpassed roar 1.5s; away-team big play →
dip to 0.12 for 3s. Menus: crowd off. Replays: hold.
