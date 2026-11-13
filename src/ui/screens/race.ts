// Loading, pause, results, Grand Prix standings and podium, time-trial results.
import { CHARACTERS, POINTS, character } from '../../core/data';
import type { CharacterId, RaceResult } from '../../core/types';
import { audioBridge } from '../../audio/bridge';
import { h, fmtTime, fmtDelta, LiveText } from '../dom';
import { UI_ICONS, trackTheme } from '../icons';
import { button, footer, header, portrait, screenEl, stagger, type Screen } from '../router';
import { awardTrophy, submitPb, type Trophy } from '../storage';
import { CUP } from '../tracks';
import type { UiCtx } from '../context';

const TIPS = [
  'Halte <b>Drift</b> lange gedrückt: Blaue, dann orange und lila Funken geben immer mehr Turbo.',
  'Trag ein Item <b>hinter dir</b>, um Eicheln und Honig abzuwehren.',
  'Hinten im Feld gibt es die <b>stärkeren Items</b>. Aufgeben gilt nicht!',
  'Direkt nach einer Rampe drücken: ein <b>Trick</b> gibt dir einen kleinen Turbo.',
  'Fahr dicht hinter einem Gegner, um seinen <b>Windschatten</b> zu nutzen.',
  'Gib kurz vor <b>LOS!</b> Gas für einen Superstart.',
  'Jede Runde verändert sich die Strecke. <b>Augen auf!</b>',
  'Eine <b>Seifenblase</b> schützt dich vor genau einem Treffer.',
];

// ---------------------------------------------------------------- loading
export function loadingScreen(ctx: UiCtx, trackName: string): Screen & { progress(done: number, total: number, label: string): void; setName(n: string): void } {
  const th = trackTheme(trackName);
  const bar = h('i');
  const label = new LiveText();
  const name = h('div.tk-title-chip.nm', trackName);
  const emb = h('div.emb', { html: th.emblem });
  emb.style.setProperty('--tf', th.from); emb.style.setProperty('--tt', th.to);
  const tip = h('div.tk-tip', { html: 'Tipp: ' + TIPS[Math.floor(Math.random() * TIPS.length)] });
  const mode = ctx.state.mode === 'grandprix' && ctx.state.gp ? `Grand Prix · Rennen ${ctx.state.gp.index + 1} von ${ctx.state.gp.tracks.length}` : ctx.state.mode === 'timetrial' ? 'Zeitfahren' : 'Einzelrennen';
  const el = screenEl('tk-loading', 'solid',
    emb,
    h('div.sub', mode),
    name,
    h('div.tk-progress', bar),
    h('div.sub', { style: { fontSize: '.85em', opacity: '.85' } }, label.node),
    tip,
  );
  let shown = 0;
  return {
    name: 'loading', el,
    progress(done, total, l) {
      const f = total > 0 ? Math.min(1, done / total) : 0;
      shown = Math.max(shown, f);
      bar.style.transform = `scaleX(${shown})`;
      label.set(l ? `Lade ${l} …` : '');
    },
    setName(n) {
      name.textContent = n;
      const t = trackTheme(n);
      emb.innerHTML = t.emblem; emb.style.setProperty('--tf', t.from); emb.style.setProperty('--tt', t.to);
    },
  };
}

// ---------------------------------------------------------------- pause
export function pauseScreen(ctx: UiCtx): Screen {
  const sim = ctx.app.sim;
  const info = sim ? `${sim.track.meta.name} · Runde ${Math.max(1, Math.min(sim.laps, sim.player.race.lap || 1))}/${sim.laps}` : '';
  const resume = () => ctx.app.setPaused(false);
  const quit = () => {
    if (ctx.state.gp) ctx.router.show(confirmScreen(ctx, 'Grand Prix beenden?', 'Deine Punkte in diesem Cup gehen verloren.', 'Beenden', () => ctx.quitTo('menu'), () => ctx.router.show(pauseScreen(ctx), 'back')));
    else ctx.quitTo('menu');
  };
  const box = h('div.tk-panel.box',
    h('h2', 'Pause'),
    h('div.info', info),
    button('Weiter', { cls: 'sun', icon: UI_ICONS.play, onClick: resume }),
    button('Neustart', { icon: UI_ICONS.restart, onClick: () => ctx.app.restartRace() }),
    button('Optionen', { icon: UI_ICONS.gear, onClick: () => ctx.toOptions(() => ctx.router.show(pauseScreen(ctx), 'back')) }),
    button('Beenden', { icon: UI_ICONS.exit, onClick: quit }),
  );
  const el = screenEl('tk-modal', 'dim', stagger(box), footer('Auswählen', 'Weiter'));
  (el.lastElementChild as HTMLElement).style.cssText = 'position:absolute;right:calc(var(--sar) + 2em);bottom:calc(var(--sab) + 1em)';
  return { name: 'pause', el, back: resume, escBack: false, initial: () => box.querySelector('.tk-btn') };
}

