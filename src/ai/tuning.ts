// Every AI tuning knob in one place. Owner: gameplay.
// These will be retuned once the real vehicle physics lands; the driver reads actual speed,
// heading and slip, so most values are about style, not about the physics model.
import type { Persona } from '../core/types';

export const AI = {
  /** Look-ahead distance for steering: base + perSpeed * speed, clamped (m). */
  look: { base: 6, perSpeed: 0.4, min: 8, max: 24 },
  /** Proportional steering gain on the heading error (rad -> steer). */
  steerGain: 2.3,
  /** Low-pass on the steering output (1/s); keeps the wheel human. */
  steerSmooth: 14,

  /** Comfortable lateral acceleration used to plan corner speeds (m/s^2), scaled by skill. */
  latAccel: 17,
  /** Braking deceleration assumed when planning (m/s^2). */
  brakeDecel: 13,
  /** How far ahead corner speeds are planned (m). */
  scanAhead: 80,

  drift: {
    /** Minimum turn angle within the window ahead to start a drift (rad). */
    minAngle: 0.55,
    window: [6, 44] as [number, number],
    minSpeed: 15,
    /**
     * Only drift corners whose tightest radius is below this (m). The physics drift arc spans
     * about 10.5 m (steer inside) to 30 m (steer outside); wider bends are faster gripping.
     */
    maxRadius: 26,
    /** Release when less than this turn angle remains in the next 18 m (rad). */
    releaseAngle: 0.14,
    /** Abort if the heading error grows beyond this (rad). */
    abortError: 0.9,
  },

  /** Thinking interval (s): tactical decisions, perception. Lerp from 0 skill to 1 skill. */
  think: [0.32, 0.08] as [number, number],
  /** Steering noise amplitude at skill 0 (scaled by 1 - skill). */
  steerNoise: 0.22,
  /** Line noise: lateral wander amplitude at skill 0 (m). */
  lineNoise: 1.6,
  /** Mistakes per second under pressure at skill 0. */
  mistakeRate: 0.35,
  mistakeTime: [0.35, 0.8] as [number, number],

  overtake: { ahead: 16, latClear: 2.3, offset: 2.9, hold: 1.2 },
  defend: { behind: 9, share: 0.45 },
  hazard: { look: 42, clearance: 1.9 },
  /** Probability to notice a hazard at skill 0 / skill 1. */
  notice: [0.45, 0.95] as [number, number],
  /** Lateral attraction toward item boxes when the slot is empty (max m off the line). */
  boxPull: 3.5,

  /** Rubber band: top-speed multiplier vs. gap to the player (m). Capped and mild. */
  band: { maxUp: 0.05, maxDown: 0.035, gapFull: 140 },
  rival: { skillBonus: 0.08, maxUp: 0.07, maxDown: 0.05, gapFull: 60 },

  stuck: { speed: 2, time: 1.3, reverse: 1.1, respawnAfter: 7, minProgress: 6 },
  /** Start boost: AI presses the throttle this long before GO, with skill-scaled jitter (s). */
  start: { press: 0.85, jitter: 0.7, earlyChance: 0.25 },
  trick: { chance: [0.35, 0.95] as [number, number] },
};

export interface PersonaStyle {
  /** How eagerly items are thrown at targets (0..1). */
  aggression: number;
  /** Prefers keeping holdable items behind as protection. */
  holdsBehind: boolean;
  /** Seconds an item is kept before it is used anyway. */
  maxHold: number;
  /** Lateral aggressiveness when overtaking (m added). */
  overtakeBias: number;
  /** Multiplier on mistake rate. */
  nerves: number;
  /** Uses boosts only on straights (true) or whenever (false). */
  patientBoost: boolean;
}

export const PERSONAS: Record<Persona, PersonaStyle> = {
  attacker: { aggression: 0.9, holdsBehind: false, maxHold: 7, overtakeBias: 0.4, nerves: 1, patientBoost: true },
  defender: { aggression: 0.45, holdsBehind: true, maxHold: 25, overtakeBias: 0, nerves: 0.7, patientBoost: true },
  steady: { aggression: 0.6, holdsBehind: true, maxHold: 12, overtakeBias: 0, nerves: 0.5, patientBoost: true },
  hothead: { aggression: 1, holdsBehind: false, maxHold: 2, overtakeBias: 0.8, nerves: 1.8, patientBoost: false },
};
