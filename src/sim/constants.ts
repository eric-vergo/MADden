// Field & timing constants. World units are YARDS; time is fixed 60Hz ticks.
// Coordinate system: x = lateral, [0, FIELD_W] (0 = left sideline when attacking +y).
// y = long axis, [0, FIELD_L]: y=0 back of home end zone, y=10 home goal line,
// y=110 away goal line, y=120 back of away end zone.

export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ; // seconds — the only dt the sim ever uses

export const FIELD_W = 53.333;
export const FIELD_L = 120;
export const CENTER_X = FIELD_W / 2;

export const GOAL_HOME_Y = 10; // home end zone goal line (home defends low y)
export const GOAL_AWAY_Y = 110;

// NFL hashes: 18'6" apart, centered.
export const HASH_LEFT_X = 23.583;
export const HASH_RIGHT_X = 29.75;

// Goal posts (back of end zone): crossbar height & width in yards.
export const CROSSBAR_HEIGHT = 3.33;
export const GOALPOST_HALF_WIDTH = 3.083;

export const GRAVITY = 10.72; // yd/s^2 (9.8 m/s^2)

export const PLAY_CLOCK_SEC = 40;
export const PLAY_CLOCK_SHORT_SEC = 25; // after administrative stops
export const TWO_MINUTE_SEC = 120;
export const OT_LENGTH_SEC = 600;
export const TIMEOUTS_PER_HALF = 3;

export const KICKOFF_SPOT_FROM_OWN_GOAL = 35; // kicking team's own 35
export const TOUCHBACK_KICKOFF_YD = 30; // receiving team ball on own 30
export const TOUCHBACK_OTHER_YD = 20; // punts / INTs into the end zone
export const XP_SNAP_FROM_GOAL_YD = 15; // XP snapped from the 15 (33-yd kick)
export const TWO_POINT_FROM_GOAL_YD = 2;

// Forward progress: high-water mark window (ticks) before the dead-ball event.
export const FORWARD_PROGRESS_WINDOW_TICKS = 30;

// Replay ring buffer capacity (ticks): ~25s covers any play plus pre-snap.
export const REPLAY_BUFFER_TICKS = TICK_HZ * 25;
