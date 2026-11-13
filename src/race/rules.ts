// Race rules: intro, countdown, cheat-proof lap counting, ranking, finish, time trial.
// Owner: gameplay. Headless and deterministic.
import { POINTS } from '../core/data';
import type { Kart, RaceSim, SimSystem, TrackFrame } from '../core/types';
import { newFrame, wrapDelta } from '../items/mover';

export interface RaceRulesOptions {
  /** Seconds of intro before the countdown starts (camera fly-by). */
  intro?: number;
  /** Countdown length; 3 gives 3-2-1-GO. */
  countdown?: number;
  /** Seconds the race keeps running after the human finished. */
  grace?: number;
  /** Hard limit on race time (s). Default: generous per-lap budget. */
  timeLimit?: number;
  /** Rank swaps need this lead (m) to happen at once... */
  rankHysteresis?: number;
  /** ...or a smaller lead held for this long (s). */
  rankHold?: number;
}

export interface RaceRules extends SimSystem {
  /** Current order, index 0 = first. */
  readonly order: readonly Kart[];
  readonly over: boolean;
  /** Number of checkpoints the track was divided into. */
  readonly checkpoints: number;
}

interface KartRaceState {
  /** Current checkpoint segment. */
  cp: number;
  /** Highest lap reached (events fire only for new maxima). */
  maxLap: number;
  lapStart: number;
  /** Time the kart has been ahead of the kart directly in front in the published order. */
  passT: number;
  wrongT: number;
  startDist: number;
}

const frame: TrackFrame = newFrame();

export function pointsFor(rank: number): number {
  return POINTS[rank - 1] ?? 0;
}

