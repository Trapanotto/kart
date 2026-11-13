// Module registry: the ONLY place where implementations are chosen.
// Each team replaces the stub on ITS OWN lines with its real factory and touches nothing else.
// Signatures are fixed by src/core/types.ts.
import type {
  App, AssetLibrary, CameraRig, GameRenderer, InputSource, Kart, KartController, PhysicsSystem, QualitySettings,
  RaceConfig, RaceSim, RenderContext, SimSystem, TrackMeta, TrackRuntime, View,
} from '../core/types';
import { createStubPhysics } from '../stubs/stubPhysics';
import { createKeyboardInput, createStubAI, createStubRules } from '../stubs/stubSystems';
import { createStubAssets, createStubCamera, createStubEntityView, createStubKartView, createStubRenderer, createStubTrackView } from '../stubs/stubRender';
import { createTestTrack } from '../stubs/testTrack';
import { setFallbackEntityView } from '../core/entityViews';

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
  raceAssets(config: RaceConfig): string[];
  createKartView(kart: Kart, ctx: RenderContext): View;
  // [gameplay] race rules, items, AI
  createRaceRules(): SimSystem;
  createItemSystem(): SimSystem | null;
  createAI(kart: Kart, sim: RaceSim): KartController;
  // [ui] HUD, menus, touch controls, audio. Return null to auto-start a test race.
  createUI(app: App, root: HTMLElement): { dispose(): void } | null;
  createAudio(app: App): { dispose(): void } | null;
}

const testTrack = createTestTrack();

export const modules: Modules = {
  // [physics]
  createPhysics: async () => createStubPhysics(),
  createInputSources: () => [createKeyboardInput()],
  createCameraRig: (ctx) => createStubCamera(ctx),
  // [track]
  trackList: () => [testTrack.meta],
  loadTrack: async () => createTestTrack(),
  createTrackView: (track, ctx) => createStubTrackView(track, ctx),
  // [render]
  createRenderer: (canvas, quality, assets) => createStubRenderer(canvas, quality, assets),
  // [actors]
  createAssets: () => createStubAssets(),
  raceAssets: () => [],
  createKartView: (kart, ctx) => createStubKartView(kart, ctx),
  // [gameplay]
  createRaceRules: () => createStubRules(),
  createItemSystem: () => null,
  createAI: () => createStubAI(),
  // [ui]
  createUI: () => null,
  createAudio: () => null,
};
