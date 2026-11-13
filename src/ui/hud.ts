// In-race HUD. Built once per race; per frame it only writes text nodes, transforms and classes.
import type { App, Kart, RaceSim } from '../core/types';
import { h, LiveText, svg, toggleClass, fmtTime, fmtDelta, vibrate } from './dom';
import { ITEM_ICONS, ITEM_NAMES, UI_ICONS } from './icons';
import { hintSeen, markHint, pbFor } from './storage';
import { inputMode } from './nav';

const ITEM_IDS = Object.keys(ITEM_ICONS);

interface Hint { id: string; title: string; text: () => string }

const HINTS: Record<string, Hint> = {
  drift: {
    id: 'drift', title: 'Driften',
    text: () => inputMode() === 'touch' ? 'Halte «Drift» in der Kurve. Blaue, orange und lila Funken geben immer stärkere Turbos!'
      : inputMode() === 'pad' ? 'Halte RB in der Kurve. Blaue, orange und lila Funken geben immer stärkere Turbos!'
      : 'Halte Leertaste in der Kurve. Blaue, orange und lila Funken geben immer stärkere Turbos!',
  },
  items: {
    id: 'items', title: 'Items',
    text: () => inputMode() === 'touch' ? 'Tippe auf «Item» zum Einsetzen. Zieh dabei nach unten, um nach hinten zu werfen.'
      : inputMode() === 'pad' ? 'Setze Items mit LB ein. Halte die Taste, um das Item als Schutz hinter dir zu tragen.'
      : 'Setze Items mit E ein. Halte die Taste, um das Item als Schutz hinter dir zu tragen.',
  },
  trick: {
    id: 'trick', title: 'Tricks',
    text: () => inputMode() === 'touch' ? 'Tippe «Drift» direkt nach einer Rampe für einen Trick-Turbo!' : 'Drück Drift direkt nach einer Rampe für einen Trick-Turbo!',
  },
};

const DRIFT_NAMES = ['', 'Mini-Turbo!', 'Super-Turbo!', 'Ultra-Turbo!'];

export class Hud {
  readonly el: HTMLElement;
  private sim: RaceSim | null = null;
  private unsub: (() => void)[] = [];

  // item
  private itemEl: HTMLElement;
  private itemIcons = new Map<string, HTMLElement>();
  private itemOn: HTMLElement | null = null;
  private itemCount = new LiveText();
  private itemCountEl: HTMLElement;
  private rollT = 0;
  private rollIdx = 0;
  private lastItem: string | null = null;

  // ticker
  private tickRows: { el: HTMLElement; p: LiveText; n: LiveText; g: LiveText; dot: HTMLElement; kart: Kart | null }[] = [];
  private sorted: Kart[] = [];

  // lap / time
  private lapV = new LiveText();
  private lapOf = new LiveText();
  private time = new LiveText();
  private best = new LiveText();
  private splitEl: HTMLElement;
  private splitT = new LiveText();
  private splitD = new LiveText();
  private splitDEl: HTMLElement;
  private lapStart = 0;
  private bestLap = Infinity;

  // position, speed
  private posEl: HTMLElement;
  private posV = new LiveText();
  private posInner: HTMLElement;
  private lastRank = 0;
  private speedArc: SVGPathElement;
  private speedV = new LiveText();
  private arcLen = 0;

  // map
  private mapEl: HTMLElement;
  private mapCanvas: HTMLCanvasElement;
  private dots: HTMLElement[] = [];
  private mapXf = { cx: 0, cz: 0, s: 1, rot: false, w: 0, h: 0 };

  // centre
  private countEl: HTMLElement;
  private countT = new LiveText();
  private startHint: HTMLElement;
  private banner: HTMLElement;
  private bannerT = new LiveText();
  private finishEl: HTMLElement;
  private finishP = new LiveText();
  private wrongEl: HTMLElement;
  private warnEl: HTMLElement;
  private warnIc: HTMLElement;
  private warnT = new LiveText();
  private warnTimer = 0;
  private vig: HTMLElement;
  private pop: HTMLElement;
  private popT = new LiveText();
  private driftEl: HTMLElement;
  private driftPips: HTMLElement[] = [];
  private driftLevel = -1;
  private lastDriftEnd = 0;
  private hintEl: HTMLElement;
  private hintTitle = new LiveText();
  private hintText = new LiveText();
  private hintTimer = 0;
  private hintQueue: string[] = [];
  private racingFor = 0;
  private finished = false;