export function confirmScreen(_ctx: UiCtx, title: string, text: string, yes: string, onYes: () => void, onNo: () => void): Screen {
  const no = button('Abbrechen', { cls: 'sun center', onClick: onNo });
  const box = h('div.tk-panel.box', h('h2', title), h('div.info', { style: { margin: '0 0 .6em' } }, text), no, button(yes, { cls: 'coral center', onClick: onYes }));
  return { name: 'confirm', el: screenEl('tk-modal', 'dim', stagger(box)), back: onNo, escBack: false, initial: () => no };
}

// ---------------------------------------------------------------- results
function rankCell(r: number): HTMLElement { return h('span.rk' + (r <= 3 ? '.p' + r : ''), String(r)); }

export function resultsScreen(ctx: UiCtx, result: RaceResult, onContinue: () => void): Screen {
  const gp = ctx.state.gp;
  const sim = ctx.app.sim;
  const meta = ctx.app.tracks.find((t) => t.id === result.config.trackId);
  const rows: HTMLElement[] = [];
  const liveTimes: { id: CharacterId; time: LiveText; cell: HTMLElement; best: LiveText }[] = [];
  const headRow = h('div.tk-trow.head', h('span', ''), h('span', ''), h('span', 'Fahrer'), h('span.t', 'Zeit'), h('span.t', 'Bestrunde'), h('span.t', 'Punkte'));
  result.order.forEach((o, i) => {
    const c = character(o.char);
    const t = new LiveText(); t.set(o.time > 0 ? fmtTime(o.time) : 'unterwegs …');
    const b = new LiveText(); b.set(fmtTime(o.bestLap));
    const tc = h('span.t' + (o.time > 0 ? '' : '.dim'), t.node);
    const pts = POINTS[i] ?? 0;
    const r = h('div.tk-trow' + (o.isHuman ? '.me' : ''), rankCell(i + 1), portrait(c, true), h('span.nm', c.name, h('small', c.animal)), tc, h('span.t.dim', b.node), h('span.pt', `+${pts}`));
    r.style.setProperty('--i', String(i));
    rows.push(r);
    if (!(o.time > 0)) liveTimes.push({ id: o.char, time: t, cell: tc, best: b });
  });
  const me = result.order.findIndex((o) => o.isHuman) + 1;
  const title = me === 1 ? 'Sieg!' : me <= 3 ? `Platz ${me}! Super!` : me <= 5 ? `Platz ${me}. Gut gefahren!` : `Platz ${me}. Nicht aufgeben!`;
  const btns: HTMLElement[] = [];
  if (gp) {
    btns.push(button(gp.index + 1 < gp.tracks.length ? 'Zur Gesamtwertung' : 'Zur Siegerehrung', { cls: 'sun', icon: UI_ICONS.next, onClick: onContinue }));
  } else {
    btns.push(button('Nochmal', { cls: 'sun', icon: UI_ICONS.restart, onClick: () => ctx.app.restartRace() }));
    btns.push(button('Andere Strecke', { icon: UI_ICONS.flag, onClick: () => ctx.quitTo('tracks') }));
    btns.push(button('Menü', { icon: UI_ICONS.exit, onClick: () => ctx.quitTo('menu') }));
  }
  const el = screenEl('tk-results', 'dim',
    h('div.wrap',
      h('div.hd', h('div.tk-title-chip', title), h('div.tk-sub', `${meta?.name ?? ''} · ${result.config.speedClass.name}${gp ? ` · Rennen ${gp.index + 1}/${gp.tracks.length}` : ''}`)),
      h('div.tk-panel.tk-table', headRow, rows),
      h('div.btns', btns),
    ),
  );
  return {
    name: 'results', el, escBack: false,
    initial: () => btns[0],
    onEnter: () => audioBridge.screenMusic(me <= 3 ? 'results' : 'resultsLose'),
    update: () => {
      if (!sim || !liveTimes.length) return;
      for (let i = liveTimes.length - 1; i >= 0; i--) {
        const lt = liveTimes[i];
        const k = sim.karts.find((x) => x.char.id === lt.id);
        if (k?.race.finished) {
          lt.time.set(fmtTime(k.race.finishTime)); lt.best.set(fmtTime(k.race.bestLap));
          lt.cell.classList.remove('dim');
          liveTimes.splice(i, 1);
        }
      }
    },
  };
}

