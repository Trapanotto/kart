// Menüs (DOM) inkl. Tastatur- und Gamepad-Navigation
import { CHARACTERS, CLASSES, TRACKS, CUPS, THEMES, POINTS, sampleCenterline } from './data.js';
import { CONTROLS_HELP } from './input.js';
import { fmtTime } from './hud.js';
import { trophy, award, mirrorUnlocked, TROPHY_ICON, medalTimes, medalFor } from './progress.js';

const portrait = (id) => `assets/portraits/${id}.webp`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function trackThumb(def, w = 160, h = 110) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const th = THEMES[def.theme];
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.ground);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const { points } = sampleCenterline(def.shape);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]); }
  const sc = Math.min((w - 24) / (maxX - minX), (h - 24) / (maxZ - minZ));
  const ox = (w - (maxX - minX) * sc) / 2 - minX * sc, oz = (h - (maxZ - minZ) * sc) / 2 - minZ * sc;
  const path = () => { ctx.beginPath(); points.forEach((p, i) => (i ? ctx.lineTo(p[0] * sc + ox, p[2] * sc + oz) : ctx.moveTo(p[0] * sc + ox, p[2] * sc + oz))); ctx.closePath(); };
  ctx.lineJoin = 'round';
  path(); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 9; ctx.stroke();
  path(); ctx.strokeStyle = th.road; ctx.lineWidth = 6; ctx.stroke();
  path(); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1; ctx.stroke();
  return c.toDataURL();
}

