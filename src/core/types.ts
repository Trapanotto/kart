// THE CONTRACT. Every module talks to the others only through the types in this file.
// Owner: lead. Do not change existing members; additive, optional members are allowed
// if you document them in your final report.
//
// Conventions
// - Units: metres, seconds, radians, kilograms. Y is up, right-handed (three.js default).
// - A kart's local axes: +Z forward, +Y up, +X LEFT (glTF convention).
// - `steer`, `lat` and every other signed sideways value: positive = RIGHT.
// - Simulation runs at a fixed SIM_HZ and must stay deterministic for a given seed
//   and input sequence: no Math.random() and no wall-clock time inside the sim,
//   use `sim.rng` and `sim.time`.
// - Sim code imports math classes from 'three' only (never 'three/webgpu', never DOM),
//   so it runs headless in Node for tests.

import type { Object3D, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const GRID_SIZE = 8;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export type CharacterId =
  | 'sloth' | 'sheep' | 'redpanda' | 'hedgehog' | 'penguin' | 'capybara' | 'otter' | 'axolotl';

export type Persona = 'attacker' | 'defender' | 'steady' | 'hothead';

/** Stats are 1..5. */
export interface CharacterDef {
  id: CharacterId;
  name: string;
  animal: string;
  color: string;
  persona: Persona;
  speed: number;
  accel: number;
  handling: number;
  drift: number;
  weight: number;
  tough: number;
  perk: string;
  /** Full grip on ice. */
  iceGrip?: boolean;
  /** Recovers faster from hits. */
  quickRecover?: boolean;
}

export interface SpeedClass {
  id: 'easy' | 'normal' | 'turbo';
  name: string;
  /** Multiplier on kart top speed and acceleration. */
  speed: number;
  /** AI skill 0..1. */
  ai: number;
}

export type SurfaceType = 'road' | 'offroad' | 'ice' | 'boost' | 'sticky' | 'sand' | 'water' | 'wall';

export interface SurfaceProps {
  /** Lateral grip multiplier, 1 = tarmac. */
  grip: number;
  /** Top-speed multiplier while driving on it without a boost. */
  speed: number;
  /** Rolling drag, 0 = none. */
  drag: number;
}

export interface Pose {
  pos: Vector3;
  quat: Quaternion;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface InputState {
  /** 0..1 */
  throttle: number;
  /** 0..1; also reverses when nearly stopped. */
  brake: number;
  /** -1 (left) .. +1 (right) */
  steer: number;
  /** Hop + drift button held. */
  drift: boolean;
  /** Item button held. Release-to-fire logic lives in the item system. */
  item: boolean;
  /** -1 = use item backwards, +1 = forwards, 0 = default for the item. */
  itemAim: -1 | 0 | 1;
  lookBack: boolean;
}

/** One physical way of producing input (keyboard, gamepad, touch). */
export interface InputSource {
  /** Called once per rendered frame. Write into `out`; return false if this source is idle. */
  poll(out: InputState): boolean;
  /** Edge-triggered UI intents since the last call, e.g. pause. */
  consumePause?(): boolean;
  dispose?(): void;
}

/** Decides a kart's input each sim step (human player or AI). */
export interface KartController {
  update(kart: Kart, sim: RaceSim, dt: number): void;
}

// ---------------------------------------------------------------------------
// Track
// ---------------------------------------------------------------------------

/** Orthonormal frame of the road at one point. */
export interface TrackFrame {
  pos: Vector3;
  forward: Vector3;
  right: Vector3;
  up: Vector3;
  /** Half width of the drivable road here (m). */
  halfWidth: number;
}

export interface TrackLocation {
  /** 0 = main path, >0 = a branch (shortcut / alternative route). */
  path: number;
  /** Distance along the main path this position counts as, 0..length. Used for ranking. */
  progress: number;
  /** Signed sideways offset from the path centre, positive = right (m). */
  lat: number;
  /** Half width of the road at this point (m). */
  halfWidth: number;
  /** Height of the kart position above the road surface (m). */
  height: number;
  /** True if |lat| <= halfWidth. */
  onRoad: boolean;
  /** Internal acceleration hint owned by the track implementation. */
  hint: number;
}

export interface TrackCollider {
  id: string;
  /** 'ground' is drivable and ray-cast by wheels; 'wall' blocks karts. */
  kind: 'ground' | 'wall';
  surface: SurfaceType;
  /** xyz triples, world space. */
  vertices: Float32Array;
  indices: Uint32Array;
  /** Disabled colliders must be ignored. Toggled by lap events; see 'track:changed'. */
  enabled: boolean;
}

export interface ItemBoxSpot {
  id: number;
  pos: Vector3;
  up: Vector3;
}

export type TrackZoneKind = 'trick' | 'cannon' | 'glide' | 'respawn' | 'slipstreamOff';

/** A volume on the track that triggers a rule while a kart is inside. */
export interface TrackZone {
  kind: TrackZoneKind;
  path: number;
  /** Progress range [from, to] on the main path. */
  from: number;
  to: number;
  /** Optional lateral range; whole width if omitted. */
  latMin?: number;
  latMax?: number;
  /** Cannon: landing pose and flight time. */
  target?: Pose;
  duration?: number;
  enabled: boolean;
}

export interface TrackBranch {
  path: number;
  /** Where the branch leaves and rejoins the main path (progress). */
  from: number;
  to: number;
  /** Which side it leaves on: -1 left, +1 right. */
  side: -1 | 1;
  /** Seconds gained (positive) vs. the main path when driven cleanly. */
  gain: number;
  /** 0..1, how hard it is to drive. AI uses this with its skill. */
  risk: number;
  /** Needs a boost to pay off (e.g. offroad cut). */
  needsBoost?: boolean;
  enabled: boolean;
}

export interface EnvironmentDef {
  /** File under public/assets/env/, without extension handling. null = procedural sky. */
  hdr: string | null;
  skyTop: string;
  skyHorizon: string;
  /** Direction TO the sun, normalised. */
  sunDir: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  ambientIntensity: number;
  fogColor: string;
  fogDensity: number;
  /** Named weather / particle preset, e.g. 'petals', 'rain', 'snow'. */
  weather?: string;
  exposure?: number;
}

export interface TrackMeta {
  id: string;
  name: string;
  laps: number;
  cup: number;
  environment: EnvironmentDef;
  music?: string;
}

export interface TrackRuntime {
  readonly meta: TrackMeta;
  /** Length of the main path (m). */
  readonly length: number;
  readonly colliders: readonly TrackCollider[];
  /** GRID_SIZE poses, index 0 = pole position. */
  readonly startGrid: readonly Pose[];
  readonly itemBoxes: readonly ItemBoxSpot[];
  readonly zones: readonly TrackZone[];
  readonly branches: readonly TrackBranch[];
  /** Karts below this Y are out of bounds. */
  readonly killY: number;

  /** Nearest road position. Pass the previous result as `hint` for speed and continuity. */
  locate(pos: Vector3, hint?: TrackLocation, out?: TrackLocation): TrackLocation;
  /** Road frame at a progress value on a path (default main), offset sideways by `lat`. */
  sample(progress: number, lat?: number, path?: number, out?: TrackFrame): TrackFrame;
  /** Ideal line for AI: sideways offset and target speed as a fraction of top speed. */
  racingLine(progress: number, path?: number): { lat: number; speed: number };
  /** Safe pose to put a kart back on the road near a location. */
  respawn(loc: TrackLocation): Pose;

  /** Entities that belong to the track: moving hazards, destructibles. Called once per race. */
  createEntities(sim: RaceSim): SimEntity[];
  /**
   * Called when the race leader starts a lap (1-based). Applies lap events:
   * toggles colliders / zones / branches and emits 'track:changed'.
   */
  setLap(lap: number, sim: RaceSim): void;
  step(sim: RaceSim, dt: number): void;
}

// ---------------------------------------------------------------------------
// Karts
// ---------------------------------------------------------------------------

export interface WheelState {
  /** Wheel centre in world space. */
  pos: Vector3;
  /** Suspension compression 0 (extended) .. 1 (bottomed out). */
  compression: number;
  /** Accumulated spin angle (rad). */
  spin: number;
  /** Steering angle (rad), front wheels only. */
  steer: number;
  grounded: boolean;
  surface: SurfaceType;
  /** Sideways slip 0..1, for skid marks and smoke. */
  slip: number;
}

export type HitKind = 'spin' | 'tumble' | 'squash' | 'zap' | 'bump';

export interface HitOptions {
  /** 1 = normal. */
  strength?: number;
  /** Kart id that caused it, if any. */
  by?: number;
  /** World-space direction of the impact. */
  dir?: Vector3;
  /** Short item id or hazard name for HUD / audio. */
  cause?: string;
}

/** A temporary change to kart handling. Same `id` replaces the previous one. */
export interface KartModifier {
  id: string;
  /** Seconds left; Infinity = until removed. */
  time: number;
  topSpeed?: number;
  accel?: number;
  grip?: number;
  /** Steering response multiplier. */
  steer?: number;
  /** Visual scale of the kart (e.g. shrunk). */
  scale?: number;
  /** Ignores hits and offroad slowdown (star-like state). */
  invincible?: boolean;
}

/** Race bookkeeping for one kart. Owned by the race rules system. */
export interface RaceProgress {
  /** 0 before crossing the start line, then 1-based current lap. */
  lap: number;
  /** Monotonic distance: (lap - 1) * length + progress, used for ranking. */
  distance: number;
  /** 1..GRID_SIZE */
  rank: number;
  finished: boolean;
  finishTime: number;
  lapTimes: number[];
  bestLap: number;
  wrongWay: boolean;
}

/** What a kart holds. Owned by the item system. */
export interface ItemSlot {
  /** Item id, or null. */
  id: string | null;
  /** Uses left (e.g. triple items). */
  count: number;
  /** >0 while the roulette is spinning (s). */
  roulette: number;
  /** Item is held out behind the kart as protection. */
  holding: boolean;
}

export interface Kart {
  readonly id: number;
  readonly char: CharacterDef;
  readonly isHuman: boolean;

  /** Written by the controller before each physics step. */
  input: InputState;

  // --- physical state (written by physics only) ---
  pos: Vector3;
  quat: Quaternion;
  /** World-space velocity (m/s). */
  vel: Vector3;
  /** Signed speed along the kart's forward axis (m/s). */
  speed: number;
  /** Top speed right now on tarmac without boost (m/s). */
  topSpeed: number;
  grounded: boolean;
  /** Seconds since the kart left the ground, 0 while grounded. */
  airTime: number;
  surface: SurfaceType;
  wheels: WheelState[];
  /** Body roll / pitch relative to the road, for views (rad). */
  lean: number;

  drift: {
    active: boolean;
    /** -1 left, +1 right */
    dir: -1 | 0 | 1;
    /** Seconds of charge. */
    charge: number;
    /** 0 none, 1..3 spark colour tiers. */
    level: 0 | 1 | 2 | 3;
  };
  boost: {
    /** Seconds left. */
    time: number;
    /** Top-speed multiplier while active. */
    power: number;
  };
  /** >0 while the kart is out of control after a hit (s). */
  stun: number;
  stunKind: HitKind | null;
  /** Seconds of post-hit protection left. */
  invulnerable: number;
  /** Trick performed in the current jump. */
  trick: boolean;
  /** 0..1 slipstream charge behind another kart. */
  slipstream: number;
  /** Being carried (cannon, respawn hand): physics is suspended. */
  carried: boolean;
  modifiers: KartModifier[];
  /** One absorbing shield (bubble). Set by items, consumed by applyHit. */
  shield: boolean;

  // --- owned by other systems ---
  loc: TrackLocation;
  race: RaceProgress;
  item: ItemSlot;

  // --- interpolated for rendering, written by RaceSim.interpolate() ---
  renderPos: Vector3;
  renderQuat: Quaternion;
  prevPos: Vector3;
  prevQuat: Quaternion;

  // --- control API (implemented by physics) ---
  /** Returns false if the hit was absorbed (shield, invincible, invulnerable). */
  applyHit(kind: HitKind, opts?: HitOptions): boolean;
  applyBoost(duration: number, power?: number): void;
  addImpulse(impulse: Vector3): void;
  addModifier(mod: KartModifier): void;
  removeModifier(id: string): void;
  hasModifier(id: string): boolean;
  /** Instantly move the kart; zeroes velocity unless `keepSpeed`. */
  teleport(pose: Pose, keepSpeed?: boolean): void;
}

export interface KartSpawn {
  char: CharacterDef;
  isHuman: boolean;
  pose: Pose;
}

/** Implemented by the vehicle physics module. */
export interface PhysicsSystem extends SimSystem {
  addKart(spawn: KartSpawn): Kart;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export type RacePhase = 'intro' | 'countdown' | 'racing' | 'finished';

/** Anything else that lives in the race: thrown items, puddles, hazards, destructibles. */
export interface SimEntity {
  readonly id: number;
  /** Selects the view, e.g. 'item.acorn', 'hazard.sheep'. */
  readonly kind: string;
  pos: Vector3;
  quat: Quaternion;
  /** Collision sphere radius against karts (m); 0 = none. */
  radius: number;
  /** Set to true to have the sim remove the entity. */
  dead: boolean;
  /** Kart that spawned it, -1 if none. */
  owner: number;
  /** Free-form state for the view (animation phase etc.). */
  data?: Record<string, unknown>;
  step(sim: RaceSim, dt: number): void;
  /** Called when a kart's sphere overlaps `radius`. */
  onKart?(kart: Kart, sim: RaceSim): void;
}

export interface SimSystem {
  init?(sim: RaceSim): void;
  step(sim: RaceSim, dt: number): void;
  dispose?(): void;
}

export interface Rng {
  /** 0 <= x < 1 */
  next(): number;
  range(min: number, max: number): number;
  int(maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
}

export interface RaceConfig {
  trackId: string;
  speedClass: SpeedClass;
  /** Character of the human player. */
  player: CharacterId;
  laps?: number;
  seed?: number;
  mode: 'race' | 'grandprix' | 'timetrial';
  /** Grid order by character id, index 0 = pole. Filled in by the app if omitted. */
  grid?: CharacterId[];
  assists?: { autoThrottle: boolean; steerAssist: boolean };
}

export interface RaceSim {
  readonly config: RaceConfig;
  readonly track: TrackRuntime;
  readonly karts: Kart[];
  readonly entities: SimEntity[];
  readonly events: EventBus<GameEvents>;
  readonly rng: Rng;
  /** The human player's kart. */
  readonly player: Kart;
  /** Seconds of sim time since creation. */
  time: number;
  /** Seconds since the green light; negative during the countdown. */
  raceTime: number;
  phase: RacePhase;
  laps: number;
  /** Allocates a unique entity id. */
  nextEntityId(): number;
  addEntity(e: SimEntity): void;
  /** Advances one fixed step. */
  step(): void;
  /** Fills renderPos / renderQuat of all karts for a fraction 0..1 between steps. */
  interpolate(alpha: number): void;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** All cross-module events. Emit from the sim; render, audio and HUD only listen. */
export interface GameEvents {
  'race:phase': { phase: RacePhase };
  /** 3, 2, 1, then 0 = GO. */
  'race:countdown': { n: number };
  'race:lap': { kart: Kart; lap: number; lapTime: number; final: boolean };
  'race:finish': { kart: Kart; rank: number; time: number };
  /** All karts done, or timeout after the player finished. */
  'race:over': { order: Kart[] };
  'race:rank': { kart: Kart; from: number; to: number };

  'kart:hit': { kart: Kart; kind: HitKind; by: number; cause: string; absorbed: boolean };
  'kart:boost': { kart: Kart; duration: number; power: number; cause: string };
  'kart:driftStart': { kart: Kart };
  'kart:driftLevel': { kart: Kart; level: number };
  'kart:driftEnd': { kart: Kart; level: number };
  'kart:jump': { kart: Kart };
  'kart:trick': { kart: Kart };
  'kart:land': { kart: Kart; airTime: number; impact: number };
  'kart:collide': { kart: Kart; other: Kart | null; impulse: number; point: Vector3 };
  'kart:respawn': { kart: Kart };
  'kart:surface': { kart: Kart; from: SurfaceType; to: SurfaceType };
  'kart:slipstream': { kart: Kart };
  'kart:startBoost': { kart: Kart; quality: number };

  'item:box': { kart: Kart; spot: number };
  'item:got': { kart: Kart; item: string };
  'item:use': { kart: Kart; item: string };
  'item:warn': { kart: Kart; item: string; from: number };

  'entity:add': { entity: SimEntity };
  'entity:remove': { entity: SimEntity };
  /** Generic one-shot effect request, e.g. name 'burst', 'splash', 'break.hay'. */
  'fx': { name: string; pos: Vector3; dir?: Vector3; color?: string; scale?: number };

  /** A lap event changed the track. Physics must re-read collider `enabled` flags. */
  'track:changed': { lap: number; event: string };
  /** Scripted track moment for audio / camera / HUD, e.g. 'avalanche'. */
  'track:event': { name: string; pos?: Vector3 };
}

export type Listener<T> = (payload: T) => void;

export interface EventBus<E> {
  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void;
  emit<K extends keyof E>(type: K, payload: E[K]): void;
  clear(): void;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export type QualityTier = 'high' | 'medium' | 'mobile';

export interface QualitySettings {
  tier: QualityTier;
  /** Device pixel ratio cap. */
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowCascades: number;
  ao: boolean;
  bloom: boolean;
  motionBlur: boolean;
  volumetricFog: boolean;
  /** Multiplier on particle counts and scenery density, 0..1. */
  density: number;
  fur: boolean;
  /** Longest texture edge to load. */
  maxTextureSize: number;
}

/** One-shot and attached visual effects. Implemented by the renderer. */
export interface VfxApi {
  /** Named one-shot effect, e.g. 'burst', 'dust', 'splash', 'sparks', 'confetti'. */
  spawn(name: string, pos: Vector3, opts?: { dir?: Vector3; color?: string; scale?: number }): void;
}

/** Something that mirrors sim state into the scene every frame. */
export interface View {
  /** `dt` is render delta (s). Sim state has already been interpolated. */
  update(dt: number, ctx: RenderContext): void;
  dispose(): void;
}

export interface RenderContext {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly quality: QualitySettings;
  readonly vfx: VfxApi;
  readonly assets: AssetLibrary;
  /** Null in menus. */
  readonly sim: RaceSim | null;
  /** Render time in seconds, for shader animation. */
  readonly time: number;
}

export interface GameRenderer {
  readonly ctx: RenderContext;
  /** Resolves when the GPU backend is ready. */
  init(): Promise<void>;
  setEnvironment(env: EnvironmentDef): Promise<void>;
  setQuality(q: QualitySettings): void;
  /** Screen-space feel driven by gameplay: 0..1 each. */
  setFeel(feel: { speed: number; boost: number; hit: number; underwater?: boolean }): void;
  /** Attach / detach the per-race effects that listen to sim events (sparks, dust, skid marks). */
  bindSim(sim: RaceSim | null): void;
  resize(width: number, height: number): void;
  render(dt: number): void;
  /** Compiles the shaders of everything in the scene without blocking the page (loading screen). */
  precompile?(): Promise<void>;
  /** Renderer statistics for the debug overlay. */
  stats(): { fps: number; drawCalls: number; triangles: number; backend: string };
  dispose(): void;
}

export interface AssetLibrary {
  /** Preloads GLB files by logical name (see docs/ASSETS.md). Missing files are tolerated. */
  load(names: string[], onProgress?: (done: number, total: number) => void): Promise<void>;
  /** A fresh clone (skinned meshes are cloned correctly). Missing = visible placeholder. */
  model(name: string): Object3D;
  /** Animation clips that came with a model. */
  clips(name: string): import('three').AnimationClip[];
  has(name: string): boolean;
}

export interface CameraRig extends View {
  setTarget(kart: Kart): void;
  /** Camera shake impulse 0..1. */
  shake(amount: number): void;
  /** 'chase' in races, 'orbit' for intro / results. */
  setMode(mode: 'chase' | 'orbit' | 'finish'): void;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export interface RaceResult {
  config: RaceConfig;
  /** Finishing order. */
  order: { char: CharacterId; isHuman: boolean; time: number; bestLap: number }[];
}

export interface Settings {
  quality: QualityTier | 'auto';
  musicVolume: number;
  sfxVolume: number;
  autoThrottle: boolean;
  steerAssist: boolean;
  cameraShake: boolean;
  vibration: boolean;
}

/** What UI and audio get to drive the game. Implemented in src/game/app.ts. */
export interface App {
  readonly events: EventBus<GameEvents & AppEvents>;
  readonly settings: Settings;
  /** Current race, or null in menus. */
  readonly sim: RaceSim | null;
  readonly renderer: GameRenderer;
  readonly tracks: readonly TrackMeta[];
  startRace(config: RaceConfig): Promise<void>;
  setPaused(paused: boolean): void;
  readonly paused: boolean;
  restartRace(): Promise<void>;
  quitToMenu(): void;
  saveSettings(): void;
  /** Extra input source, e.g. touch controls. */
  addInputSource(src: InputSource): void;
}

export interface AppEvents {
  'app:loading': { done: number; total: number; label: string };
  'app:raceReady': { sim: RaceSim };
  'app:raceEnded': { result: RaceResult };
  'app:menu': Record<string, never>;
  'app:pause': { paused: boolean };
  'app:settings': { settings: Settings };
}
