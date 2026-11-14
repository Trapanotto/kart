// Visual themes for tracks. A track picks one with `TrackDef.theme`; the default 'meadow'
// is the Kleeblatt-Tal look built into trackView.ts. Each other theme lives in its own file
// under view/themes/ and registers itself here, so tracks can be developed independently.
import type * as THREE from 'three/webgpu';
import type { RenderContext } from '../../core/types';
import type { BuiltTrack } from '../builder';
import type { TexLib } from './materials';

export interface ThemeExtras {
  update?(dt: number, ctx: RenderContext): void;
  dispose?(): void;
}

export interface TrackTheme {
  /** Texture sets under public/assets/textures/ to load in addition to the default ones. */
  textureSets?: readonly string[];
  /** Replaces the grass terrain material (terrain, shoulders and backdrop ring). */
  terrainMaterial?(T: TexLib, ctx: RenderContext): THREE.Material;
  /** Replaces the default asphalt / dirt road material. */
  roadMaterial?(T: TexLib, ctx: RenderContext): THREE.Material;
  /** Set false to drop the default distant forest on the backdrop ring. */
  backdropTrees?: boolean;
  /**
   * Everything else the theme needs: extra meshes, lap-event visuals, animated set pieces.
   * Add objects to `root`. Called once after the standard track view is built.
   */
  extend?(track: BuiltTrack, ctx: RenderContext, root: THREE.Group, T: TexLib): Promise<ThemeExtras | void> | ThemeExtras | void;
}

const THEMES = new Map<string, TrackTheme>();

export function registerTheme(name: string, theme: TrackTheme): void {
  THEMES.set(name, theme);
}

export function themeFor(name: string | undefined): TrackTheme {
  return THEMES.get(name ?? 'meadow') ?? {};
}