// ---------------------------------------------------------------- Grand Prix standings
export function standingsScreen(ctx: UiCtx, onContinue: () => void): Screen {
  const gp = ctx.state.gp!;
  const prevPts = (id: string) => (gp.points[id] ?? 0) - (gp.gained[id] ?? 0);
  const before = [...CHARACTERS].sort((a, b) => prevPts(b.id) - prevPts(a.id));
  const after = [...CHARACTERS].sort((a, b) => (gp.points[b.id] ?? 0) - (gp.points[a.id] ?? 0));
  const human = ctx.state.char;
  const table = h('div.tk-panel.tk-table');
  table.append(h('div.tk-trow.head', h('span', ''), h('span', ''), h('span', 'Fahrer'), h('span.t', 'Neu'), h('span.t', 'Punkte')));
  const rowMap = new Map<string, { el: HTMLElement; total: LiveText; rk: HTMLElement }>();
  before.forEach((c, i) => {
    const total = new LiveText(); total.set(String(prevPts(c.id)));
    const rk = rankCell(i + 1);
    const r = h('div.tk-trow' + (c.id === human ? '.me' : ''), rk, portrait(c, true), h('span.nm', c.name), h('span.pt', gp.gained[c.id] ? `+${gp.gained[c.id]}` : ''), h('span.t.pt.big', total.node));
    r.style.setProperty('--i', String(i));
    table.append(r);
    rowMap.set(c.id, { el: r, total, rk });
  });
  const last = gp.index + 1 >= gp.tracks.length;
  const next = button(last ? 'Zur Siegerehrung' : `Weiter: ${gp.tracks[gp.index + 1]?.name ?? ''}`, { cls: 'sun', icon: UI_ICONS.next, onClick: onContinue });
  const quit = button('Cup beenden', { icon: UI_ICONS.exit, onClick: () => ctx.router.show(confirmScreen(ctx, 'Grand Prix beenden?', 'Deine Punkte in diesem Cup gehen verloren.', 'Beenden', () => ctx.quitTo('menu'), () => ctx.router.show(standingsScreen(ctx, onContinue), 'back'))) });
  const el = screenEl('tk-results.tk-standings', 'dim',
    h('div.wrap',
      h('div.hd', h('div.tk-title-chip', 'Gesamtwertung'), h('div.tk-sub', `${CUP.name} · nach Rennen ${gp.index + 1} von ${gp.tracks.length}`)),
      table,
      h('div.btns', next, last ? null : quit),
    ),
  );
  let t = 0, phase = 0;
  return {
    name: 'standings', el, escBack: false, initial: () => next,
    update(dt) {
      t += dt;
      if (phase === 0 && t > 0.9) {
        phase = 1;
        audioBridge.ui('points');
        for (const c of CHARACTERS) {
          const r = rowMap.get(c.id)!;
          const from = prevPts(c.id), to = gp.points[c.id] ?? 0;
          const t0 = performance.now();
          const step = () => { const f = Math.min(1, (performance.now() - t0) / 700); r.total.set(String(Math.round(from + (to - from) * f))); if (f < 1) requestAnimationFrame(step); };
          step();
        }
      }
      if (phase === 1 && t > 1.8) {
        phase = 2;
        // FLIP: move rows to their new order.
        const rects = new Map(after.map((c) => [c.id, rowMap.get(c.id)!.el.getBoundingClientRect().top]));
        after.forEach((c, i) => { const r = rowMap.get(c.id)!; table.append(r.el); r.rk.textContent = String(i + 1); r.rk.className = 'rk' + (i < 3 ? ' p' + (i + 1) : ''); });
        for (const c of after) {
          const r = rowMap.get(c.id)!.el;
          const dy = rects.get(c.id)! - r.getBoundingClientRect().top;
          if (dy) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 600, easing: 'cubic-bezier(.2,1.2,.4,1)' });
        }
        const myBefore = before.findIndex((c) => c.id === human), myAfter = after.findIndex((c) => c.id === human);
        if (myAfter < myBefore) audioBridge.ui('newRecord');
      }
    },
  };
}

