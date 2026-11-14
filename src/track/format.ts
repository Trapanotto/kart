import type { RaceSim, SimEntity } from '../core/types';
// Declarative, hand-authored track definition. Owner: track.
// A designer writes one `TrackDef` per track (see src/track/tracks/kleeblattTal.ts and README.md);
// `buildTrack()` turns it into a TrackRuntime (headless) plus the data the track view needs.
//
// Coordinates are world space (metres, Y up). Progress values are metres along the main path
// from the start line, or anchor strings (see `Progress`).
import type { EnvironmentDef, SurfaceType, TrackZoneKind } from '../core/types';

/**
 * A position along a path:
 * - number: metres from the start line (main path) or from the branch start (branch path);
 * - 'anchor', 'anchor+12', 'anchor-8.5': relative to a named control point;
 * - '25%': fraction of the path length.
 */
export type Progress = number | string;

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** What lines the road edge on one side. */
export type EdgeKind =
  | 'open' // nothing at the edge; a far boundary fence at `reach` keeps karts in the world
  | 'fence' // wooden post-and-rail fence (wall collider)
  | 'rail' // low wooden guard rail close to the edge (wall collider)
  | 'wall' // dry stone wall (wall collider)
  | 'hedge' // dense hedge (wall collider)
  | 'none'; // nothing at all, not even a far boundary (inside of loops, junctions)

export interface EdgeDef {
  kind: EdgeKind;
  /** Distance from the road edge to the barrier (m). Defaults per kind. */
  offset?: number;
  /** For 'open': distance from the road edge to the far boundary fence (m). Default 22. */
  reach?: number;
  /** Visual / collider height override (m), e.g. tall retaining walls at an underpass. */
  height?: number;
  /** Extra invisible collider height above the barrier (m), e.g. catch fences where karts fly off a jump. */
  catchHeight?: number;
}

export type RoadLook = 'asphalt' | 'dirt' | 'planks' | 'gravel';

export interface ControlPoint {
  /** World position of the road centre. */
  p: Vec3;
  /** Road half width (m). Interpolated smoothly between the points that define it. */
  w?: number;
  /** Banking in degrees, positive = right edge lower (leans into a right turn). Interpolated like `w`. */
  bank?: number;
  /** Surface from this point on (sticky until the next point that sets it). Default 'road'. */
  surface?: SurfaceType;
  /** Edge treatment from this point on (sticky). Default 'open'. */
  left?: EdgeKind | EdgeDef;
  right?: EdgeKind | EdgeDef;
  /** Shoulder width beyond the road edge (sticky, m). Default 2.5. */
  shoulder?: number;
  /** Render look of the road from this point on (sticky); default derived from the surface. */
  look?: RoadLook;
  /** Anchor name for `Progress` strings. */
  name?: string;
}

export interface BranchDef {
  /** Unique id; also the tag used by lap events ('branch:<id>' is not needed, just the id or `tag`). */
  id: string;
  /** Where it leaves and rejoins the main path. */
  from: Progress;
  to: Progress;
  /** Interior control points between the junctions. */
  points: ControlPoint[];
  /** Default half width (m) where the points do not set one. */
  w?: number;
  /** Seconds gained vs. the main path; computed if omitted. */
  gain?: number;
  /** 0..1 */
  risk: number;
  needsBoost?: boolean;
  /** Lap events toggle everything carrying this tag. */
  tag?: string;
  /** Initial state. Default true. */
  enabled?: boolean;
}

export type PathRef = string | undefined; // undefined / 'main' = main path, otherwise a branch id

export interface BoostPadDef {
  at: Progress;
  lat?: number;
  /** Length along the road (m), default 6. */
  length?: number;
  /** Width (m), default 3.2. */
  width?: number;
  path?: PathRef;
  /** Boost seconds (informational for the physics team, default 1.2). */
  duration?: number;
}

export interface RampDef {
  at: Progress;
  /** Ramp length along the road (m), default 7. */
  length?: number;
  /** Lip height (m), default 1.2. */
  height?: number;
  lat?: number;
  /** Ramp width (m); default the full road width. */
  width?: number;
  path?: PathRef;
  /** Adds a trick zone of this length after the lip (m). Default 30. 0 = none. */
  trick?: number;
  /** Surface of the ramp face, default 'road'. */
  surface?: SurfaceType;
}

