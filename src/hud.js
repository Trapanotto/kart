// Anzeige während des Rennens
import { ITEMS } from './data.js';

export function fmtTime(t) {
  if (!isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = Math.floor(t % 60), c = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

const ROLL = Object.values(ITEMS).map((i) => i.icon);

export class Hud {
  constructor(race) {
    this.race = race;
    this.root = document.getElementById('hud');
    this.root.innerHTML = '';
    this.root.className = 'n' + race.humans.length;
    this.vps = race.humans.map((k, i) => {
      const el = document.createElement('div');
      el.className = 'vp';
      el.innerHTML = `
        <div class="h-item"><div class="slot"><span class="icon"></span><span class="count"></span></div></div>
        <div class="h-lap"><div class="lap"></div><div class="time"></div><div class="best"></div></div>
        <div class="h-pos"><span class="num"></span><span class="suf">.</span></div>
        <div class="h-msg"></div>
        <div class="h-wrong">↩ Falsche Richtung!</div>
        <div class="h-drift"><i></i><i></i><i></i></div>
        ${race.humans.length > 1 ? `<div class="h-tag" style="--c:${k.char.color}">S${i + 1}</div>` : ''}`;
      this.root.appendChild(el);
      return {
        el, k, icon: el.querySelector('.icon'), count: el.querySelector('.count'), slot: el.querySelector('.slot'),
        lap: el.querySelector('.lap'), time: el.querySelector('.time'), best: el.querySelector('.best'),
        num: el.querySelector('.num'), msg: el.querySelector('.h-msg'), wrong: el.querySelector('.h-wrong'),
        drift: el.querySelectorAll('.h-drift i'), msgT: 0, lastRank: 0,
      };
    });
    this.big = document.createElement('div');
    this.big.className = 'h-big';
    this.root.appendChild(this.big);
    this.mapCanvas = document.createElement('canvas');
    this.mapCanvas.className = 'h-map';
    this.root.appendChild(this.mapCanvas);
    this.buildMap();
    this.layout();
  }

  layout() {
    const n = this.vps.length;
    this.vps.forEach((v, i) => {
      const r = this.race.viewRect(i, n, 1, 1); // Anteile
      Object.assign(v.el.style, { left: r.x * 100 + '%', top: (1 - r.y - r.h) * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
    });
  }

  buildMap() {
    const tr = this.race.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of tr.P) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const S = 220, pad = 16;
    const sc = (S - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    this.map = { S, sc, ox: pad + ((S - pad * 2) - (maxX - minX) * sc) / 2 - minX * sc, oz: pad + ((S - pad * 2) - (maxZ - minZ) * sc) / 2 - minZ * sc };
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    ctx.lineJoin = 'round';
    const path = () => {
      ctx.beginPath();
      tr.P.forEach((p, i) => { const x = p.x * sc + this.map.ox, y = p.z * sc + this.map.oz; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath();
    };
    path(); ctx.strokeStyle = 'rgba(40,30,60,0.55)'; ctx.lineWidth = 14; ctx.stroke();
    path(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 8; ctx.stroke();
    const p0 = tr.P[0];
    ctx.fillStyle = '#222';
    ctx.fillRect(p0.x * sc + this.map.ox - 5, p0.z * sc + this.map.oz - 5, 10, 10);
    this.mapBg = c;
    this.mapCanvas.width = this.mapCanvas.height = S;
  }

  drawMap() {
    const ctx = this.mapCanvas.getContext('2d');
    const { sc, ox, oz, S } = this.map;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.mapBg, 0, 0);
    const list = [...this.race.karts].sort((a, b) => (a.human !== null) - (b.human !== null));
    for (const k of list) {
      const x = k.pos.x * sc + ox, y = k.pos.z * sc + oz;
      const r = k.human !== null ? 7 : 5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = k.char.color;
      ctx.fill();
      ctx.lineWidth = k.human !== null ? 3 : 1.5;
      ctx.strokeStyle = k.human !== null ? '#FFD447' : '#333';
      ctx.stroke();
    }
    if (this.race.ghost) {
      const g = this.race.ghost.model.root.position;
      ctx.beginPath();
      ctx.arc(g.x * sc + ox, g.z * sc + oz, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fill();
    }
  }

  message(i, text, dur = 1.6) {
    const v = this.vps[i];
    if (!v) return;
    v.msg.textContent = text;
    v.msg.classList.remove('show');
    void v.msg.offsetWidth;
    v.msg.classList.add('show');
    v.msgT = dur;
  }

  bigText(text, cls = '') {
    this.big.textContent = text;
    this.big.className = 'h-big show ' + cls;
    void this.big.offsetWidth;
  }
  hideBig() { this.big.className = 'h-big'; }

  update(dt) {
    const race = this.race;
    const laps = race.laps;
    for (const v of this.vps) {
      const k = v.k;
      v.lap.textContent = k.finished ? 'Ziel!' : `Runde ${Math.max(1, Math.min(laps, k.lap))}/${laps}`;
      v.time.textContent = fmtTime(k.finished ? k.finishTime : race.state === 'race' ? race.time : 0);
      if (race.mode === 'tt') v.best.textContent = race.bestTime ? 'Rekord ' + fmtTime(race.bestTime) : '';
      if (k.rank !== v.lastRank) {
        v.num.textContent = k.rank;
        v.num.parentElement.dataset.rank = k.rank;
        v.num.parentElement.classList.remove('pop');
        void v.num.offsetWidth;
        v.num.parentElement.classList.add('pop');
        v.lastRank = k.rank;
      }
      if (k.rolling > 0) {
        v.icon.textContent = ROLL[Math.floor(race.time * 14) % ROLL.length];
        v.slot.classList.add('rolling');
        v.count.textContent = '';
      } else {
        v.slot.classList.remove('rolling');
        v.icon.textContent = k.item ? ITEMS[k.item].icon : '';
        v.count.textContent = k.item && k.itemCount > 1 ? '×' + k.itemCount : '';
      }
      v.slot.classList.toggle('cloud', k.cloud > 0);
      if (k.cloud > 0 && !k.item && k.rolling <= 0) v.icon.textContent = '🌧️';
      v.wrong.classList.toggle('show', k.wrongWay > 1);
      const lvl = k.drift.on ? k.drift.level : -1;
      v.drift.forEach((d, i) => d.classList.toggle('on', lvl > i));
      v.el.querySelector('.h-drift').classList.toggle('show', k.drift.on);
      if (v.msgT > 0) { v.msgT -= dt; if (v.msgT <= 0) v.msg.classList.remove('show'); }
    }
    this.drawMap();
  }

  dispose() { this.root.innerHTML = ''; }
}
