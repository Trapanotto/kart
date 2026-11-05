// Nachbearbeitung: Leuchteffekt (Bloom), Farblook pro Welt, Tempo-Unschärfe am Bildrand
// und Farbsaum beim Turbo – funktioniert auch mit geteiltem Bildschirm (jede Ansicht für sich).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Zeichnet alle Spieler-Ansichten in ein gemeinsames Bild
class MultiViewPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.race = null;
  }
  render(renderer, writeBuffer, readBuffer) {
    this.race.renderViews(renderer, readBuffer);
  }
}

const MAX_VIEWS = 4;

// Farblook + Tempo-Effekte. Jede Ansicht (Rechteck in Bildkoordinaten) hat eigenes Tempo und eigenen Turbo.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uViews: { value: 1 },
    uRect: { value: Array.from({ length: MAX_VIEWS }, () => new THREE.Vector4(0, 0, 1, 1)) },
    uSpeed: { value: new Array(MAX_VIEWS).fill(0) },
    uBoost: { value: new Array(MAX_VIEWS).fill(0) },
    uFx: { value: 1 },
    uContrast: { value: 1 },
    uSat: { value: 1 },
    uLift: { value: new THREE.Vector3() },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uVig: { value: 0.25 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uRes; uniform float uTime; uniform int uViews;
    uniform vec4 uRect[${MAX_VIEWS}]; uniform float uSpeed[${MAX_VIEWS}]; uniform float uBoost[${MAX_VIEWS}];
    uniform float uFx, uContrast, uSat, uVig; uniform vec3 uLift, uGain;
    varying vec2 vUv;
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      // zu welcher Ansicht gehoert dieser Bildpunkt?
      vec4 rect = vec4(0.0, 0.0, 1.0, 1.0); float spd = 0.0, bst = 0.0;
      for (int i = 0; i < ${MAX_VIEWS}; i++) {
        if (i >= uViews) break;
        vec4 r = uRect[i];
        if (vUv.x >= r.x && vUv.x <= r.x + r.z && vUv.y >= r.y && vUv.y <= r.y + r.w) { rect = r; spd = uSpeed[i]; bst = uBoost[i]; }
      }
      vec2 c = rect.xy + rect.zw * 0.5;
      vec2 d = vUv - c;
      vec2 dn = d / (rect.zw * 0.5);
      float r = length(dn * vec2(rect.z * uRes.x / (rect.w * uRes.y), 1.0)) / length(vec2(rect.z * uRes.x / (rect.w * uRes.y), 1.0));
      vec2 lo = rect.xy + 1.5 / uRes, hi = rect.xy + rect.zw - 1.5 / uRes; // nicht ins Nachbarbild greifen
      // radiale Unschaerfe zum Rand hin, Mitte bleibt scharf
      float amt = spd * 0.05 * smoothstep(0.3, 1.0, r) * uFx;
      vec2 ca = d * (0.002 + bst * 0.01) * r * uFx;
      int taps = amt > 0.0005 ? 8 : 1;
      float jit = hash(vUv * uRes + uTime) - 0.5;
      vec3 col = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        if (i >= taps) break;
        float t = taps > 1 ? (float(i) + jit) / 8.0 : 0.0;
        vec2 uv = vUv - d * amt * t;
        col.r += texture2D(tDiffuse, clamp(uv + ca, lo, hi)).r;
        col.g += texture2D(tDiffuse, clamp(uv, lo, hi)).g;
        col.b += texture2D(tDiffuse, clamp(uv - ca, lo, hi)).b;
      }
      col /= float(taps);
      // Farblook (linear, vor dem Tonemapping)
      col = max(col * uGain + uLift, 0.0);
      float l = luma(col);
      col = mix(vec3(l), col, uSat);
      col = 0.18 * pow(max(col, 0.0) / 0.18, vec3(uContrast));
      col *= mix(vec3(1.0), vec3(1.06, 1.0, 0.92), bst * 0.3 * uFx);
      col *= mix(1.0, smoothstep(1.35, 0.4, r), uVig);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    const s = renderer.getSize(new THREE.Vector2());
    // Zwischenbild mit Kantenglaettung (MSAA), sonst gehen beim Nachbearbeiten die glatten Kanten verloren
    const rt = new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.view = new MultiViewPass();
    this.bloom = new UnrealBloomPass(new THREE.Vector2(s.x, s.y), 0.4, 0.55, 1.6);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.view);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.time = 0;
  }

  resize() {
    const s = this.renderer.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(s.x, s.y);
    const pr = this.renderer.getPixelRatio();
    this.grade.uniforms.uRes.value.set(s.x * pr, s.y * pr);
  }

  // views: [{ rect: {x, y, w, h} in 0..1, speed: 0..1, boost: 0..1 }]
  render(race, views = [], dt = 1 / 60) {
    const st = race.settings;
    this.view.race = race;
    this.bloom.enabled = !!st.bloom;
    this.bloom.strength = race.theme.bloom ?? 0.4;
    const u = this.grade.uniforms;
    this.grade.enabled = st.grade !== false;
    const L = race.theme.look || {};
    u.uContrast.value = L.contrast ?? 1.04;
    u.uSat.value = L.sat ?? 1.08;
    u.uLift.value.set(...(L.lift ?? [0, 0, 0]));
    u.uGain.value.set(...(L.gain ?? [1, 1, 1]));
    u.uVig.value = L.vig ?? 0.25;
    u.uFx.value = st.speedfx === false ? 0 : 1;
    this.time += dt;
    u.uTime.value = this.time;
    u.uViews.value = Math.min(MAX_VIEWS, views.length || 1);
    views.slice(0, MAX_VIEWS).forEach((v, i) => {
      u.uRect.value[i].set(v.rect.x, v.rect.y, v.rect.w, v.rect.h);
      // weich nachfuehren, damit die Unschaerfe nicht flackert
      u.uSpeed.value[i] += (v.speed - u.uSpeed.value[i]) * Math.min(1, dt * 4);
      u.uBoost.value[i] += (v.boost - u.uBoost.value[i]) * Math.min(1, dt * 5);
    });
    this.composer.render(dt);
  }
}