export interface ItemRowDef {
  at: Progress;
  /** Lateral positions; default spread over the road. */
  lats?: number[];
  count?: number;
  path?: PathRef;
}

export interface ZoneDef {
  kind: TrackZoneKind;
  from: Progress;
  to: Progress;
  latMin?: number;
  latMax?: number;
  path?: PathRef;
  tag?: string;
  enabled?: boolean;
}

/** A surface overlay on the road (mud, ice, sand, boost strip...). */
export interface PatchDef {
  from: Progress;
  to: Progress;
  latMin: number;
  latMax: number;
  surface: SurfaceType;
  path?: PathRef;
  tag?: string;
  /** Initial state of the tagged patch collider (lap events toggle it). Default true. */
  enabled?: boolean;
}

/** Bridge / overpass: the road is a deck here, the terrain below is not shaped to it. */
export interface DeckDef {
  from: Progress;
  to: Progress;
  path?: PathRef;
  style: 'wood' | 'stone';
  /** Railings on both sides (wall colliders), default true. */
  rails?: boolean;
  /**
   * Prop drawn as the bridge instead of the procedural deck body and rails, centred on the deck,
   * origin = deck top (e.g. 'bridge_wood'); its 'deck' node is hidden because the road is the surface.
   */
  model?: string;
}

export interface RespawnRule {
  /** Locations in [from, to] respawn at `at` instead. */
  from: Progress;
  to: Progress;
  at: Progress;
  lat?: number;
}

export interface HillDef {
  at: Vec2;
  radius: number;
  height: number;
  /** Squash along x / z (1 = round). */
  sx?: number;
  sz?: number;
}

export interface BrookDef {
  /** Centre line [x, z, waterLevel]. */
  points: Vec3[];
  /** Water width (m). */
  width: number;
  /** Bed depth below the water level (m). */
  depth: number;
  /** Width of the sloped banks (m). */
  bank: number;
}

export interface PondDef {
  at: Vec2;
  radius: number;
  level: number;
  depth: number;
  bank: number;
}

export interface TerrainPatchDef {
  at: Vec2;
  /** Circle radius, or use `size` for a rectangle. */
  radius?: number;
  /** Rectangle [width along x, depth along z] rotated by `rot` degrees. */
  size?: Vec2;
  rot?: number;
  surface: SurfaceType;
  /** Render look: 'field' (crop rows), 'mud', 'sand', 'gravel'. */
  look?: 'field' | 'mud' | 'sand' | 'gravel';
}

export interface TerrainDef {
  /** Grid cell (m), default 3. */
  cell?: number;
  /** Margin around the paths covered by the terrain grid (m), default 90. */
  margin?: number;
  /** Base height of the valley floor. */
  base: number;
  /** Gentle tilt: height gained per metre along x and z. */
  tilt?: Vec2;
  hills: HillDef[];
  noise?: { amp: number; scale: number };
  /** Valley walls: height added beyond `radius` from `center`, reaching `height` at `radius + width`. */
  rim?: { center: Vec2; radius: number; width: number; height: number };
  brooks?: BrookDef[];
  ponds?: PondDef[];
  patches?: TerrainPatchDef[];
}

/** A logical prop name, e.g. 'tree_oak' (loaded as `prop.tree_oak`). */
export type PropName = string;

export interface PropPlacement {
  name: PropName;
  /** World [x, z] or a road-relative position. */
  pos?: Vec2;
  at?: Progress;
  lat?: number;
  path?: PathRef;
  /** Yaw in degrees (0 = model front faces +Z). With `at`, relative to the road direction. */
  rot?: number;
  scale?: number;
  /** Mirror the model left/right (e.g. a chevron sign pointing the other way). */
  flip?: boolean;
  /** Absolute Y; default: on the ground. */
  y?: number;
  /** Extra Y offset on top of the ground height. */
  dy?: number;
  /** Collision footprint for a wall collider: radius (cylinder) or [width, depth] (box). */
  solid?: number | Vec2;
  /** Height of the collider (m), default 4. */
  solidHeight?: number;
  tag?: string;
  /** Initial state of `tag` (shown + collider on). Default true. A tagged `solid` gets its own collider 'door.<tag>'. */
  enabled?: boolean;
  /** Keeps scatter away within this radius (m). Default from `solid` or 2. */
  clear?: number;
}

