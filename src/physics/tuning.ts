// Kart physics tuning. Owner: physics.
// All feel numbers live here so they can be tuned in one place (sandbox/physics.html).
import { KART } from '../core/data';
import type { CharacterDef } from '../core/types';

export const PHYS = {
  /** World gravity (m/s²). Higher than real for snappy arcade jumps. */
  gravity: 20,

  // --- body ---
  /** Kart + driver mass (kg) = massBase + massPerWeight * char.weight. */
  massBase: 170,
  massPerWeight: 30,
  /** Centre of mass height above the kart origin (ground). */
  comHeight: 0.38,
  /** Chassis collider: rounded box. Half extents include the rounding radius. */
  chassisHalf: { x: 0.62, y: 0.3, z: 0.98 },
  chassisRound: 0.18,
  chassisCentreY: 0.58,

  // --- suspension ---
  wheelRadius: 0.3,
  /** Wheel mount points in kart space (+X = left, +Z = forward). */
  wheelX: 0.56,
  wheelZFront: 0.66,
  wheelZRear: -0.62,
  mountY: 0.68,
  /** Distance from mount to wheel centre: fully extended / bump stop. */
  suspMax: 0.5,
  suspMin: 0.16,
  /** Static sag fraction of travel. Spring rate is derived from it. */
  sagLength: 0.38,
  dampingRatio: 0.55,
  bumpStopRate: 6,

  // --- engine ---
  /** Acceleration at standstill = (accelBase + accelPerStat * accel) * class. v' = A (1 - (v/V)^2). */
  accelBase: 11.5,
  accelPerStat: 1.8,
  /** Top speed factor = speedBase + speedPerStat * speed (3 → 1.0). */
  speedBase: 0.946,
  speedPerStat: 0.018,
  brakeDecel: 30,
  reverseAccel: 12,
  reverseMax: 9,
  coastDecel: 2.2,
  /** Pull back to top speed when faster (after boosts, entering offroad). */
  overspeedDecel: 7,
  /** Extra pull per unit of surface drag. */
  dragDecel: 22,
  /** Boost acceleration up to the boosted top speed. */
  boostAccel: 42,

  // --- steering (grip) ---
  /** Minimum turning radius at walking speed (m). */
  minRadius: 3.2,
  /** Max yaw rate (rad/s) at low and at top speed, handling 3. */
  yawLow: 2.4,
  yawHigh: 1.3,
  /** How fast the yaw rate follows the target (1/s). */
  yawResponse: 11,
  /** Lateral grip: max sideways acceleration (m/s²) on tarmac. */
  latGrip: 52,
  /** Speed lost per m/s² of lateral acceleration above `scrubFree` (fraction per second). */
  scrubFree: 20,
  scrubRate: 0.3,
  /** Yaw authority in the air, fraction of ground yaw. */
  airYaw: 0.18,

  // --- drift ---
  hopSpeed: 3.0,
  /** Drift arc radius (m) with steering fully outside / fully inside, at drift stat 3. */
  driftWide: 30,
  driftTight: 10.5,
  driftMaxYaw: 2.7,
  /** Body angle relative to the velocity while drifting (rad). */
  driftSlip: 0.36,
  driftMinSpeed: 7,
  /** Charge seconds needed for tier 1, 2, 3. */
  driftTiers: [0.55, 1.3, 2.3] as const,
  /** Mini-turbo seconds per tier (at drift stat 3). */
  driftBoost: [0, 0.6, 1.05, 1.6] as const,

  // --- boosts ---
  boostPower: KART.boostPower,
  padBoost: 1.1,
  trickBoost: 0.85,
  slipstreamBoost: 1.0,
  slipstreamPower: 1.2,
  slipstreamTime: 2.0,
  slipstreamRange: 18,

  // --- stability ---
  /** Self-righting stiffness on the ground / in the air (1/s). */
  rightGround: 9,
  rightAir: 4.5,
  tiltDamping: 3,

  // --- collisions ---
  wallScrub: 0.3,
  wallBounce: 2.2,
  kartBump: 3.2,
};

/** Character-derived numbers, computed once per kart. */
export interface KartStats {
  mass: number;
  topSpeed: number;
  accel: number;
  yawLow: number;
  yawHigh: number;
  grip: number;
  driftRadiusScale: number;
  driftBoostScale: number;
  hitScale: number;
}

export function kartStats(c: CharacterDef, classSpeed: number): KartStats {
  return {
    mass: PHYS.massBase + PHYS.massPerWeight * c.weight,
    topSpeed: KART.topSpeed * (PHYS.speedBase + PHYS.speedPerStat * c.speed) * classSpeed,
    accel: (PHYS.accelBase + PHYS.accelPerStat * c.accel) * classSpeed,
    yawLow: PHYS.yawLow * (0.88 + 0.04 * c.handling),
    yawHigh: PHYS.yawHigh * (0.85 + 0.05 * c.handling),
    grip: 0.9 + 0.035 * c.handling,
    driftRadiusScale: 1.12 - 0.04 * c.drift,
    driftBoostScale: 0.76 + 0.08 * c.drift,
    hitScale: (1.24 - 0.08 * c.tough) * (c.quickRecover ? 0.6 : 1),
  };
}