  constructor(private app: App) {
    // item slot
    this.itemCountEl = h('div.cnt', this.itemCount.node);
    const icons = ITEM_IDS.map((id) => { const e = h('div.ic', { html: ITEM_ICONS[id] }); this.itemIcons.set(id, e); return e; });
    this.itemEl = h('div.h-item', icons, this.itemCountEl, h('div.key', 'E'));

    // ticker
    const ticker = h('div.h-ticker');
    for (let i = 0; i < 3; i++) {
      const row = { el: h('div.r'), p: new LiveText(), n: new LiveText(), g: new LiveText(), dot: h('i.d'), kart: null as Kart | null };
      row.el.append(h('span.p', row.p.node), row.dot, h('span.n', row.n.node), h('span.g', row.g.node));
      ticker.append(row.el);
      this.tickRows.push(row);
    }

    // lap/time
    this.splitDEl = h('span.dl', this.splitD.node);
    this.splitEl = h('div.h-split', h('span', this.splitT.node), this.splitDEl);
    const tr = h('div.blk.h-tr',
      h('div.h-lap.h-out', h('span.lb', 'RUNDE'), h('span.v', this.lapV.node), h('span.of', this.lapOf.node)),
      h('div.h-time', this.time.node),
      h('div.h-best', this.best.node),
      this.splitEl,
    );

    // position + speed
    this.posInner = h('span.v', this.posV.node);
    this.posEl = h('div.h-pos.h-out', this.posInner, h('span.of', '.'));
    const gauge = svg(`<svg viewBox="0 0 100 100"><path d="M18 78A40 40 0 1 1 82 78" fill="none" stroke="rgba(36,48,79,.55)" stroke-width="13" stroke-linecap="round"/>
<path class="arc" d="M18 78A40 40 0 1 1 82 78" fill="none" stroke="url(#tkspd)" stroke-width="8" stroke-linecap="round"/>
<defs><linearGradient id="tkspd" x1="0" x2="1"><stop offset="0" stop-color="#6ec6f5"/><stop offset=".6" stop-color="#ffd23f"/><stop offset="1" stop-color="#ff7a5c"/></linearGradient></defs></svg>`);
    this.speedArc = gauge.querySelector('.arc') as SVGPathElement;
    const speed = h('div.h-speed', gauge, h('div.val', this.speedV.node), h('div.unit', 'km/h'));

    // map
    this.mapCanvas = h<HTMLCanvasElement>('canvas');
    this.mapEl = h('div.blk.h-map', this.mapCanvas);

    // centre
    this.countEl = h('div.h-count.h-out', this.countT.node);
    this.startHint = h('div.h-starthint', { html: 'Tipp: Gib kurz vor <b>LOS!</b> Gas für einen Superstart!' });
    this.banner = h('div.h-banner.h-out', this.bannerT.node);
    this.finishEl = h('div.h-finish', h('div.z.h-out', 'Ziel!'), h('div.p.h-out', this.finishP.node));
    this.wrongEl = h('div.h-wrong', h('span', { html: UI_ICONS.uturn }), 'Falsche Richtung!');
    this.warnIc = h('div.ic');
    this.warnEl = h('div.h-warn', h('span.ar', { html: UI_ICONS.warn }), this.warnIc, h('span', this.warnT.node));
    this.vig = h('div.h-vig');
    this.pop = h('div.h-pop.h-out', this.popT.node);
    this.driftPips = [h('i'), h('i'), h('i')];
    this.driftEl = h('div.h-drift', this.driftPips);
    this.hintEl = h('div.h-hint', { onclick: () => this.closeHint() }, h('span.t', this.hintTitle.node), h('span.x', this.hintText.node), h('span.c', { html: UI_ICONS.close }));

    this.el = h('div.tk-hud.hidden',
      this.vig,
      h('div.blk.h-tl', this.itemEl, ticker),
      tr,
      this.mapEl,
      h('div.blk.h-br', this.posEl, speed),
      h('div.blk.h-center', this.countEl, this.startHint, this.banner),
      this.finishEl,
      this.wrongEl,
      this.warnEl,
      h('div.blk.h-bc', this.pop, this.driftEl, this.hintEl),
    );
    window.addEventListener('resize', () => { if (this.sim) this.drawMap(); });
  }

