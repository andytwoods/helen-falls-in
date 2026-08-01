import { audio } from './audio';
import { attachButton } from './input';
import { formatTime, journeyBest, PUBS, recordJourney, unlockedPub, unlockPub } from './journey';
import { createPath, type PathCurve } from './path';
import { DEFAULT_PARAMS } from './params';
import { createRenderer } from './render';
import { createState, press, release, step, DT, type SimState } from './sim';
import { gaussianFrom, mulberry32 } from './rng';
import { Telemetry } from './telemetry';
import { attachSoundToggle } from './ui';

const params = { ...DEFAULT_PARAMS };
const telemetry = new Telemetry();

const TAP_LOCKOUT_S = 0.5; // cards ignore taps briefly so panic taps don't skip them

let seed = (Date.now() ^ 0x5f3759df) >>> 0;
let gaussian = gaussianFrom(mulberry32(seed));
let path: PathCurve = createPath(seed, params.meanderAmount, params.narrowAmount, params.downhillBoost);
let state: SimState = createState();
let prevState: SimState = { ...state };

type Phase = 'intro' | 'riding' | 'dead' | 'pub' | 'done';
let phase: Phase = 'intro';
let cardAt = 0; // when the current card/cutscene began (perf.now ms)
let falls = 0;
let startPub = 0;
let nextPub = 1;

// After a fall Helen carries the evidence for a while: mud, drips, or leaves.
const AFTERMATH_S = 30;
let aftermath: { cause: 'canal' | 'ditch' | 'tree' | 'bush' | 'hedge'; end: number } | null = null;

const hudTime = document.getElementById('hud-time')!;
const hudFalls = document.getElementById('hud-best')!;
const overlay = document.getElementById('overlay')!;
const overlayText = document.getElementById('overlay-text')!;
const intro = document.getElementById('intro')!;
const introBest = document.getElementById('intro-best')!;
const pubButtons = document.getElementById('pub-buttons')!;

function fallsText(): string {
  return falls === 0 ? 'dry so far' : falls === 1 ? '1 dunking' : `${falls} dunkings`;
}

function showIntro(): void {
  phase = 'intro';
  overlay.classList.remove('show');
  const best = journeyBest();
  introBest.textContent = best
    ? `Best full journey: ${formatTime(best.timeS)} with ${best.falls} fall${best.falls === 1 ? '' : 's'}`
    : '';
  pubButtons.innerHTML = '';
  const maxPub = unlockedPub();
  PUBS.forEach((pub, i) => {
    if (i === PUBS.length - 1) return; // you can't start at the destination
    const btn = document.createElement('button');
    const reached = i <= maxPub;
    btn.textContent = reached ? `Set off from ${pub.name}` : `🔒 ${pub.name}`;
    btn.disabled = !reached;
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('pointerup', (e) => e.stopPropagation());
    btn.addEventListener('click', () => {
      audio.ensureStarted(); // a click is a gesture — wake audio here too
      startJourney(i);
    });
    pubButtons.appendChild(btn);
  });
  intro.classList.remove('hidden');
}

function startJourney(pubIdx: number): void {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  gaussian = gaussianFrom(mulberry32(seed));
  path = createPath(seed, params.meanderAmount, params.narrowAmount, params.downhillBoost);
  state = createState();
  state.d = PUBS[pubIdx]!.d;
  prevState = { ...state };
  falls = 0;
  startPub = pubIdx;
  nextPub = pubIdx + 1;
  aftermath = null;
  telemetry.startRun();
  hudFalls.textContent = fallsText();
  intro.classList.add('hidden');
  overlay.classList.remove('show');
  phase = 'riding';
}

function showCard(html: string, delayMs: number): void {
  const stamp = cardAt;
  overlayText.innerHTML = html;
  setTimeout(() => {
    if (phase !== 'riding' && cardAt === stamp) overlay.classList.add('show');
  }, delayMs);
}

