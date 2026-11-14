// Module registry: the ONLY place where implementations are chosen.
// Each team replaces the stub on ITS OWN lines with its real factory and touches nothing else.
// Signatures are fixed by src/core/types.ts.
import type {
  EnvironmentDef,
  App, AssetLibrary, CameraRig, GameRenderer, InputSource, Kart, KartController, PhysicsSystem, QualitySettings,
  RaceConfig, RaceSim, RenderContext, SimSystem, TrackMeta, TrackRuntime, View,
} from '../core/types';
import { createStubPhysics } from '../stubs/stubPhysics';
import { createKeyboardInput, createStubAI, createStubRules } from '../stubs/stubSystems';
import { createStubAssets, createStubCamera, createStubEntityView, createStubKartView, createStubRenderer, createStubTrackView } from '../stubs/stubRender';
import { createTestTrack } from '../stubs/testTrack';
import { setFallbackEntityView } from '../core/entityViews';
import { createRaceRules } from '../race'; // [gameplay]
import { createItemSystem } from '../items'; // [gameplay]
import { createAI } from '../ai'; // [gameplay]
import { createPhysics, loadRapier } from '../physics'; // [physics]
import { createInputSources } from '../input'; // [physics]
import { createChaseCamera } from '../camera'; // [physics]
import { createRenderer } from '../render/renderer'; // [render]
import { preloadEnvironment } from '../render/environment'; // [render]
import { createAssets, createKartView, raceAssets } from '../actors'; // [actors]
import { loadTrack, trackList } from '../track'; // [track]
import { createTrackView } from '../track/view/trackView'; // [track]
import { createUI } from '../ui'; // [ui]
import { createAudio } from '../audio'; // [ui]

setFallbackEntityView(createStubEntityView);

export interface Modules {
  // [physics] vehicle physics, input devices, camera
  createPhysics(track: TrackRuntime, config: RaceConfig): Promise<PhysicsSystem>;
  createInputSources(): InputSource[];
  createCameraRig(ctx: RenderContext): CameraRig;
  // [track] track data, runtime and visuals
  trackList(): TrackMeta[];
  loadTrack(id: string): Promise<TrackRuntime>;
  createTrackView(track: TrackRuntime, ctx: RenderContext): Promise<View>;
  // [render] renderer, lighting, post-processing, vfx
  createRenderer(canvas: HTMLCanvasElement, quality: QualitySettings, assets: AssetLibrary): GameRenderer;
  // [actors] asset library, kart + character views
  createAssets(): AssetLibrary;
  /** Logical asset names to preload before a race. */
  raceAssets(config: RaceConfig, quality?: QualitySettings): string[];
  createKartView(kart: Kart, ctx: RenderContext): View;
  // [gameplay] race rules, items, AI
  createRaceRules(): SimSystem;
  createItemSystem(): SimSystem | null;
  createAI(kart: Kart, sim: RaceSim): KartController;
  // [ui] HUD, menus, touch controls, audio. Return null to auto-start a test race.
  createUI(app: App, root: HTMLElement): { dispose(): void } | null;
  createAudio(app: App): { dispose(): void } | null;
  // [lead] loading: start downloads early, in parallel with CPU work
  /** Fetches the physics engine in the background. */
  warmPhysics(): void;
  /** Starts fetching a track's environment map. */
  preloadEnvironment(env: EnvironmentDef, quality: QualitySettings): void;
}

const testTrack = createTestTrack();

export const modules: Modules = {
  // [physics]
  createPhysics: (track, config) => createPhysics(track, config),
  createInputSources: () => createInputSources(),
  createCameraRig: (ctx) => createChaseCamera(ctx),
  // [track]
  trackList: () => trackList(),
  loadTrack: (id) => loadTrack(id),
  createTrackView: (track, ctx) => createTrackView(track, ctx),
  // [render]
  createRenderer: (canvas, quality, assets) => createRenderer(canvas, quality, assets),
  // [actors]
  createAssets: () => createAssets(),
  raceAssets: (config, quality) => raceAssets(config, quality?.tier),
  createKartView: (kart, ctx) => createKartView(kart, ctx),
  // [gameplay]
  createRaceRules: () => createRaceRules(),
  createItemSystem: () => createItemSystem(),
  createAI: (kart, sim) => createAI(kart, sim),
  // [ui]
  createUI: (app, root) => createUI(app, root),
  createAudio: (app) => createAudio(app),
  // [lead]
  warmPhysics: () => { void loadRapier().catch(() => {}); },
  preloadEnvironment: (env, quality) => preloadEnvironment(env, quality),
};
