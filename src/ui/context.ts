// Shared state and navigation actions that screens use.
import type { App, CharacterId, RaceResult, SpeedClass, TrackMeta } from '../core/types';
import type { Nav } from './nav';
import type { Router, TransitionDir } from './router';

export type Mode = 'grandprix' | 'race' | 'timetrial';

export interface GpState {
  tracks: TrackMeta[];
  /** Index of the race being driven / just finished. */
  index: number;
  points: Record<string, number>;
  /** Points gained in the last race. */
  gained: Record<string, number>;
  results: RaceResult[];
}

export interface FlowState {
  mode: Mode;
  char: CharacterId;
  cls: SpeedClass;
  trackId: string | null;
  gp: GpState | null;
}

export interface UiCtx {
  app: App;
  router: Router;
  nav: Nav;
  state: FlowState;
  isTouch(): boolean;
  toTitle(): void;
  toMenu(dir?: TransitionDir): void;
  toChars(dir?: TransitionDir): void;
  toClasses(dir?: TransitionDir): void;
  toTracks(dir?: TransitionDir): void;
  toOptions(back: () => void): void;
  toControls(back: () => void): void;
  /** Starts a race of the current mode on a track (GP: the next cup race). */
  launch(trackId: string): void;
  startGrandPrix(): void;
  /** Quit the running race and then show a screen. */
  quitTo(target: 'menu' | 'tracks'): void;
  setTouchLayout(l: 'stick' | 'zones'): void;
}