  setTouch(on: boolean): void { toggleClass(this.el, 'touch', on); }
  setPadGlyphs(on: boolean): void { toggleClass(this.el, 'pad', on); }

  get bound(): RaceSim | null { return this.sim; }

  bind(sim: RaceSim): void {
    this.unbind();
    this.sim = sim;
    this.finished = false;
    this.lapStart = 0;
    this.bestLap = Infinity;
    this.lastRank = 0;
    this.racingFor = 0;
    this.driftLevel = -1;
    this.lastItem = null;
    this.hintQueue = [];
    this.closeHint(true);
    this.el.classList.remove('hidden');
    toggleClass(this.el, 'tt', sim.config.mode === 'timetrial');
    this.finishEl.style.opacity = '0';
    this.countEl.style.opacity = '0';
    this.sorted = [...sim.karts];
    const pb = sim.config.mode === 'timetrial' ? pbFor(sim.config.trackId, sim.config.speedClass.id) : null;
    this.best.set(pb ? `Bestzeit ${fmtTime(pb.time)}` : '');
    this.lapOf.set(`/${sim.laps}`);

    // map dots
    for (const d of this.dots) d.remove();
    this.dots = sim.karts.map((k) => {
      const d = h('div.dot' + (k === sim.player ? '.me' : ''));
      d.style.background = k.char.color;
      this.mapEl.append(d);
      return d;
    });
    requestAnimationFrame(() => this.drawMap());
    this.drawMap();

    const ev = this.app.events;
    const me = (k: Kart) => k === sim.player;
    this.unsub.push(
      ev.on('race:countdown', ({ n }) => this.countdown(n)),
      ev.on('race:phase', ({ phase }) => { toggleClass(this.startHint, 'on', phase === 'countdown'); if (phase === 'racing') this.lapStart = sim.raceTime; }),
      ev.on('race:lap', (e) => { if (me(e.kart)) this.onLap(e.lap, e.lapTime); }),
      ev.on('race:finish', (e) => { if (me(e.kart)) this.onFinish(e.rank, e.time); }),
      ev.on('kart:hit', (e) => {
        if (!me(e.kart)) return;
        this.flash(e.absorbed ? 'shield' : 'hit', e.absorbed ? 0.8 : 1);
        if (!e.absorbed) { if (this.app.settings.cameraShake) this.shake(); vibrate(this.app.settings.vibration, 60); }
      }),
      ev.on('kart:boost', (e) => { if (me(e.kart)) this.onBoost(e.cause, e.power); }),
      ev.on('kart:driftEnd', (e) => { if (me(e.kart)) this.lastDriftEnd = e.level; }),
      ev.on('kart:startBoost', (e) => { if (me(e.kart) && e.quality > 0) this.showPop(e.quality > 0.7 ? 'Superstart!' : 'Guter Start!'); }),
      ev.on('kart:trick', (e) => { if (me(e.kart)) this.showPop('Trick!'); }),
      ev.on('kart:jump', (e) => { if (me(e.kart)) this.queueHint('trick'); }),
      ev.on('item:got', (e) => { if (me(e.kart)) { this.itemPop(); this.queueHint('items'); } }),
      ev.on('item:warn', (e) => { if (me(e.kart)) this.warn(e.item, e.from); }),
    );
  }

  unbind(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.sim = null;
    this.el.classList.add('hidden');
    this.warnEl.classList.remove('on');
    this.wrongEl.classList.remove('on');
  }

