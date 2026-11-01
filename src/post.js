// Nachbearbeitung: Leuchteffekt (Bloom) – funktioniert auch mit geteiltem Bildschirm
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
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

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.view = new MultiViewPass();
    const s = renderer.getSize(new THREE.Vector2());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(s.x, s.y), 0.4, 0.55, 1.6);
    this.composer.addPass(this.view);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const s = this.renderer.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(s.x, s.y);
  }

  render(race) {
    this.view.race = race;
    this.bloom.strength = race.theme.bloom ?? 0.4;
    this.composer.render();
  }
}