// ---------------------------------------------------------------- podium
export function podiumScreen(ctx: UiCtx, onDone: () => void): Screen {
  const gp = ctx.state.gp!;
  const order = [...CHARACTERS].sort((a, b) => (gp.points[b.id] ?? 0) - (gp.points[a.id] ?? 0));
  const myRank = order.findIndex((c) => c.id === ctx.state.char) + 1;
  const trophy: Trophy | null = myRank === 1 ? 'gold' : myRank === 2 ? 'silver' : myRank === 3 ? 'bronze' : null;
  const improved = trophy ? awardTrophy(CUP.id, ctx.state.cls.id, trophy) : false;
  const place = (i: number) => {
    const c = order[i];
    return h('div.place.p' + (i + 1) + (c.id === ctx.state.char ? '.me' : ''), portrait(c), h('div.nm', c.name), h('div.block', String(i + 1)));
  };
  const tname: Record<Trophy, string> = { gold: 'Goldpokal', silver: 'Silberpokal', bronze: 'Bronzepokal' };
  const award = trophy
    ? h('div.tk-panel.award', h('div.tro.' + trophy, { html: UI_ICONS.trophy }), h('div.tx', `${tname[trophy]} gewonnen!`, h('small', improved ? `${CUP.name}, Klasse ${ctx.state.cls.name}: ab in die Vitrine!` : `${CUP.name}, Klasse ${ctx.state.cls.name}`)))
    : h('div.tk-panel.award', h('div.tx', `Gesamtplatz ${myRank}`, h('small', 'Diesmal kein Pokal. Beim nächsten Mal klappt’s!')));
  const confetti = h('div.tk-confetti');
  if (trophy) {
    const cols = ['#ffd23f', '#ff7a5c', '#4fd1a5', '#6ec6f5', '#ff8fb8', '#9b7bf0'];
    for (let i = 0; i < 46; i++) {
      const p = h('i');
      p.style.left = `${Math.random() * 100}%`;
      p.style.background = cols[i % cols.length];
      p.style.animationDuration = `${3 + Math.random() * 3}s`;
      p.style.animationDelay = `${-Math.random() * 6}s`;
      p.style.setProperty('--dx', `${(Math.random() - 0.5) * 20}vw`);
      p.style.setProperty('--rot', `${(Math.random() - 0.5) * 1440}deg`);
      confetti.append(p);
    }
  }
  const done = button('Zum Menü', { cls: 'sun', icon: UI_ICONS.next, onClick: onDone });
  const el = screenEl('tk-results.tk-podium', 'dim',
    confetti,
    h('div.hd', { style: { position: 'relative' } }, h('div.tk-title-chip', 'Siegerehrung')),
    h('div.stage', place(0), place(1), place(2)),
    award,
    h('div', { style: { height: '1em' } }),
    done,
  );
  return {
    name: 'podium', el, escBack: false, initial: () => done,
    onEnter: () => { audioBridge.screenMusic(trophy ? 'podium' : 'resultsLose'); if (trophy) setTimeout(() => audioBridge.ui('trophy'), 1400); },
  };
}

// ---------------------------------------------------------------- time trial
export function timeTrialScreen(ctx: UiCtx, result: RaceResult): Screen {
  const sim = ctx.app.sim;
  const meIdx = result.order.findIndex((o) => o.isHuman);
  const me = result.order[meIdx >= 0 ? meIdx : 0];
  const laps = sim?.player.race.lapTimes ?? [];
  const best = laps.length ? Math.min(...laps) : me.bestLap;
  const { prev, improved } = submitPb(result.config.trackId, result.config.speedClass.id, { time: me.time, lap: best, char: me.char, date: Date.now() });
  const meta = ctx.app.tracks.find((t) => t.id === result.config.trackId);
  const big = h('div.tk-panel.big',
    h('div.tk-label', 'Deine Zeit'),
    h('div.time', fmtTime(me.time)),
    improved ? h('div.record', prev ? 'Neue Bestzeit!' : 'Erste Bestzeit!') : null,
    prev ? h('div.pbline', improved ? `Alte Bestzeit ${fmtTime(prev.time)} (${fmtDelta(me.time - prev.time)})` : `Bestzeit ${fmtTime(prev.time)} (${fmtDelta(me.time - prev.time)})`) : null,
    h('div.who', portrait(character(me.char), true), `${character(me.char).name} · ${result.config.speedClass.name}`),
  );
  const lapRows = laps.length ? laps.map((t, i) => h('div.lap' + (t === best ? '.best' : ''), h('span', `Runde ${i + 1}`), h('span', fmtTime(t))))
    : [h('div.lap.best', h('span', 'Beste Runde'), h('span', fmtTime(me.bestLap)))];
  const lapsPanel = h('div.tk-panel.laps', h('div.tk-label', 'Rundenzeiten'), lapRows);
  const btns = [
    button('Nochmal', { cls: 'sun', icon: UI_ICONS.restart, onClick: () => ctx.app.restartRace() }),
    button('Andere Strecke', { icon: UI_ICONS.flag, onClick: () => ctx.quitTo('tracks') }),
    button('Menü', { icon: UI_ICONS.exit, onClick: () => ctx.quitTo('menu') }),
  ];
  const el = screenEl('tk-results', 'dim',
    h('div.wrap',
      h('div.hd', h('div.tk-title-chip', 'Zeitfahren'), h('div.tk-sub', `${meta?.name ?? ''} · ${result.config.speedClass.name}`)),
      stagger(h('div.tk-tt', big, lapsPanel)),
      h('div.btns', btns),
    ),
  );
  return {
    name: 'ttresults', el, escBack: false, initial: () => btns[0],
    onEnter: () => { audioBridge.screenMusic('results'); if (improved) setTimeout(() => audioBridge.ui('newRecord'), 500); },
  };
}

export { header, footer };
