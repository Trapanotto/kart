// Gletscher-Gipfel sim script. Owner: track 4. Headless and deterministic (sim.rng / sim.time only).
//
// Lap 2 ('caveCrack', declarative): the tunnel wall breaks (tag 'caveSeal' off, branch 'caveHole' on).
//   This script adds the falling icicles: a fixed wave pattern of drop spots along the tunnel. Each spot
//   shows a growing shadow marker for WARN seconds, then the icicle falls and shatters; only karts under
//   it at impact are spun. While a spot is marked its entity radius is > 0, so the AI dodges it.
// Lap 3 ('avalancheRumble', declarative: opens 'lakeDetour'): RUMBLE seconds later this script emits
//   'avalanche', the snow mass slides down for SLIDE seconds (fx + the view animates it), then lands:
//   tag 'avalanchePile' on (pile prop + wall collider 'door.avalanchePile' across the shore road).
//   Karts on the shore road between the detour junction and the pile are moved onto the detour;
//   respawns there go to the detour as well, so nobody is trapped behind the snow.
import { Quaternion, Vector3 } from 'three';
import type { Kart, RaceSim, SimEntity, TrackLocation } from '../../core/types';
import { KART } from '../../core/data';
import type { TrackScript } from '../format';

export const GLACIER = {
  /** Icicles: drop rows from caveIn+START to caveOut-END every ROW m, two spots per row. */
  icicles: { start: 12, end: 14, row: 13, latFrac: 0.42, period: 3.4, warn: 1.35, fall: 0.38, shatter: 0.5, radius: 1.75, ceiling: 6.2, stagger: 0.42 },
  avalanche: { rumble: 3.0, slide: 2.6, pileHalf: 7 },
} as const;

type IcicleData = { state: 'idle' | 'warn' | 'fall' | 'shatter'; f: number; active: number };

const UP = new Vector3(0, 1, 0);

/** One drop spot under the tunnel ceiling. `pos` is the impact point on the road. */
class IcicleEntity implements SimEntity {
  readonly kind = 'hazard.icicle';
  pos = new Vector3();
  quat = new Quaternion();
  radius = 0;
  dead = false;
  owner = -1;
  data: IcicleData = { state: 'idle', f: 0, active: 0 };
  private hit = new Set<number>();
  private impacted = false;

  constructor(readonly id: number, pos: Vector3, yaw: number, private delay: number, private ctl: { crackAt: number }) {
    this.pos.copy(pos);
    this.quat.setFromAxisAngle(UP, yaw);
  }

  step(sim: RaceSim): void {
    const C = GLACIER.icicles;
    const d = this.data;
    if (this.ctl.crackAt < 0) { d.state = 'idle'; d.active = 0; this.radius = 0; return; }
    const t = sim.time - this.ctl.crackAt - this.delay;
    d.active = Math.min(1, Math.max(0, (sim.time - this.ctl.crackAt) / 1.5));
    if (t < 0) { d.state = 'idle'; this.radius = 0; return; }
    const u = t % C.period;
    if (u < C.warn) { d.state = 'warn'; d.f = u / C.warn; this.impacted = false; this.hit.clear(); }
    else if (u < C.warn + C.fall) { d.state = 'fall'; d.f = (u - C.warn) / C.fall; }
    else if (u < C.warn + C.fall + C.shatter) {
      d.state = 'shatter'; d.f = (u - C.warn - C.fall) / C.shatter;
      if (!this.impacted) {
        this.impacted = true;
        sim.events.emit('fx', { name: 'sparks', pos: this.pos.clone().setY(this.pos.y + 0.4), dir: UP.clone(), color: '#cdeeff', scale: 1.1 });
        sim.events.emit('fx', { name: 'dust', pos: this.pos.clone(), color: '#eef6ff', scale: 0.9 });
      }
    } else { d.state = 'idle'; d.f = 0; }
    // Marked spots are visible hazards for the AI from the shadow on until the shards settle.
    this.radius = d.state === 'warn' || d.state === 'fall' || (d.state === 'shatter' && d.f < 0.5) ? C.radius : 0;
  }

