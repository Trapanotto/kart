// Dynamic resolution: holds a target frame rate by scaling the scene render resolution. Owner: render.
//
// rAF is v-synced, so frame time only tells us when we are *missing* the target, not how much headroom there is.
// Strategy: drop quickly when the smoothed frame time exceeds the budget; probe upward slowly after a long
// stable period; if a probe makes things worse, step back and wait much longer before probing again
// (hysteresis). If even the minimum scale misses 60, the target falls back to a stable 30.

export interface DynResState {
  scale: number;
  target: number;
  avgMs: number;
}

export class DynamicResolution {
  scale = 1;
  min = 0.5;
  max = 1;
  target = 60;
  enabled = true;
  avgMs = 16.7;
  private over = 0;
  private stable = 0;
  private cooldown = 0;
  private probing = false;
  private probeTime = 0;
  private last = 0;
  private atMinOver = 0;
  private underAt30 = 0;

  reset(min: number, max: number) {
    this.min = min; this.max = max;
    this.scale = Math.min(max, Math.max(min, this.scale));
    this.over = this.stable = this.cooldown = 0; this.probing = false; this.target = 60; this.atMinOver = 0;
  }

  /** Call once per rendered frame. Returns the new scale. */
  update(now: number): number {
    const dt = this.last ? now - this.last : 16.7;
    this.last = now;
    // Ignore hitches, hidden tabs and manually-stepped frames.
    if (!this.enabled || dt <= 2 || dt > 120 || (typeof document !== 'undefined' && document.hidden)) return this.scale;
    this.avgMs += (dt - this.avgMs) * 0.08;
    const budget = 1000 / this.target;
    const s = dt / 1000;
    this.cooldown = Math.max(0, this.cooldown - s);

    if (this.avgMs > budget * 1.12) {
      this.over += s; this.stable = 0;
      if (this.probing) {
        // Probe failed: step back and wait.
        this.probing = false;
        this.step(-0.1);
        this.cooldown = 12;
        this.over = 0;
      } else if (this.over > 0.6) {
        this.step(this.avgMs > budget * 1.5 ? -0.15 : -0.08);
        this.over = 0.2; // need another ~0.4 s before the next drop
      }
      if (this.scale <= this.min + 1e-3 && this.target === 60) {
        this.atMinOver += s;
        if (this.atMinOver > 3) { this.target = 30; this.atMinOver = 0; this.cooldown = 4; }
      }
    } else {
      this.over = Math.max(0, this.over - s * 0.5);
      this.atMinOver = 0;
      if (this.avgMs < budget * 1.04) this.stable += s; else this.stable = 0;
      if (this.probing) {
        this.probeTime += s;
        if (this.probeTime > 2) { this.probing = false; this.stable = 0; }
      } else if (this.stable > 4 && this.cooldown <= 0 && this.scale < this.max - 1e-3) {
        this.step(0.05);
        this.probing = true; this.probeTime = 0; this.stable = 0;
      }
      // Running at 30 with a lot of room: try 60 again now and then.
      if (this.target === 30) {
        if (this.avgMs < 22) this.underAt30 += s; else this.underAt30 = 0;
        if (this.underAt30 > 8) { this.target = 60; this.underAt30 = 0; this.cooldown = 6; }
      }
    }
    return this.scale;
  }

  private step(d: number) {
    const q = Math.round((this.scale + d) * 20) / 20; // quantise to 0.05 so render targets reallocate rarely
    this.scale = Math.min(this.max, Math.max(this.min, q));
  }
}