  private drawMap(): void {
    const sim = this.sim;
    if (!sim) return;
    const w = this.mapEl.clientWidth, hgt = this.mapEl.clientHeight;
    if (!w || !hgt) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.mapCanvas.width = Math.round(w * dpr);
    this.mapCanvas.height = Math.round(hgt * dpr);
    const tr = sim.track, N = 240;
    const pts: [number, number][] = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i <= N; i++) {
      const f = tr.sample((i / N) * tr.length);
      pts.push([f.pos.x, f.pos.z]);
      minX = Math.min(minX, f.pos.x); maxX = Math.max(maxX, f.pos.x); minZ = Math.min(minZ, f.pos.z); maxZ = Math.max(maxZ, f.pos.z);
    }
    const rot = maxZ - minZ > (maxX - minX) * 1.15 && w >= hgt;
    const spanU = rot ? maxZ - minZ : maxX - minX, spanV = rot ? maxX - minX : maxZ - minZ;
    const pad = 0.14;
    const s = Math.min((w * (1 - 2 * pad)) / Math.max(1, spanU), (hgt * (1 - 2 * pad)) / Math.max(1, spanV));
    this.mapXf = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, s, rot, w, h: hgt };
    const ctx = this.mapCanvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const path = () => {
      ctx.beginPath();
      pts.forEach(([x, z], i) => { const [u, v] = this.project(x, z); if (i) ctx.lineTo(u, v); else ctx.moveTo(u, v); });
      ctx.closePath();
    };
    const lw = Math.max(5, w * 0.06);
    path(); ctx.strokeStyle = 'rgba(14,22,48,.35)'; ctx.lineWidth = lw + 8; ctx.stroke();
    path(); ctx.strokeStyle = '#24304f'; ctx.lineWidth = lw + 4; ctx.stroke();
    path(); ctx.strokeStyle = '#fffaf0'; ctx.lineWidth = lw; ctx.stroke();
    // branches
    for (const b of tr.branches) {
      if (!b.enabled) continue;
      ctx.beginPath();
      for (let i = 0; i <= 30; i++) {
        const p = b.from + ((b.to - b.from + tr.length) % tr.length) * (i / 30);
        const f = tr.sample(p, 0, b.path);
        const [u, v] = this.project(f.pos.x, f.pos.z);
        if (i) ctx.lineTo(u, v); else ctx.moveTo(u, v);
      }
      ctx.setLineDash([lw * 0.5, lw * 0.6]); ctx.strokeStyle = 'rgba(255,250,240,.85)'; ctx.lineWidth = lw * 0.55; ctx.stroke(); ctx.setLineDash([]);
    }
    // start line
    const f0 = tr.sample(0);
    const [a1, b1] = this.project(f0.pos.x + f0.right.x * f0.halfWidth * 1.6, f0.pos.z + f0.right.z * f0.halfWidth * 1.6);
    const [a2, b2] = this.project(f0.pos.x - f0.right.x * f0.halfWidth * 1.6, f0.pos.z - f0.right.z * f0.halfWidth * 1.6);
    const dx = a2 - a1, dy = b2 - b1, len = Math.hypot(dx, dy) || 1;
    const nx = (dx / len) * lw * 0.9, ny = (dy / len) * lw * 0.9;
    const mx = (a1 + a2) / 2, my = (b1 + b2) / 2;
    ctx.strokeStyle = '#24304f'; ctx.lineWidth = lw * 0.5; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(mx - nx, my - ny); ctx.lineTo(mx + nx, my + ny); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.setLineDash([lw * 0.25, lw * 0.25]);
    ctx.beginPath(); ctx.moveTo(mx - nx, my - ny); ctx.lineTo(mx + nx, my + ny); ctx.stroke();
    ctx.setLineDash([]);
  }

  private project(x: number, z: number): [number, number] {
    const m = this.mapXf;
    const dx = (x - m.cx) * m.s, dz = (z - m.cz) * m.s;
    return m.rot ? [m.w / 2 + dz, m.h / 2 + dx] : [m.w / 2 + dx, m.h / 2 + dz];
  }

  private countdown(n: number): void {
    if (n > 3) return;
    this.countT.set(n > 0 ? String(n) : 'LOS!');
    toggleClass(this.countEl, 'go', n === 0);
    this.countEl.getAnimations().forEach((a) => a.cancel());
    this.countEl.animate(
      n > 0
        ? [{ opacity: 0, transform: 'scale(2.2)' }, { opacity: 1, transform: 'scale(1)', offset: 0.25 }, { opacity: 1, transform: 'scale(.92)', offset: 0.8 }, { opacity: 0, transform: 'scale(.8)' }]
        : [{ opacity: 0, transform: 'scale(.4) rotate(-8deg)' }, { opacity: 1, transform: 'scale(1.15) rotate(3deg)', offset: 0.2 }, { opacity: 1, transform: 'scale(1)', offset: 0.7 }, { opacity: 0, transform: 'scale(1.6)' }],
      { duration: n > 0 ? 950 : 1100, easing: 'ease-out', fill: 'forwards' },
    );
    if (n === 0) this.startHint.classList.remove('on');
  }

  private onLap(lap: number, lapTime: number): void {
    const sim = this.sim!;
    if (lap < 2) return;
    const t = lapTime > 0 ? lapTime : sim.raceTime - this.lapStart;
    this.lapStart = sim.raceTime;
    const prevBest = this.bestLap;
    this.bestLap = Math.min(this.bestLap, t);
    this.splitT.set(`Runde ${lap - 1}  ${fmtTime(t)}`);
    if (isFinite(prevBest)) {
      this.splitD.set(fmtDelta(t - prevBest));
      this.splitDEl.className = 'dl ' + (t < prevBest ? 'good' : 'bad');
    } else { this.splitD.set(''); }
    this.splitEl.animate([{ opacity: 0, transform: 'translateX(1em)' }, { opacity: 1, transform: 'none', offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 3600, fill: 'forwards' });
    if (lap === sim.laps && sim.laps > 1) this.showBanner('Letzte Runde!', true);
    else if (lap <= sim.laps) this.showBanner(`Runde ${lap}`, false);
  }

  private showBanner(text: string, final: boolean): void {
    this.bannerT.set(text);
    toggleClass(this.banner, 'final', final);
    this.banner.animate(
      [{ opacity: 0, transform: 'translateX(60%) skewX(-12deg)' }, { opacity: 1, transform: 'translateX(0) skewX(0)', offset: 0.18 }, { opacity: 1, transform: 'scale(1.05)', offset: 0.75 }, { opacity: 0, transform: 'translateX(-60%) skewX(12deg)' }],
      { duration: final ? 2400 : 1600, easing: 'ease-out', fill: 'forwards' },
    );
  }

  private onFinish(rank: number, _time: number): void {
    this.finished = true;
    const sim = this.sim!;
    this.finishP.set(sim.config.mode === 'timetrial' ? fmtTime(sim.player.race.finishTime || sim.raceTime) : `Platz ${rank}`);
    this.finishEl.animate([{ opacity: 0, transform: 'scale(.3) rotate(-10deg)' }, { opacity: 1, transform: 'scale(1.12) rotate(2deg)', offset: 0.35 }, { opacity: 1, transform: 'scale(1)' }], { duration: 700, easing: 'ease-out', fill: 'forwards' });
    this.flash('boost', 1);
    this.closeHint(true);
  }

  private onBoost(cause: string, _power: number): void {
    this.flash('boost', 0.7);
    const c = cause.toLowerCase();
    if (c.includes('drift') || c.includes('mini')) this.showPop(DRIFT_NAMES[Math.max(1, Math.min(3, this.lastDriftEnd || Number(c.replace(/\D/g, '')) || 1))]);
    else if (c.includes('trick')) this.showPop('Trick-Turbo!');
    else if (c.includes('start')) this.showPop('Superstart!');
    else if (c.includes('gold')) this.showPop('Gold-Turbo!');
    else if (c.includes('carrot')) this.showPop('Karotten-Turbo!');
    else if (c.includes('slip')) this.showPop('Windschatten!');
    else if (c === 'item') this.showPop('Turbo!');
  }

  private showPop(text: string): void {
    this.popT.set(text);
    this.pop.animate([{ opacity: 0, transform: 'translateY(.6em) scale(.6)' }, { opacity: 1, transform: 'scale(1.1)', offset: 0.2 }, { opacity: 1, transform: 'scale(1)', offset: 0.75 }, { opacity: 0, transform: 'translateY(-.5em)' }], { duration: 1100, easing: 'ease-out', fill: 'forwards' });
  }

  private flash(kind: 'hit' | 'boost' | 'shield', amount: number): void {
    this.vig.className = 'h-vig ' + kind;
    this.vig.animate([{ opacity: amount }, { opacity: 0 }], { duration: kind === 'hit' ? 650 : 500, easing: 'ease-out', fill: 'forwards' });
  }

  private shake(): void {
    this.el.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-6px,3px)' }, { transform: 'translate(5px,-3px)' }, { transform: 'translate(-3px,2px)' }, { transform: 'translate(0,0)' }], { duration: 280 });
  }

  private itemPop(): void {
    this.itemEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22) rotate(-6deg)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
  }

  private warn(item: string, from: number): void {
    const sim = this.sim!;
    this.warnIc.innerHTML = ITEM_ICONS[item] ?? ITEM_ICONS.itembox;
    const by = sim.karts.find((k) => k.id === from);
    this.warnT.set(by ? `${ITEM_NAMES[item] ?? 'Achtung'} von ${by.char.name}!` : `Achtung: ${ITEM_NAMES[item] ?? 'Angriff'}!`);
    this.warnEl.classList.add('on');
    this.warnTimer = 1.8;
  }

  queueHint(id: string): void {
    if (hintSeen(id) || this.finished || this.hintQueue.includes(id)) return;
    this.hintQueue.push(id);
  }

  private showHint(id: string): void {
    const hnt = HINTS[id];
    if (!hnt) return;
    markHint(id);
    this.hintTitle.set(hnt.title);
    this.hintText.set(hnt.text());
    this.hintEl.classList.add('on');
    this.hintTimer = 7;
  }

  private closeHint(silent = false): void {
    if (!silent && !this.hintEl.classList.contains('on')) return;
    this.hintEl.classList.remove('on');
    this.hintTimer = 0;
  }

  update(dt: number): void {
    const sim = this.sim;
    if (!sim) return;
    const p = sim.player;

    // lap + time
    this.lapV.set(String(Math.max(1, Math.min(sim.laps, p.race.lap || 1))));
    const t = p.race.finished ? p.race.finishTime : Math.max(0, sim.raceTime);
    this.time.set(t > 0 ? fmtTime(t) : '0:00.00');

    // position
    const rank = p.race.rank;
    if (rank !== this.lastRank) {
      this.posV.set(String(rank));
      this.posEl.className = 'h-pos h-out p' + rank;
      if (this.lastRank) this.posInner.animate([{ transform: 'scale(1.5) rotate(-8deg)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,1.5,.45,1)' });
      this.lastRank = rank;
    }

    // speed
    if (!this.arcLen) { this.arcLen = this.speedArc.getTotalLength?.() || 200; this.speedArc.style.strokeDasharray = `${this.arcLen}`; }
    const kmh = Math.abs(p.speed) * 3.6;
    const frac = Math.min(1, Math.abs(p.speed) / Math.max(1, p.topSpeed * 1.35));
    this.speedArc.style.strokeDashoffset = String(this.arcLen * (1 - frac));
    this.speedV.set(String(Math.round(kmh)));

    // item slot
    this.updateItem(p, dt);

    // ticker (hidden until the green light)
    if (sim.phase === 'racing' || sim.phase === 'finished') this.updateTicker(p);
    else for (const r of this.tickRows) toggleClass(r.el, 'hide', true);

    // map dots
    const karts = sim.karts;
    for (let i = 0; i < karts.length; i++) {
      const [u, v] = this.project(karts[i].renderPos.x, karts[i].renderPos.z);
      this.dots[i].style.transform = `translate(${u.toFixed(1)}px,${v.toFixed(1)}px)`;
    }

    // wrong way
    toggleClass(this.wrongEl, 'on', p.race.wrongWay && sim.phase === 'racing' && !p.race.finished);

    // warn
    if (this.warnTimer > 0) { this.warnTimer -= dt; if (this.warnTimer <= 0) this.warnEl.classList.remove('on'); }

    // drift meter
    const lvl = p.drift.active ? p.drift.level : -1;
    if (lvl !== this.driftLevel) {
      this.driftLevel = lvl;
      toggleClass(this.driftEl, 'on', lvl >= 0);
      this.driftPips.forEach((pip, i) => { pip.className = lvl > i ? 'l' + lvl : ''; });
    }

    // hints
    if (sim.phase === 'racing' && !p.race.finished) {
      this.racingFor += dt;
      if (this.racingFor > 3 && this.racingFor - dt <= 3) this.queueHint('drift');
    }
    if (this.hintTimer > 0) { this.hintTimer -= dt; if (this.hintTimer <= 0) this.closeHint(); }
    else if (this.hintQueue.length && sim.phase === 'racing' && !this.finished) this.showHint(this.hintQueue.shift()!);
  }

  private updateItem(p: Kart, dt: number): void {
    const slot = p.item;
    let show: string | null = null;
    const rolling = slot.roulette > 0;
    if (rolling) {
      this.rollT -= dt;
      if (this.rollT <= 0) {
        this.rollT = 0.075 + Math.max(0, 0.6 - slot.roulette) * 0.12;
        this.rollIdx = (this.rollIdx + 1 + Math.floor(Math.random() * 3)) % (ITEM_IDS.length - 1);
        show = ITEM_IDS[this.rollIdx];
        this.setIcon(show, true);
      }
    } else if (slot.id !== this.lastItem || (this.itemOn && !slot.id)) {
      this.setIcon(slot.id ? (ITEM_ICONS[slot.id] ? slot.id : 'itembox') : null, false);
    }
    if (!rolling) this.lastItem = slot.id;
    toggleClass(this.itemEl, 'rolling', rolling);
    toggleClass(this.itemEl, 'holding', slot.holding);
    const cnt = !rolling && slot.id && slot.count > 1 ? `×${slot.count}` : '';
    this.itemCount.set(cnt);
    toggleClass(this.itemCountEl, 'on', !!cnt);
  }

  private setIcon(id: string | null, rolling: boolean): void {
    const el = id ? this.itemIcons.get(id) ?? null : null;
    if (el === this.itemOn && !rolling) return;
    if (this.itemOn) this.itemOn.classList.remove('on');
    if (el) {
      if (rolling) { el.classList.remove('on'); void 0; }
      el.classList.add('on');
    }
    this.itemOn = el;
  }

  private updateTicker(p: Kart): void {
    const s = this.sorted;
    s.sort((a, b) => a.race.rank - b.race.rank);
    const i = s.indexOf(p);
    let start = Math.max(0, Math.min(s.length - 3, i - 1));
    if (s.length < 3) start = 0;
    const spd = Math.max(8, Math.abs(p.speed));
    for (let r = 0; r < 3; r++) {
      const row = this.tickRows[r];
      const k = s[start + r];
      if (!k) { toggleClass(row.el, 'hide', true); continue; }
      toggleClass(row.el, 'hide', false);
      if (row.kart !== k) {
        row.kart = k;
        row.n.set(k.char.name);
        row.dot.style.background = k.char.color;
        toggleClass(row.el, 'me', k === p);
      }
      row.p.set(String(k.race.rank));
      if (k === p || p.race.finished || k.race.finished) row.g.set('');
      else {
        const gap = (k.race.distance - p.race.distance) / spd;
        row.g.set((gap > 0 ? '▲ ' : '▼ ') + Math.abs(gap).toFixed(1));
      }
    }
  }
}