function die(): void {
  phase = 'dead';
  cardAt = performance.now();
  falls++;
  hudFalls.textContent = fallsText();
  const cause = state.cause ?? 'canal';
  telemetry.endRun(seed, state.t, cause, params);
  if (cause === 'canal') audio.splash();
  else if (cause === 'ditch') audio.squelch();
  else audio.crunch();
  const fell = {
    canal: '<b>SPLOOSH!</b> 🐸<br>Helen fell into the canal.',
    ditch: '<b>SQUELCH!</b> 🥾<br>Helen rode into the ditch.',
    tree: '<b>THUNK!</b> 🌳<br>Helen rode straight into a tree.',
    bush: '<b>CRASH!</b> 🌿<br>Helen tangled into a bush.',
    hedge: '<b>CRUNCH!</b> 🌿<br>Helen ploughed into the hedge.',
  }[cause];
  showCard(`${fell}<br><br>${fallsText()} &nbsp;·&nbsp; ${formatTime(state.t)}<br><br>tap to climb back on`, 900);
}

// Falling in is not the end: back on the bike, soggy, same spot on the towpath.
function climbBackOn(): void {
  aftermath = { cause: state.cause ?? 'canal', end: state.t + AFTERMATH_S };
  state.alive = true;
  state.cause = null;
  state.fellSide = 0;
  state.x = 0;
  state.vx = 0;
  state.steer = 0;
  state.noise = 0;
  state.drift = 0;
  state.held = false;
  state.hold = 0;
  prevState = { ...state };
  overlay.classList.remove('show');
  phase = 'riding';
}

function arriveAtPub(): void {
  cardAt = performance.now();
  unlockPub(nextPub);
  audio.bell();
  const pub = PUBS[nextPub]!;
  if (nextPub === PUBS.length - 1) {
    phase = 'done';
    if (startPub === 0) recordJourney(state.t, falls);
    showCard(
      `<b>🍺 ${pub.name}</b><br>Journey's end.<br><br>` +
        `${formatTime(state.t)} &nbsp;·&nbsp; ${fallsText()}<br><br>tap for a well-earned sit down`,
      400,
    );
  } else {
    phase = 'pub';
    showCard(
      `<b>🍺 ${pub.name}</b><br>A swift lemonade for Helen.<br><br>` +
        `${formatTime(state.t)} &nbsp;·&nbsp; ${fallsText()}<br><br>tap to ride on`,
      400,
    );
    nextPub++;
  }
}

async function boot(): Promise<void> {
  const mount = document.getElementById('game')!;
  const renderer = await createRenderer(mount);

  attachButton(mount, {
    onDown: () => {
      audio.ensureStarted(); // WebAudio must wake inside a user gesture (iOS)
      if (phase === 'riding') {
        press(state, params);
        telemetry.logInput(state.t, 'down');
        return;
      }
      if (performance.now() - cardAt < TAP_LOCKOUT_S * 1000) return;
      if (phase === 'dead') climbBackOn();
      else if (phase === 'pub') {
        overlay.classList.remove('show');
        phase = 'riding';
      } else if (phase === 'done') showIntro();
    },
    onUp: () => {
      if (phase !== 'riding') return;
      release(state);
      telemetry.logInput(state.t, 'up');
    },
  });

  attachSoundToggle(audio);
  showIntro();

  let last = performance.now();
  let acc = 0;

  renderer.app.ticker.add(() => {
    const now = performance.now();
    acc += Math.min(0.25, (now - last) / 1000); // clamp huge tab-switch gaps
    last = now;

    while (acc >= DT) {
      if (phase === 'riding') {
        prevState = { ...state };
        step(state, params, gaussian, path);
        if (state.alive && path.bumpsBetween(prevState.d, state.d).length > 0) audio.thud();
        if (!state.alive) die();
        else if (state.d >= PUBS[nextPub]!.d) arriveAtPub();
      }
      acc -= DT;
    }

    if (phase === 'riding') {
      hudTime.textContent = formatTime(state.t);
    }
    renderer.draw(
      // interpolate only while the sim advances — blending two stale states
      // with a moving alpha makes the frozen world (pub stops) shiver
      phase === 'riding' ? prevState : state,
      state,
      acc / DT,
      params,
      path,
      phase === 'dead' ? (now - cardAt) / 1000 : 0,
      aftermath && state.t < aftermath.end
        ? { cause: aftermath.cause, strength: (aftermath.end - state.t) / AFTERMATH_S }
        : undefined,
    );
  });
}

void boot();