  onKart(kart: Kart, sim: RaceSim): void {
    const d = this.data;
    // only the moment of impact hurts: the end of the fall and the first instant of the shatter
    const live = (d.state === 'fall' && d.f > 0.7) || (d.state === 'shatter' && d.f < 0.35);
    if (!live || this.hit.has(kart.id)) return;
    const dx = kart.pos.x - this.pos.x, dz = kart.pos.z - this.pos.z;
    if (dx * dx + dz * dz > (C2.radius + 0.6) ** 2) return;
    this.hit.add(kart.id);
    const dir = new Vector3(dx, 0, dz).normalize();
    if (kart.applyHit('spin', { dir, cause: 'icicle', strength: 0.75 })) {
      sim.events.emit('fx', { name: 'sparks', pos: kart.pos.clone(), dir: UP.clone(), color: '#bfe6ff', scale: 0.8 });
    }
  }
}
const C2 = GLACIER.icicles;

export interface GletscherState {
  /** sim.time when the cave cracked (lap 2), -1 before. */
  crackAt: number;
  /** sim.time when lap 3 started the rumble, -1 before. */
  rumbleAt: number;
  /** 0 = nothing, 1 = rumble, 2 = sliding, 3 = landed. */
  avalanche: 0 | 1 | 2 | 3;
  /** 0..1 progress of the sliding snow mass. */
  slide: number;
  /** Main progress range covered by the pile. */
  pileFrom: number;
  pileTo: number;
  /** Where the mass starts (world) and where it lands (world, pile centre). */
  source: Vector3;
  target: Vector3;
  karts: number;
}

/**
 * The builder's racing line assumes tarmac grip everywhere. On ice the karts only have about a third
 * of it, so the AI's target speed is capped by the corner radius on ice rows (and braked into).
 * Runs once per built track (rlSpeed is per track instance).
 */
function slowRacingLineOnIce(track: any): void {
  const top = KART.topSpeed;
  const A = 12; // usable lateral acceleration on ice, m/s² (tarmac line uses 20)
  const BRAKE = 9;
  for (const p of track.paths) {
    const S: Float32Array = track.rlSpeed[p.index];
    const n = p.count;
    const idx = (i: number) => (p.closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i)));
    let any = false;
    for (let i = 0; i < n; i++) {
      if (p.surface[i] !== 'ice') continue;
      let k = 0;
      for (let d = -6; d <= 6; d++) k = Math.max(k, Math.abs(p.curv[idx(i + d)]));
      const v = Math.sqrt(A / Math.max(1e-4, k * 0.85));
      if (v / top < S[i]) { S[i] = v / top; any = true; }
    }
    if (!any) continue;
    for (let pass = 0; pass < (p.closed ? 2 : 1); pass++) {
      for (let i = n - 2; i >= 0; i--) {
        const vNext = S[idx(i + 1)] * top;
        const lim = Math.sqrt(vNext * vNext + 2 * BRAKE * p.ds) / top;
        if (lim < S[i]) S[i] = lim;
      }
    }
  }
}

