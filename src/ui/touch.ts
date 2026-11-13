// On-screen touch controls; registered with the app as an InputSource.
import type { App, InputSource, InputState } from '../core/types';
import { h, toggleClass, vibrate } from './dom';
import { UI_ICONS } from './icons';

type Ctl = 'steer' | 'left' | 'right' | 'drift' | 'item' | 'brake' | 'gas';

export class TouchControls implements InputSource {
  readonly el: HTMLElement;
  private ptr = new Map<number, Ctl>();
  private stickOrigin = { x: 0, y: 0 };
  private stickId = -1;
  private steer = 0;
  private itemStartY = 0;
  private itemAim: -1 | 0 | 1 = 0;
  private pause = false;
  private base: HTMLElement;
  private knob: HTMLElement;
  private steerZone: HTMLElement;
  private btn: Record<string, HTMLElement> = {};
  private visible = false;
  layout: 'stick' | 'zones' = 'stick';

  constructor(private app: App) {
    this.knob = h('div.stick-knob');
    this.base = h('div.stick-base', this.knob);
    this.steerZone = h('div.zone.steer');
    const mk = (cls: string, ctl: Ctl | 'pause', label: string, icon?: string) => {
      const b = h('div.tbtn.' + cls, icon ? h('span', { html: icon, style: { display: 'contents' } }) : h('span', label));
      b.setAttribute('aria-label', label);
      this.btn[ctl] = b;
      return b;
    };
    const zl = h('div.zl', { html: UI_ICONS.back }), zr = h('div.zr', { html: UI_ICONS.next });
    this.btn.left = zl; this.btn.right = zr;
    this.el = h('div.tk-touch.off',
      this.steerZone, this.base,
      h('div.zones', zl, zr),
      mk('b-brake', 'brake', 'Bremse'),
      mk('b-item', 'item', 'Item'),
      mk('b-drift', 'drift', 'Drift'),
      mk('b-gas', 'gas', 'Gas'),
      mk('b-pause', 'pause', 'Pause', UI_ICONS.pause),
    );
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('pointermove', (e) => this.move(e));
    this.el.addEventListener('pointerup', (e) => this.up(e));
    this.el.addEventListener('pointercancel', (e) => this.up(e));
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.resetStick();
  }

  show(on: boolean): void {
    this.visible = on;
    toggleClass(this.el, 'off', !on);
    if (!on) this.releaseAll();
  }

  setLayout(l: 'stick' | 'zones'): void { this.layout = l; toggleClass(this.el, 'zones', l === 'zones'); }
  setManualGas(on: boolean): void { toggleClass(this.el, 'manual', on); }

  private resetStick(): void {
    const r = this.el.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(this.el).fontSize) || 14;
    this.base.style.left = `${Math.max(fs * 6, (r.width || innerWidth) * 0.13)}px`;
    this.base.style.top = `${(r.height || innerHeight) - fs * 6.5}px`;
    this.knob.style.transform = '';
    this.base.classList.remove('active');
  }

  private ctlFor(t: EventTarget | null): Ctl | 'pause' | null {
    const el = t as HTMLElement;
    if (!el?.closest) return null;
    if (el.closest('.b-pause')) return 'pause';
    if (el.closest('.b-drift')) return 'drift';
    if (el.closest('.b-item')) return 'item';
    if (el.closest('.b-brake')) return 'brake';
    if (el.closest('.b-gas')) return 'gas';
    if (el.closest('.zl')) return 'left';
    if (el.closest('.zr')) return 'right';
    if (el.closest('.steer') && this.layout === 'stick') return 'steer';
    return null;
  }

  private down(e: PointerEvent): void {
    const ctl = this.ctlFor(e.target);
    if (!ctl) return;
    e.preventDefault();
    if (ctl === 'pause') { this.pause = true; vibrate(this.app.settings.vibration, 10); return; }
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ok */ }
    this.ptr.set(e.pointerId, ctl);
    vibrate(this.app.settings.vibration, 8);
    if (ctl === 'steer') {
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      const r = this.el.getBoundingClientRect();
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.base.classList.add('active');
      this.steer = 0;
    } else {
      this.btn[ctl]?.classList.add('down');
      if (ctl === 'item') { this.itemStartY = e.clientY; this.itemAim = 0; }
    }
  }

  private move(e: PointerEvent): void {
    const ctl = this.ptr.get(e.pointerId);
    if (!ctl) return;
    e.preventDefault();
    const fs = parseFloat(getComputedStyle(this.base).fontSize) || 14;
    if (ctl === 'steer') {
      const R = fs * 3.4;
      let dx = e.clientX - this.stickOrigin.x;
      const dy = e.clientY - this.stickOrigin.y;
      // Let the stick follow the thumb when it drifts far away.
      if (Math.abs(dx) > R * 1.4) {
        const shift = dx - Math.sign(dx) * R * 1.4;
        this.stickOrigin.x += shift; dx -= shift;
        const r = this.el.getBoundingClientRect();
        this.base.style.left = `${this.stickOrigin.x - r.left}px`;
      }
      const v = Math.max(-1, Math.min(1, dx / R));
      const dead = 0.08;
      const s = Math.abs(v) < dead ? 0 : Math.sign(v) * ((Math.abs(v) - dead) / (1 - dead));
      this.steer = Math.sign(s) * Math.pow(Math.abs(s), 1.3);
      this.knob.style.transform = `translate(${(v * R).toFixed(1)}px, ${(Math.max(-R, Math.min(R, dy)) * 0.25).toFixed(1)}px)`;
    } else if (ctl === 'item') {
      const dy = e.clientY - this.itemStartY;
      this.itemAim = dy > fs * 2 ? -1 : dy < -fs * 2 ? 1 : 0;
    }
  }

  private up(e: PointerEvent): void {
    const ctl = this.ptr.get(e.pointerId);
    if (!ctl) return;
    this.ptr.delete(e.pointerId);
    if (ctl === 'steer') { this.stickId = -1; this.steer = 0; this.resetStick(); }
    else if (![...this.ptr.values()].includes(ctl)) this.btn[ctl]?.classList.remove('down');
  }

  private releaseAll(): void {
    this.ptr.clear();
    this.steer = 0;
    this.itemAim = 0;
    for (const b of Object.values(this.btn)) b.classList.remove('down');
    this.resetStick();
  }

  private has(c: Ctl): boolean { for (const v of this.ptr.values()) if (v === c) return true; return false; }

  poll(out: InputState): boolean {
    if (!this.visible || this.ptr.size === 0) return false;
    const zoneSteer = (this.has('right') ? 1 : 0) - (this.has('left') ? 1 : 0);
    out.steer = this.layout === 'zones' ? zoneSteer : this.steer;
    out.brake = this.has('brake') ? 1 : 0;
    // Drift and item sit under the same thumb as gas, so holding them keeps the throttle open.
    out.throttle = this.has('gas') || this.has('drift') || this.has('item') || this.app.settings.autoThrottle ? (out.brake ? 0 : 1) : 0;
    out.drift = this.has('drift');
    out.item = this.has('item');
    out.itemAim = this.has('item') ? this.itemAim : 0;
    out.lookBack = false;
    return true;
  }

  consumePause(): boolean { const p = this.pause; this.pause = false; return p; }

  dispose(): void { this.el.remove(); }
}
