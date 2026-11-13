// Quality presets. Owner: render (values may be tuned there; keep the shape).
import type { QualitySettings, QualityTier } from './types';

export const QUALITY: Record<QualityTier, QualitySettings> = {
  high: { tier: 'high', pixelRatio: 2, shadows: true, shadowMapSize: 2048, shadowCascades: 3, ao: true, bloom: true, motionBlur: true, volumetricFog: true, density: 1, fur: true, maxTextureSize: 2048 },
  medium: { tier: 'medium', pixelRatio: 1.5, shadows: true, shadowMapSize: 2048, shadowCascades: 2, ao: false, bloom: true, motionBlur: true, volumetricFog: false, density: 0.7, fur: true, maxTextureSize: 1024 },
  mobile: { tier: 'mobile', pixelRatio: 1.25, shadows: true, shadowMapSize: 1024, shadowCascades: 1, ao: false, bloom: false, motionBlur: false, volumetricFog: false, density: 0.4, fur: false, maxTextureSize: 1024 },
};

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
}

export function detectTier(): QualityTier {
  if (isTouchDevice()) return 'mobile';
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores >= 8 ? 'high' : 'medium';
}