export const gletscherScript: TrackScript = {
  create(track: any) {
    const main = track.paths[0];
    const anchor = (n: string): number => main.anchors.get(n);
    const detour = track.paths.find((p: any) => p.id === 'lakeDetour');
    const detourBranch = () => track.branches.find((b: any) => b.path === detour.index);
    const pileAt = anchor('avalanche');
    const S: GletscherState = {
      crackAt: -1, rumbleAt: -1, avalanche: 0, slide: 0,
      pileFrom: pileAt - GLACIER.avalanche.pileHalf, pileTo: pileAt + GLACIER.avalanche.pileHalf,
      source: new Vector3(), target: new Vector3(), karts: 0,
    };
    {
      const f = track.sample(pileAt, 0, 0);
      S.target.copy(f.pos);
      // the snow comes down the slope on the right of the shore road (east, uphill)
      const g = track.sample(pileAt, 30, 0);
      S.source.set(g.pos.x, track.terrain.heightAt(g.pos.x, g.pos.z) + 3, g.pos.z);
    }
    const ctl = { crackAt: -1 };
    let fxT = 0;
    slowRacingLineOnIce(track);

    const inShoreTrap = (progress: number): boolean => {
      const b = detourBranch();
      if (!b) return false;
      const d = (progress - b.from + track.length) % track.length;
      return d > 0 && d <= ((S.pileTo + 1 - b.from + track.length) % track.length);
    };

    // Respawns on the buried shore road go onto the lake detour instead.
    const respawn0 = track.respawn.bind(track);
    track.respawn = (loc: TrackLocation) => {
      if (S.avalanche === 3 && loc.path === 0 && inShoreTrap(loc.progress)) {
        const b = detourBranch();
        const span = (b.to - b.from + track.length) % track.length;
        const d = Math.min(span - 6, Math.max(8, (loc.progress - b.from + track.length) % track.length));
        return respawn0({ ...loc, path: detour.index, progress: (b.from + d) % track.length });
      }
      return respawn0(loc);
    };

    const land = (sim: RaceSim) => {
      S.avalanche = 3;
      S.slide = 1;
      track.state.tags.set('avalanchePile', true);
      track.applyTags();
      sim.events.emit('track:changed', { lap: track.state.lap, event: 'avalancheLanded' });
      sim.events.emit('fx', { name: 'dust', pos: S.target.clone().setY(S.target.y + 1), color: '#f4f8ff', scale: 4 });
      sim.events.emit('fx', { name: 'smoke', pos: S.target.clone().setY(S.target.y + 2), color: '#eef4fb', scale: 3 });
      // Nobody stays trapped on the shore road behind (or inside) the pile: move them onto the lake.
      const b = detourBranch();
      const span = (b.to - b.from + track.length) % track.length;
      for (const k of sim.karts) {
        if (k.loc.path !== 0 || !inShoreTrap(k.loc.progress)) continue;
        const d = Math.min(span - 6, Math.max(8, (k.loc.progress - b.from + track.length) % track.length));
        const pose = track.respawn({ ...k.loc, path: detour.index, progress: (b.from + d + 4) % track.length });
        k.teleport(pose);
        S.karts++;
        sim.events.emit('fx', { name: 'smoke', pos: k.pos.clone(), color: '#eef4fb', scale: 1.2 });
      }
    };

    return {
      state: S,
      createEntities(sim: RaceSim): SimEntity[] {
        S.crackAt = -1; S.rumbleAt = -1; S.avalanche = 0; S.slide = 0; S.karts = 0;
        ctl.crackAt = -1;
        fxT = 0;
        // icicle spots along the tunnel (deterministic layout, no rng needed)
        const C = GLACIER.icicles;
        const out: SimEntity[] = [];
        const s0 = anchor('caveIn') + C.start, s1 = anchor('caveOut') - C.end;
        let row = 0;
        for (let s = s0; s <= s1; s += C.row, row++) {
          for (const side of [-1, 1]) {
            const f = track.sample(s, 0, 0);
            const lat = side * f.halfWidth * C.latFrac;
            const g = track.sample(s, lat, 0);
            const pos = g.pos.clone();
            pos.y = track.groundAt(pos.x, pos.z, pos.y + 0.5);
            // left and right of a row alternate; consecutive rows follow 0.42 s apart (a wave you can read)
            const delay = row * C.stagger + (side > 0 ? C.period / 2 : 0) + 0.8;
            out.push(new IcicleEntity(sim.nextEntityId(), pos, Math.atan2(g.forward.x, g.forward.z), delay, ctl));
          }
        }
        return out;
      },
      setLap(lap: number, sim: RaceSim) {
        if (lap >= 2 && S.crackAt < 0) {
          S.crackAt = ctl.crackAt = sim.time;
          const f = track.sample(anchor('caveIn') + 22, 9.5, 0);
          sim.events.emit('fx', { name: 'sparks', pos: f.pos.clone().setY(f.pos.y + 2), color: '#bfe6ff', scale: 2.5 });
          sim.events.emit('fx', { name: 'dust', pos: f.pos.clone().setY(f.pos.y + 1), color: '#e8f4ff', scale: 2.5 });
        }
        if (lap >= 3 && S.rumbleAt < 0) { S.rumbleAt = sim.time; S.avalanche = 1; }
      },
      step(sim: RaceSim, dt: number) {
        if (S.avalanche === 0 || S.avalanche === 3) return;
        const e = sim.time - S.rumbleAt;
        const A = GLACIER.avalanche;
        if (S.avalanche === 1 && e >= A.rumble) {
          S.avalanche = 2;
          sim.events.emit('track:event', { name: 'avalanche', pos: S.source.clone() });
          sim.events.emit('track:changed', { lap: track.state.lap, event: 'avalanche' });
        }
        if (S.avalanche === 2) {
          S.slide = Math.min(1, (e - A.rumble) / A.slide);
          fxT -= dt;
          if (fxT <= 0) {
            fxT = 0.12;
            const k = S.slide * S.slide;
            const p = S.source.clone().lerp(S.target, k);
            p.y += 1.5;
            for (const off of [-8, 0, 8]) {
              const q = p.clone();
              q.x += off * 0.7 * (sim.rng.next() - 0.2);
              q.z += off * (sim.rng.next() - 0.5);
              sim.events.emit('fx', { name: 'dust', pos: q, color: '#f4f8ff', scale: 2.4 });
            }
          }
          if (S.slide >= 1) land(sim);
        }
      },
    };
  },
};