export function createRaceRules(opts: RaceRulesOptions = {}): RaceRules {
  const INTRO = opts.intro ?? 2;
  const COUNT = opts.countdown ?? 3;
  const GRACE = opts.grace ?? 5;
  const HYST = opts.rankHysteresis ?? 1.0;
  const HOLD = opts.rankHold ?? 0.5;

  let sim: RaceSim;
  let L = 1, K = 8, seg = 1, maxSkip = 2;
  let introLeft = INTRO;
  let lastCount = 99;
  let started = false;
  let over = false;
  let leaderLap = 0;
  let finishedCount = 0;
  let graceLeft = -1;
  let timeLimit = Infinity;
  const states: KartRaceState[] = [];
  const order: Kart[] = [];

  const setPhase = (p: RaceSim['phase']) => {
    sim.phase = p;
    sim.events.emit('race:phase', { phase: p });
  };

  const segOf = (p: number) => Math.min(K - 1, Math.max(0, Math.floor(p / seg)));

  function distanceOf(k: Kart, st: KartRaceState): number {
    const base = st.cp * seg;
    const into = Math.min(seg, Math.max(0, wrapDelta(base, k.loc.progress, L)));
    return (k.race.lap - 1) * L + base + into;
  }

  /** How many checkpoint segments a kart may skip forward in one step right now. */
  function allowedSkip(k: Kart): number {
    if (k.carried) return Math.floor(K / 2) - 1;
    let allowed = maxSkip;
    if (k.loc.path > 0) {
      for (const b of sim.track.branches) {
        if (b.path === k.loc.path) allowed = Math.max(allowed, Math.ceil((b.to - b.from) / seg) + 1);
      }
    }
    return Math.min(allowed, Math.floor(K / 2) - 1);
  }

  function newLap(k: Kart, st: KartRaceState): void {
    const r = k.race;
    if (r.lap <= st.maxLap) return; // re-crossing after reversing: no new event
    st.maxLap = r.lap;
    if (r.lap > sim.laps) return finish(k, st);
    let lapTime = 0;
    if (r.lap > 1) {
      lapTime = sim.raceTime - st.lapStart;
      st.lapStart = sim.raceTime;
      r.lapTimes.push(lapTime);
      r.bestLap = Math.min(r.bestLap, lapTime);
    }
    sim.events.emit('race:lap', { kart: k, lap: r.lap, lapTime, final: r.lap === sim.laps });
    if (r.lap > leaderLap) {
      leaderLap = r.lap;
      sim.track.setLap(r.lap, sim);
    }
  }

  function finish(k: Kart, st: KartRaceState): void {
    const r = k.race;
    const lapTime = sim.raceTime - st.lapStart;
    r.lapTimes.push(lapTime);
    r.bestLap = Math.min(r.bestLap, lapTime);
    r.lap = sim.laps;
    r.finished = true;
    r.finishTime = sim.raceTime;
    finishedCount++;
    // Finished karts sit at the top of the order in finishing order.
    const i = order.indexOf(k);
    order.splice(i, 1);
    order.splice(finishedCount - 1, 0, k);
    publishRanks();
    sim.events.emit('race:finish', { kart: k, rank: r.rank, time: r.finishTime });
    if (k.isHuman && graceLeft < 0) graceLeft = GRACE;
  }

  function trackLaps(k: Kart, st: KartRaceState): void {
    const r = k.race;
    const c = segOf(k.loc.progress);
    const diff = (c - st.cp + K) % K;
    if (diff === 0) return;
    if (diff <= K / 2) {
      if (diff > allowedSkip(k)) return; // skipped too much of the track: not counted
      const crossed = st.cp + diff >= K;
      st.cp = c;
      if (crossed) { r.lap++; newLap(k, st); }
    } else {
      const back = K - diff;
      const crossed = st.cp - back < 0;
      st.cp = c;
      if (crossed) r.lap--; // reversed over the line: the lap is taken back
    }
  }

  function wrongWay(k: Kart, st: KartRaceState, dt: number): void {
    sim.track.sample(k.loc.progress, 0, k.loc.path, frame);
    const along = k.vel.x * frame.forward.x + k.vel.z * frame.forward.z;
    if (along < -3 && !k.carried) st.wrongT += dt;
    else st.wrongT = Math.max(0, st.wrongT - 2 * dt);
    k.race.wrongWay = st.wrongT > 0.8;
  }

  function publishRanks(): void {
    for (let i = 0; i < order.length; i++) {
      const k = order[i];
      const to = i + 1;
      if (k.race.rank !== to) {
        const from = k.race.rank;
        k.race.rank = to;
        if (sim.phase === 'racing') sim.events.emit('race:rank', { kart: k, from, to });
      }
    }
  }

  /** Adjacent swaps with hysteresis so ranks do not flicker in side-by-side duels. */
  function updateOrder(dt: number): void {
    for (let pass = 0; pass < order.length; pass++) {
      let swapped = false;
      for (let i = finishedCount; i < order.length - 1; i++) {
        const a = order[i], b = order[i + 1];
        if (b.race.finished) continue;
        const gap = b.race.distance - a.race.distance;
        const sb = states[b.id];
        if (gap > HYST || (gap > 0 && sb.passT > HOLD)) {
          order[i] = b; order[i + 1] = a;
          sb.passT = 0;
          states[a.id].passT = 0;
          swapped = true;
        }
      }
      if (!swapped) break;
    }
    // Pressure timers: time spent ahead of the kart directly in front (in published order).
    for (let i = finishedCount + 1; i < order.length; i++) {
      const a = order[i - 1], b = order[i];
      const sb = states[b.id];
      sb.passT = b.race.distance > a.race.distance ? sb.passT + dt : 0;
    }
    publishRanks();
  }

  function endRace(): void {
    if (over) return;
    over = true;
    const total = sim.laps * L;
    let prev = -Infinity;
    for (const k of order) {
      const r = k.race;
      if (r.finished) { prev = r.finishTime; continue; }
      const st = states[k.id];
      const avg = Math.max(5, (r.distance - st.startDist) / Math.max(1, sim.raceTime));
      const est = sim.raceTime + Math.max(0, total - r.distance) / avg;
      r.finishTime = Math.max(est, prev + 0.1);
      prev = r.finishTime;
    }
    publishRanks();
    setPhase('finished');
    sim.events.emit('race:over', { order: [...order] });
  }

  return {
    get order() { return order; },
    get over() { return over; },
    get checkpoints() { return K; },

    init(s) {
      sim = s;
      L = sim.track.length;
      K = Math.max(8, Math.round(L / 40));
      seg = L / K;
      maxSkip = Math.max(2, Math.round(K * 0.12));
      timeLimit = opts.timeLimit ?? Math.max(240, sim.laps * (L / 7) + 60);
      sim.raceTime = -COUNT;
      for (const k of sim.karts) {
        const p = k.loc.progress;
        const r = k.race;
        r.lap = p < L / 2 ? 1 : 0;
        states[k.id] = { cp: segOf(p), maxLap: 0, lapStart: 0, passT: 0, wrongT: 0, startDist: 0 };
        r.distance = distanceOf(k, states[k.id]);
        states[k.id].startDist = r.distance;
        order.push(k);
      }
      order.sort((a, b) => b.race.distance - a.race.distance);
      publishRanks();
    },

    step(s, dt) {
      if (!started) {
        // Locations are fresh only after the first physics step; re-seed the checkpoints once.
        for (const k of s.karts) {
          const st = states[k.id];
          st.cp = segOf(k.loc.progress);
          k.race.lap = k.loc.progress < L / 2 ? 1 : 0;
          k.race.distance = distanceOf(k, st);
          st.startDist = k.race.distance;
        }
        order.sort((a, b) => b.race.distance - a.race.distance);
        started = true;
        publishRanks();
        setPhase('intro');
      }
      if (s.phase === 'intro') {
        introLeft -= dt;
        if (introLeft <= 0) { setPhase('countdown'); }
        return;
      }
      if (s.phase === 'countdown') {
        s.raceTime += dt;
        const n = Math.ceil(-s.raceTime - 1e-9);
        if (n !== lastCount && n > 0 && n <= COUNT) { lastCount = n; s.events.emit('race:countdown', { n }); }
        if (s.raceTime >= 0) {
          s.events.emit('race:countdown', { n: 0 });
          setPhase('racing');
          // Karts that start past the line are on lap 1 from the green light.
          for (const k of s.karts) if (k.race.lap === 1) newLap(k, states[k.id]);
        }
        return;
      }
      s.raceTime += dt;
      if (over) return;

      for (const k of s.karts) {
        const st = states[k.id];
        if (k.race.finished) continue;
        trackLaps(k, st);
        if (k.race.finished) continue;
        k.race.distance = distanceOf(k, st);
        wrongWay(k, st, dt);
      }
      updateOrder(dt);

      let graceOver = false;
      if (graceLeft >= 0) { graceLeft -= dt; graceOver = graceLeft <= 0; }
      if (finishedCount >= s.karts.length || graceOver || s.raceTime > timeLimit) endRace();
    },
  };
}
