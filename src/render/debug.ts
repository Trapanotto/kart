// ?debug overlay: fps, frame time, draw calls, triangles, render scale, backend, tier. Owner: render.
// Keys: F6 cycle tier, F7 toggle dynamic resolution, Shift+1..9 toggle post stages.
import { STAGE_KEYS, type PostStages } from './post';

export interface DebugSource {
  stats(): { fps: number; drawCalls: number; triangles: number; backend: string };
  frameMs(): number;
  scale(): number;
  dynTarget(): number;
  tier(): string;
  stages(): PostStages;
  cycleTier(): void;
  toggleStage(k: keyof PostStages): void;
  toggleDynRes(): boolean;
  dynEnabled(): boolean;
}

export function createDebugOverlay(src: DebugSource): { update(): void; dispose(): void } {
  const el = document.createElement('div');
  el.id = 'render-debug';
  el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;pointer-events:none;font:11px/1.35 ui-monospace,Consolas,monospace;'
    + 'color:#eaf6ff;background:rgba(10,14,24,.72);padding:6px 8px;border-radius:6px;white-space:pre;max-width:min(92vw,360px)';
  document.body.appendChild(el);
  let acc = 0, last = performance.now();
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'F6') { src.cycleTier(); e.preventDefault(); }
    else if (e.code === 'F7') { src.toggleDynRes(); e.preventDefault(); }
    else if (e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
      const k = STAGE_KEYS[Number(e.code.slice(5)) - 1];
      if (k) { src.toggleStage(k); e.preventDefault(); }
    }
  };
  window.addEventListener('keydown', onKey);
  return {
    update() {
      const now = performance.now();
      acc += now - last; last = now;
      if (acc < 250) return;
      acc = 0;
      const s = src.stats();
      const st = src.stages();
      const stages = STAGE_KEYS.map((k, i) => `${i + 1}${st[k] ? '+' : '-'}${k}`).join(' ');
      el.textContent = `${s.backend}  tier ${src.tier()}  ${s.fps.toFixed(0)} fps  ${src.frameMs().toFixed(1)} ms\n`
        + `draws ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(0)}k  scale ${src.scale().toFixed(2)} ${src.dynEnabled() ? 'auto' : 'fixed'} @${src.dynTarget()}\n`
        + `${stages}\nF6 tier  F7 dynres  Shift+n stage`;
    },
    dispose() { window.removeEventListener('keydown', onKey); el.remove(); },
  };
}
