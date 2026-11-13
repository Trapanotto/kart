// Tiny bridge so the UI can trigger interface sounds and voices without a hard dependency
// on the audio module. createAudio() installs the real implementations.
import type { CharacterId } from '../core/types';

export type UiSound = 'move' | 'confirm' | 'back' | 'toggle' | 'slider' | 'start' | 'error' | 'pause' | 'unpause' | 'count' | 'points' | 'trophy' | 'newRecord';

export interface AudioBridge {
  ui(sound: UiSound): void;
  voice(char: CharacterId): void;
  /** Called on every user gesture; resumes the AudioContext. */
  unlock(): void;
  /** Music of a screen when no race is running: 'menu', 'results', 'podium' or null. */
  screenMusic(name: 'menu' | 'results' | 'resultsLose' | 'podium' | null): void;
  /** Volumes in app.settings changed (live, before app.saveSettings()). */
  settingsChanged(): void;
}

export const audioBridge: AudioBridge = {
  settingsChanged() {},
  ui() {},
  voice() {},
  unlock() {},
  screenMusic() {},
};