export interface ScatterRule {
  /** Props to pick from, with weights. */
  props: { name: PropName; weight?: number; scale?: [number, number] }[];
  /** Instances per 1000 m² before band multipliers. */
  density: number;
  /** Distance-from-road-edge bands [min, max, multiplier]; outside all bands = 0. */
  bands: [number, number, number][];
  /** Restrict to circles. */
  regions?: { at: Vec2; radius: number }[];
  /** Exclude circles. */
  exclude?: { at: Vec2; radius: number }[];
  /** Keep this far from water (m), default 1.5. */
  waterGap?: number;
  /** Max terrain slope (rise / run), default 0.7. */
  maxSlope?: number;
  /** Solid props get a trunk collider of this radius and are always placed regardless of quality. */
  solid?: number;
  /** Random yaw (default true). */
  spin?: boolean;
  seed?: number;
  tag?: string;
}

export interface HazardDef {
  type: 'sheepHerd' | 'hayRoll';
  tag: string;
  /** Sheep: where the herd crosses. Hay: start of the slope section. */
  at: Progress;
  /** Hay: end of the slope section. */
  to?: Progress;
  count?: number;
  /** Seconds per crossing cycle (sheep) or between bales (hay). */
  period?: number;
  /** Side the hazard comes from: -1 left, +1 right. */
  side?: -1 | 1;
  enabled?: boolean;
}

export interface StructureDef {
  type: 'barn';
  /** Branch the barn sits on. */
  path: string;
  /** Centre of the barn along the branch (branch-local Progress). */
  at: Progress;
  length: number;
  width: number;
  height: number;
  /** Tag of the closed doors (wall colliders, enabled while closed). */
  doorsTag: string;
  /** Prop model (front = +Z faces the entry; 'door_l' / 'door_r' children swing open). Default 'barn'. */
  model?: string;
  /** Which ends have doors (and door colliders). Default 'entry'. */
  doors?: 'entry' | 'both';
}

export interface LapEventDef {
  /** Leader lap that triggers it (1-based). */
  lap: number;
  /** Name for 'track:event' / 'track:changed'. */
  name: string;
  /** Tags to enable / disable (colliders, zones, branches, props, hazards). */
  enable?: string[];
  disable?: string[];
  /** Where it happens, for camera / audio. */
  at?: Progress;
}

/**
 * Hooks for sim behaviour that only one track needs (a rising flood, an avalanche, a
 * collapsing bridge, extra hazards). `track` is the BuiltTrack. Keep per-race state in the
 * object returned by `create`, which is called once per built track.
 */
export interface TrackScript {
  /**
   * Optional: called once at the end of buildTrack(), before any physics world exists, e.g. to
   * split or add colliders (`track.colliders`). Must be deterministic.
   */
  build?(track: any): void;
  create(track: any): {
    /** Called at race start, after the declarative reset. Return extra entities. */
    createEntities?(sim: RaceSim): SimEntity[];
    /** Called after the declarative lap events of a new leader lap were applied. */
    setLap?(lap: number, sim: RaceSim): void;
    step?(sim: RaceSim, dt: number): void;
  };
}

export interface TrackDef {
  id: string;
  name: string;
  laps: number;
  cup: number;
  /** Order inside the cup (0-based). */
  order?: number;
  environment: EnvironmentDef;
  music?: string;
  /** Visual theme, see view/themes.ts. Default 'meadow' (Kleeblatt-Tal look). */
  theme?: string;
  /** Track-specific sim logic beyond the declarative format. Headless and deterministic. */
  script?: TrackScript;
  /** Closed main loop. The first point is the start line (progress 0). */
  main: ControlPoint[];
  /** Default half width where points do not set one. */
  width?: number;
  branches?: BranchDef[];
  boostPads?: BoostPadDef[];
  ramps?: RampDef[];
  itemRows?: ItemRowDef[];
  zones?: ZoneDef[];
  patches?: PatchDef[];
  decks?: DeckDef[];
  respawn?: RespawnRule[];
  terrain: TerrainDef;
  props?: PropPlacement[];
  scatter?: ScatterRule[];
  hazards?: HazardDef[];
  structures?: StructureDef[];
  lapEvents?: LapEventDef[];
  /** Grid layout behind the start line. */
  grid?: { first?: number; rowGap?: number; lat?: number };
  /** Physics reference used for the racing line (m/s², m/s). */
  driving?: { lateralAccel?: number; brake?: number; accel?: number; topSpeed?: number };
}