export class Menu {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('ui');
    this.flow = {};
    this.stack = [];
    this.padPrev = {};
    this.padRepeat = 0;
    this.thumbs = {};
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('button, .card')) app.audio.click();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.el.addEventListener('mouseover', (e) => {
      const b = e.target.closest('.focusable');
      if (b && !b.disabled) b.focus({ preventScroll: true });
    });
  }

  thumb(def) { return (this.thumbs[def.id] ||= trackThumb(def)); }

  show(html, { back = null, cls = '' } = {}) {
    this.el.className = 'visible ' + cls;
    this.el.innerHTML = `<div class="screen">${html}</div>`;
    this.back = back;
    const first = this.el.querySelector('[autofocus]') || this.el.querySelector('.focusable');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
    this.el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this.act(b.dataset.act, b.dataset)));
  }

  hide() { this.el.className = ''; this.el.innerHTML = ''; }
  visible() { return this.el.classList.contains('visible'); }

  act(a, d) {
    const app = this.app;
    const f = this.flow;
    switch (a) {
      case 'mode': f.mode = d.v; f.chars = []; f.players = 1;
        if (f.mode === 'vs') app.vsWins = {};
        if (f.mode === 'tt') { f.players = 1; this.classes(); } else this.players(); break;
      case 'players': f.players = +d.v; this.classes(); break;
      case 'class': f.cls = +d.v; f.chars = []; this.chars(); break;
      case 'char': this.pickChar(d.v); break;
      case 'track': f.track = +d.v; this.start(); break;
      case 'cup': f.cup = +d.v; this.start(); break;
      case 'back': this.goBack(); break;
      case 'options': this.options(); break;
      case 'controls': this.controls(); break;
      case 'title': this.title(); break;
      case 'resume': app.resume(); break;
      case 'restart': app.restartRace(); break;
      case 'quit': app.quitRace(); break;
      case 'again': app.restartRace(); break;
      case 'tracks': app.quitRace(false); this.tracks(); break;
      case 'gpnext': this.gpStandings(); break;
      case 'gprace': app.nextGpRace(); break;
      case 'podium': this.podium(); break;
    }
  }

  goBack() {
    if (this.back) { this.app.audio.back(); this.back(); }
  }

  // ------------------------------------------------------------ Bildschirme
  title() {
    this.app.showroom.setMode('title');
    this.app.audio.playSong(8);
    this.show(`
      <div class="logo"><span class="paw">🐾</span><h1>Trapanotto<br>Kart</h1><p>Das flauschigste Kart-Rennen der Welt</p></div>
      <div class="menu-col">
        <button class="btn big focusable" data-act="mode" data-v="gp" autofocus>🏆 Grand Prix</button>
        <button class="btn big focusable" data-act="mode" data-v="single">🏁 Einzelrennen</button>
        <button class="btn big focusable" data-act="mode" data-v="vs">⚔️ Versus</button>
        <button class="btn big focusable" data-act="mode" data-v="tt">⏱️ Zeitfahren</button>
        <div class="row">
          <button class="btn focusable" data-act="options">⚙️ Optionen</button>
          <button class="btn focusable" data-act="controls">🎮 Steuerung</button>
        </div>
      </div>
      <footer>Tiere in Blender modelliert · läuft mit three.js im Browser</footer>`, { cls: 'title' });
  }

  players() {
    const pads = this.app.input.pads().length;
    this.show(`<h2>Wie viele Spieler?</h2>
      <div class="grid4">
        ${(this.flow.mode === 'vs' ? [2, 3, 4] : [1, 2, 3, 4]).map((n, ni) => `<button class="card focusable" data-act="players" data-v="${n}" ${ni === 0 ? 'autofocus' : ''}>
          <div class="big-ico">${'🐾'.repeat(n)}</div><b>${n} Spieler</b>
          <small>${n === 1 ? 'Gegen 7 Computer-Tiere' : n === 2 ? 'Tastatur geteilt oder Gamepads' : 'Braucht Gamepads'}${this.flow.mode === 'vs' ? ' · ohne Computer' : ''}</small></button>`).join('')}
      </div>
      <p class="hint">${pads ? `🎮 ${pads} Gamepad${pads > 1 ? 's' : ''} erkannt` : 'Tipp: Gamepads werden erkannt, sobald du eine Taste drückst.'}</p>
      <button class="btn back focusable" data-act="back">← Zurück</button>`, { back: () => this.title() });
  }

  classes() {
    const back = this.flow.mode === 'tt' ? () => this.title() : () => this.players();
    this.show(`<h2>Wie schnell?</h2>
      <div class="grid4">
        ${CLASSES.map((c, i) => {
          const locked = c.mirror && !mirrorUnlocked(this.app.progress);
          return `<button class="card focusable" data-act="class" data-v="${i}" ${i === 1 ? 'autofocus' : ''} ${locked ? 'disabled' : ''}>
          <div class="big-ico">${locked ? '🔒' : c.icon}</div><b>${c.name}</b>
          <small>${locked ? 'Gold in allen Cups (Flott oder Turbo) schaltet frei' : ['Für Einsteiger und Kinder', 'Der normale Spass', 'Für Profis', 'Alle Strecken gespiegelt'][i]}</small></button>`;
        }).join('')}
      </div>
      <button class="btn back focusable" data-act="back">← Zurück</button>`, { back });
  }

  chars() {
    const f = this.flow;
    const pi = f.chars.length;
    this.app.showroom.setMode('select', CHARACTERS[0].id);
    const bar = (v) => `<span class="bar"><i style="width:${v * 20}%"></i></span>`;
    this.show(`<h2 class="left">${f.players > 1 ? `Spieler ${pi + 1}: ` : ''}Wähle dein Tier</h2>
      <div class="charsel">
        <div class="chargrid">
          ${CHARACTERS.map((c, i) => {
            const taken = f.chars.indexOf(c.id);
            return `<button class="card char focusable" data-act="char" data-v="${c.id}" data-i="${i}" style="--c:${c.color}" ${taken >= 0 ? 'disabled' : ''} ${i === CHARACTERS.findIndex((x) => !f.chars.includes(x.id)) ? 'autofocus' : ''}>
              <img src="${portrait(c.id)}" alt="${esc(c.animal)}">
              <b>${esc(c.name)}</b>${taken >= 0 ? `<span class="badge">S${taken + 1}</span>` : ''}</button>`;
          }).join('')}
        </div>
        <div class="charinfo"></div>
      </div>
      <button class="btn back focusable" data-act="back">← Zurück</button>`, {
      back: () => { if (f.chars.length) { f.chars.pop(); this.chars(); } else this.classes(); }, cls: 'select',
    });
    const info = this.el.querySelector('.charinfo');
    const showInfo = (id) => {
      const c = CHARACTERS.find((x) => x.id === id);
      this.app.showroom.show(id);
      info.innerHTML = `<h3>${esc(c.name)} <small>${c.art} ${esc(c.animal)}</small></h3><p>${esc(c.desc)}</p>
        <div class="perk">⭐ ${esc(c.perk)}</div>
        <div class="stats"><span>Tempo</span>${bar(c.speed)}<span>Beschl.</span>${bar(c.accel)}<span>Handling</span>${bar(c.handling)}
        <span>Drift</span>${bar(c.drift)}<span>Gewicht</span>${bar(c.weight * 1.66)}</div>`;
    };
    this.el.querySelectorAll('.char').forEach((b) => b.addEventListener('focus', () => showInfo(b.dataset.v)));
    showInfo(CHARACTERS[0].id);
  }

  pickChar(id) {
    const f = this.flow;
    f.chars.push(id);
    this.app.audio.select();
    if (f.chars.length < f.players) this.chars();
    else if (f.mode === 'gp') this.cups();
    else this.tracks();
  }

  cups() {
    this.app.showroom.setMode('title');
    this.show(`<h2>Wähle einen Cup</h2>
      <div class="grid2">
        ${CUPS.map((c, i) => `<button class="card cup focusable" data-act="cup" data-v="${i}" ${i === 0 ? 'autofocus' : ''}>
          <div class="big-ico">${c.icon}</div><b>${esc(c.name)}</b>
          <div class="trophies">${CLASSES.map((k, ci) => `<span title="${k.name}">${k.icon}${TROPHY_ICON[trophy(this.app.progress, ci, i)] || '<i>–</i>'}</span>`).join('')}</div>
          <div class="cuptracks">${TRACKS.filter((t) => t.cup === i).map((t) => `<span><img src="${this.thumb(t)}">${esc(t.name)}</span>`).join('')}</div>
        </button>`).join('')}
      </div>
      <button class="btn back focusable" data-act="back">← Zurück</button>`, { back: () => { this.flow.chars.pop(); this.chars(); } });
  }

  tracks() {
    this.app.showroom.setMode('title');
    const f = this.flow;
    const rec = (t) => {
      try {
        const g = JSON.parse(localStorage.getItem('pgp_ghost_' + t.id) || 'null');
        return g ? fmtTime(g.time) + ' ' + TROPHY_ICON[medalFor(g.time, sampleCenterline(t.shape).length)] : '';
      } catch (e) { return ''; }
    };
    this.show(`<h2>Wähle eine Strecke</h2>
      ${CUPS.map((c, ci) => `<h4>${c.icon} ${esc(c.name)}</h4><div class="grid4 tracks">
        ${TRACKS.map((t, i) => (t.cup !== ci ? '' : `<button class="card track focusable" data-act="track" data-v="${i}" ${i === 0 ? 'autofocus' : ''}>
          <img src="${this.thumb(t)}"><b>${esc(t.name)}</b>${f.mode === 'tt' && rec(t) ? `<small>Rekord ${rec(t)}</small>` : ''}</button>`)).join('')}
      </div>`).join('')}
      <button class="btn back focusable" data-act="back">← Zurück</button>`, { back: () => { f.chars.pop(); this.chars(); }, cls: 'wide' });
  }

  start() {
    const f = this.flow;
    const players = f.chars.map((c) => ({ char: c }));
    if (f.mode === 'gp') this.app.startGp(f.cup, f.cls, players);
    else this.app.startRace({ mode: f.mode, track: f.track, cls: f.cls, players });
  }

  options() {
    const s = this.app.settings;
    this.show(`<h2>Optionen</h2>
      <div class="opts">
        <label class="focusable" tabindex="0"><input type="checkbox" id="o-fur" ${s.fur ? 'checked' : ''}> Flauschiges Fell (Shader)</label>
        <label class="focusable" tabindex="0"><input type="checkbox" id="o-shadows" ${s.shadows ? 'checked' : ''}> Schatten</label>
        <label class="focusable" tabindex="0"><input type="checkbox" id="o-bloom" ${s.bloom ? 'checked' : ''}> Leuchteffekte</label>
        <label>Grafik
          <select id="o-quality" class="focusable">
            <option value="0.75" ${s.quality == 0.75 ? 'selected' : ''}>Schnell</option>
            <option value="1" ${s.quality == 1 ? 'selected' : ''}>Normal</option>
            <option value="2" ${s.quality == 2 ? 'selected' : ''}>Scharf</option>
          </select></label>
        <label>Musik <input type="range" id="o-music" min="0" max="1" step="0.05" value="${s.music}" class="focusable"></label>
        <label>Effekte <input type="range" id="o-sfx" min="0" max="1" step="0.05" value="${s.sfx}" class="focusable"></label>
        <p class="hint">Fell und Schatten gelten ab dem nächsten Rennen. Bei Ruckeln: Fell, Schatten oder Leuchteffekte ausschalten.</p>
      </div>
      <button class="btn back focusable" data-act="back">← Zurück</button>`, { back: () => this.title() });
    const save = () => {
      s.fur = this.el.querySelector('#o-fur').checked;
      s.shadows = this.el.querySelector('#o-shadows').checked;
      s.bloom = this.el.querySelector('#o-bloom').checked;
      s.quality = +this.el.querySelector('#o-quality').value;
      s.music = +this.el.querySelector('#o-music').value;
      s.sfx = +this.el.querySelector('#o-sfx').value;
      this.app.applySettings();
    };
    this.el.querySelectorAll('input, select').forEach((i) => i.addEventListener('input', save));
  }

  controls() {
    const row = ([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`;
    this.show(`<h2>Steuerung</h2>
      <div class="ctrl">
        <div><h4>Allein</h4><table>${CONTROLS_HELP.solo.map(row).join('')}</table></div>
        <div><h4>Mehrere Spieler</h4><table>${CONTROLS_HELP.multi.map(row).join('')}</table></div>
      </div>
      <div class="tips">
        <p>💨 <b>Drift-Boost:</b> Sprungtaste halten und in die Kurve lenken. Funken werden <span style="color:#4FC3FF">blau</span> → <span style="color:#FF9A2B">orange</span> → <span style="color:#C77DFF">lila</span>. Loslassen gibt Turbo!</p>
        <p>🚀 <b>Super-Start:</b> Beim Countdown ab der „2“ Gas geben.</p>
        <p>🤸 <b>Trick:</b> Nach einer Rampe in der Luft die Sprungtaste drücken.</p>
        <p>🎁 <b>Items:</b> 🌰 Eichel · 🍯 Honig · 🎁 falsche Box · 🌰🌰🌰 kreisende Eicheln · 🧶 Wollknäuel (verfolgt) · 🐝 Bienen (jagen den Ersten) · 🫧 Schild · 🥕 Turbo · ✨ Goldkarotte (7 s Dauer-Turbo) · 🍭 Lolli (unbesiegbar) · 🌧️ Wolke (weitergeben!) · 💤 Gähn-Welle</p>
        <p>🛡️ <b>Festhalten:</b> Item-Taste gedrückt halten – Eichel, Honig und falsche Box schützen dich dann von hinten. Loslassen wirft bzw. legt ab.</p>
        <p>💨 <b>Windschatten:</b> Dicht hinter einem Gegner bleiben gibt einen Turbo.</p>
        <p>🏆 <b>Grand Prix:</b> Platz 4 oder besser zum Weiterkommen. Gold in allen Cups schaltet den Spiegel-Modus frei.</p>
      </div>
      <button class="btn back focusable" data-act="back" autofocus>← Zurück</button>`, { back: () => this.title() });
  }

  pause() {
    this.show(`<h2>Pause</h2>
      <div class="menu-col">
        <button class="btn big focusable" data-act="resume" autofocus>▶ Weiter</button>
        <button class="btn focusable" data-act="restart">↻ Neu starten</button>
        <button class="btn focusable" data-act="quit">✕ Hauptmenü</button>
      </div>`, { back: () => this.app.resume(), cls: 'overlay' });
  }

  results(res) {
    const gp = this.app.gp;
    const rows = res.list.map((r) => `
      <tr class="${r.human !== null ? 'me' : ''}">
        <td class="pl">${r.place}.</td><td><img src="${portrait(r.char.id)}"></td>
        <td>${esc(r.char.name)}${r.human !== null && this.app.lastPlayers > 1 ? ` <span class="badge">S${r.human + 1}</span>` : ''}${r.k.rival ? ' <span class="badge rival">Rivale</span>' : ''}</td>
        <td>${r.est ? '–' : fmtTime(r.time)}</td>
        ${gp ? `<td class="pts">+${POINTS[r.place - 1] || 0}</td>` : ''}
      </tr>`).join('');
    let extra = '';
    if (res.mode === 'tt') {
      const me = res.list[0];
      extra = `<div class="laps">${me.laps.map((t, i) => `<span>Runde ${i + 1}: <b>${fmtTime(t)}</b></span>`).join('')}</div>
        ${res.newRecord ? '<div class="record">🎉 Neuer Rekord! Dein Geist fährt beim nächsten Mal mit.</div>' : `<div class="hint">Rekord: ${fmtTime(res.best)}</div>`}`;
      const len = sampleCenterline(res.track.shape).length, mt = medalTimes(len), got = medalFor(me.time, len);
      extra += `<div class="medals">${['gold', 'silver', 'bronze'].map((m, i) => `<span class="${got === i + 1 ? 'got' : ''}">${TROPHY_ICON[i + 1]} ${fmtTime(mt[m])}</span>`).join('')}</div>
        ${got ? `<div class="record">${TROPHY_ICON[got]} ${['Gold', 'Silber', 'Bronze'][got - 1]}-Medaille!</div>` : '<div class="hint">Unter der Bronze-Zeit gibt es eine Medaille.</div>'}`;
    }
    if (res.mode === 'vs') {
      const wins = this.app.vsWins;
      extra = `<div class="medals">${res.list.map((r) => `<span>S${r.human + 1} ${esc(r.char.name)}: <b>${wins[r.human] || 0}</b> Siege</span>`).join('')}</div>`;
    }
    if (res.failed) {
      extra += '<div class="record fail">😿 Nicht qualifiziert – du musst mindestens Platz 4 schaffen.</div>';
    }
    const buttons = gp && res.failed
      ? `<button class="btn big focusable" data-act="again" autofocus>↻ Nochmal versuchen</button>
         <button class="btn focusable" data-act="quit">Aufgeben</button>`
      : gp
      ? `<button class="btn big focusable" data-act="gpnext" autofocus>Weiter ▶</button>`
      : `<button class="btn big focusable" data-act="again" autofocus>↻ Nochmal</button>
         <button class="btn focusable" data-act="tracks">Andere Strecke</button>
         <button class="btn focusable" data-act="quit">Hauptmenü</button>`;
    this.show(`<h2>${esc(res.track.name)}${gp ? ` <small>Rennen ${gp.race + 1}/4</small>` : ''}</h2>
      <table class="results">${rows}</table>${extra}
      <div class="row center">${buttons}</div>`, { cls: 'overlay', back: null });
  }

  gpStandings() {
    const app = this.app;
    const gp = app.gp;
    const list = Object.entries(gp.points).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, list[0][1]);
    const last = gp.race >= 3;
    this.show(`<h2>${CUPS[gp.cup].icon} ${esc(CUPS[gp.cup].name)} <small>Wertung nach Rennen ${gp.race + 1}/4</small></h2>
      <table class="results standings">${list.map(([id, p], i) => {
        const c = CHARACTERS.find((x) => x.id === id);
        const me = gp.players.some((pl) => pl.char === id);
        return `<tr class="${me ? 'me' : ''}"><td class="pl">${i + 1}.</td><td><img src="${portrait(id)}"></td><td>${esc(c.name)}</td>
          <td class="barcell"><span class="bar"><i style="width:${(p / max) * 100}%;background:${c.color}"></i></span></td><td class="pts">${p}</td></tr>`;
      }).join('')}</table>
      <div class="row center">${last
        ? '<button class="btn big focusable" data-act="podium" autofocus>🏆 Siegerehrung</button>'
        : `<button class="btn big focusable" data-act="gprace" autofocus>Nächstes Rennen: ${esc(TRACKS[app.gpTracks()[gp.race + 1]].name)} ▶</button>`}
        <button class="btn focusable" data-act="quit">Aufgeben</button></div>`, { cls: 'overlay' });
  }

  podium() {
    const app = this.app;
    const gp = app.gp;
    const list = Object.entries(gp.points).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    app.endRace();
    app.showroom.setMode('podium', list);
    app.audio.finish(true);
    const winner = CHARACTERS.find((c) => c.id === list[0]);
    const myBest = Math.min(...gp.players.map((p) => list.indexOf(p.char) + 1));
    const wasMirror = mirrorUnlocked(app.progress);
    const isNew = award(app.progress, gp.cls, gp.cup, myBest);
    const unlocked = !wasMirror && mirrorUnlocked(app.progress);
    this.show(`<div class="podium-text"><h2>🏆 ${esc(winner.name)} gewinnt den ${esc(CUPS[gp.cup].name)}!</h2>
      <p>${myBest === 1 ? 'Wahnsinn – der Pokal gehört dir! 🎉' : myBest <= 3 ? `Super – Platz ${myBest} auf dem Podest!` : `Du bist ${myBest}. geworden. Beim nächsten Mal klappt's!`}</p>
      ${isNew ? `<p class="newtrophy">${TROPHY_ICON[myBest]} Neuer Pokal für ${esc(CLASSES[gp.cls].name)}!</p>` : ''}
      ${unlocked ? '<p class="newtrophy">🪞 Spiegel-Modus freigeschaltet!</p>' : ''}
      <button class="btn big focusable" data-act="title" autofocus>Hauptmenü</button></div>`, { cls: 'podium', back: null });
    app.gp = null;
  }

  // ------------------------------------------------------------ Navigation
  onKey(e) {
    if (!this.visible()) return;
    if (e.code === 'Escape' || e.code === 'Backspace') {
      if (e.target instanceof HTMLInputElement && e.code === 'Backspace') return;
      e.preventDefault();
      this.goBack();
      return;
    }
    const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.code];
    if (dir && !(e.target instanceof HTMLInputElement && e.target.type === 'range' && dir[0])) {
      e.preventDefault();
      this.move(dir);
    }
  }

  move([dx, dy]) {
    const items = [...this.el.querySelectorAll('.focusable')].filter((b) => !b.disabled && b.offsetParent);
    const cur = document.activeElement;
    if (!items.includes(cur)) { items[0]?.focus(); return; }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bd = Infinity;
    for (const b of items) {
      if (b === cur) continue;
      const r = b.getBoundingClientRect();
      const bx = r.left + r.width / 2, by = r.top + r.height / 2;
      const along = (bx - ax) * dx + (by - ay) * dy;
      if (along <= 4) continue;
      const side = Math.abs((bx - ax) * dy) + Math.abs((by - ay) * dx);
      const d = along + side * 2.5;
      if (d < bd) { bd = d; best = b; }
    }
    if (best) { best.focus(); this.app.audio.tone(700, 0.03, { type: 'triangle', vol: 0.06 }); }
  }

  // Gamepad im Menü
  update(dt) {
    if (!this.visible()) return;
    const pads = this.app.input.pads();
    this.padRepeat -= dt;
    for (const p of pads) {
      const b = (i) => p.buttons[i] && p.buttons[i].pressed;
      const prev = (this.padPrev[p.index] ||= {});
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      let dir = null;
      if (b(12) || ay < -0.6) dir = [0, -1];
      else if (b(13) || ay > 0.6) dir = [0, 1];
      else if (b(14) || ax < -0.6) dir = [-1, 0];
      else if (b(15) || ax > 0.6) dir = [1, 0];
      if (dir && this.padRepeat <= 0) { this.move(dir); this.padRepeat = 0.22; }
      if (!dir && !prev.dir) this.padRepeat = 0;
      prev.dir = !!dir;
      if (b(0) && !prev.a) document.activeElement?.click?.();
      if ((b(1) || b(9)) && !prev.b) this.goBack();
      prev.a = b(0);
      prev.b = b(1) || b(9);
    }
  }
}
