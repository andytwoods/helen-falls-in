# Steering model spec (v1, for the greybox prototype)

Synthesised 2026-08-01 from two independent external reviews (GPT and Gemini — raw
replies in `docs/llm-reviews/`). Where they disagreed, the choice made here is noted.

## Where both reviewers agreed

- The concept works, and Pixi + a bespoke fixed-timestep loop is the right stack.
- **Velocity damping is mandatory.** Pure acceleration control with a ramp diverges;
  without a `-drag·v` term the game is unplayably unstable rather than hard.
- **Rapid tapping is the #1 degenerate-strategy risk** — high-frequency tapping could
  act as a free low-pass filter and trivialise the game.
- **Near-centre presses will feel unfair** if direction is literally `-sign(x)` at
  pixel precision.
- **Tune on a phone browser during the greybox phase, not after.** Touch adds
  50–100 ms latency vs a desktop spacebar; a model tuned on keyboard will feel broken
  on mobile. (This re-orders our original plan.)
- Physics must simulate at a fixed rate decoupled from `requestAnimationFrame`
  (120 Hz phones would otherwise run the game 2× fast), with render interpolation.
- The sprite must telegraph state: displacement, lateral velocity, and lean are three
  different things and the player must be able to read them apart.

## Where they disagreed — and what we adopt

**Anti-tapping fix.** Gemini: add a minimum-release cooldown (50–100 ms) before
direction re-sampling. GPT: no arbitrary cooldowns — instead make the steering/lean
state *persistent*: a new press changes the target but never resets the lean, so
reversing an established lean physically takes time and tapping can't produce free
instant damping. **We adopt GPT's persistent-steer model** (more elegant, feels like
a bike). Fallback: if playtest telemetry shows winners tapping >8–10 Hz, add
Gemini's release-hysteresis on top.

## State variables

Lateral position normalised to the current path half-width: `x = 0` centre,
`x = ±1` the failure edges, grass fringe from `|x| ≈ 0.82`. Path narrowing changes
the world-space scale of `x`, not the maths.

```ts
x       // lateral position, -1..1
vx      // lateral velocity
steer   // persistent steering/lean state, -1..1  (NOT reset on press/release)
dir     // correction direction sampled on press, -1 | +1
hold    // duration of current hold (s)
noise   // fast filtered wobble (Ornstein–Uhlenbeck)
drift   // slow filtered drift  (Ornstein–Uhlenbeck)
speed   // forward speed
```

Fixed timestep `dt = 1/120`; render interpolates between the last two states.

## Update equations

**On press** — sample the bike's **visible orientation** (design change 2026-08-01:
originally side-of-centre; now the drawn tilt itself, so the correction direction is
always readable from the sprite). `visualLean` blends persistent lean with actual
sideways slide and is shared verbatim by the renderer — what you see is what a press
counters. Fallbacks handle a near-vertical bike:

```ts
const lean = visualLean(state, p);          // 0.55*steer + 0.45*atan2(vx_px, forwardSpeed)
if (Math.abs(lean) > leanDeadzone)          dir = -Math.sign(lean);   // counter the tilt
else if (Math.abs(vx) > velocityDeadzone)   dir = -Math.sign(vx);     // counter the slide
else {
  const sample = x + predictionTime * vx;   // upright & steady: nudge to centre —
  if (Math.abs(sample) > centreDeadzone)    dir = -Math.sign(sample); // the only deliberate
  else                                      dir = previousDir;        // way to re-centre
}
hold = 0;
```

**While held** — target lean ramps with hold time; actual lean chases it with a lag
(this lag is what defeats tap-spam):

```ts
hold += dt;
const magnitude = Math.min(maxCorrection, initialCorrection + correctionRamp * hold);
const targetSteer = dir * magnitude;
steer += (targetSteer - steer) * (1 - Math.exp(-dt / steerResponse));
```

**While released** — lean relaxes toward zero, slower than a typical tap interval:

```ts
steer += (0 - steer) * (1 - Math.exp(-dt / steerReturn));
```

**Wobble** — two OU noise processes (slow drift is readable and eventually kills an
idle player; avoid strong fast noise, which reads as arbitrary):

```ts
noise += (-noise / noiseTau) * dt + noiseSigma * Math.sqrt(dt) * gaussian();
drift += (-drift / driftTau) * dt + driftSigma * Math.sqrt(dt) * gaussian();
```

**Lateral physics** (grass scales control down and wobble up; hazards inject
`hazardForce`):

```ts
const onGrass = Math.abs(x) > grassStart;
const a = steeringAcceleration * steer * (onGrass ? grassControlScale : 1)
        + wobbleStrength * noise * (onGrass ? grassWobbleScale : 1)
        + driftStrength * drift
        + hazardForce;
vx += a * dt;
vx *= Math.exp(-lateralDrag * dt);
x  += vx * dt;
```

**Visual lean** for the sprite: `theta = atan(vxWorld / forwardSpeed)` blended with
`steer` — show sliding and leaning as distinct cues.

## Starting constants (slider ranges for the greybox)

```ts
initialCorrection = 0.10      correctionRamp = 2.2 /s     maxCorrection = 1.0
steerResponse     = 0.09 s    steerReturn    = 0.18 s
steeringAcceleration = 3.0 units/s²        lateralDrag = 0.75 /s
predictionTime = 0.06 s       centreDeadzone = 0.025      velocityDeadzone = 0.03
noiseTau = 0.30 s   noiseSigma = 1.3   wobbleStrength = 0.30
driftTau = 2.5 s    driftSigma = 0.22  driftStrength  = 0.30
grassStart = 0.82   grassControlScale = 0.55   grassWobbleScale = 1.5
```

Dimensional starting points only — the sliders exist to find the real values.

## Tuning knobs, in order of impact

1. Time-to-edge from a normal error (reaction allowance).
2. Lean reversal time (`steerResponse`/`steerReturn`) — sets the skill ceiling and
   whether tapping works.
3. `correctionRamp` — how punitive a slightly-long hold is.
4. Noise **correlation time**, not just amplitude — slow noise is readable.
5. Path width (small changes have outsized effect).
6. Forward speed's effect on steering and hazard warning time.
7. Recovery window between forced disturbances.

## Difficulty curve

Both reviewers: 5 s newbie / 1–2 min pro is reachable, but not from static steering
constants alone — phase in path features so the player can tell *what* changed:

- 0–10 s: broad path, wobble only
- 10–25 s: mild grooves, occasional grass recovery
- 25–45 s: modest narrowing and bumps
- 45 s+: faster combinations, always with enforced recovery gaps

Never ramp wobble, sensitivity, speed and narrowing simultaneously. Hazards must be
visible in time to react; procedural generation is an authored grammar
(approach → challenge → recovery patterns), never independent random forces.
Validate difficulty targets against the **median** first-run survival, not the mean.
Long holds must sometimes be *correct* (recovering from grass / large displacement)
so the mechanic has contextual depth. (Gemini caveat: pro runs in comparable reflex
games plateau nearer 30–45 s; accept that 1–2 min may be aspirational.)

## Greybox prototype requirements (beyond rectangles + sliders)

- Deterministic seeded RNG; log inputs + seed per run → instant replay of any death.
- Telemetry per run: `x`, `vx`, `steer`, hold durations, press positions, cause of
  death; named parameter presets exported alongside telemetry.
- Headless simulations: idle, constant tapping, periodic tapping, simple feedback
  controller — verify idle dies, tap-spam dies, skilled control survives.
- Frame-rate tests at 30/60/90/120 Hz (fixed accumulator, interpolated render).
- Test on a real phone browser (portrait) before locking constants.
- Minimal fail/restart loop so restart friction is evaluated with the mechanic.

## Input & platform hardening (from both reviews)

- `pointerdown`/`pointerup` (never `click`); pointer capture; handle
  `pointercancel`, `blur`, `visibilitychange` — a missed release is a fatal stuck
  hold. No duplicate touch+mouse handlers.
- `touch-action: none; user-select: none;` on the canvas; `preventDefault()` on
  touch events (kills double-tap zoom / swipe-nav delay).
- Audio: create/resume the WebAudio context inside the first user gesture (iOS
  starts suspended); expect re-suspension after backgrounding.
- Safe-area insets and mobile viewport height changes.
- Timestamp inputs and apply at the correct simulation step; a 120 Hz phone must not
  make the game easier.

## Harness findings (2026-08-01, default constants, 200 seeds)

The headless harness (`npm run harness`) validated and changed the model:

- **GPT's persistent-steer alone did NOT stop tap-spam** — 8–12 Hz blind spam was
  the best strategy (median ~150s). The agreed fallback was triggered: **Gemini's
  release-hysteresis is now in the model** (`resampleCooldown = 0.15 s`: a press
  only re-samples direction if the button was released at least that long;
  otherwise it steers on the stale direction). With it, spam dies in ~4 s.
- Results after the fix: idle ~20s · spam ~4s · panic-newbie bot (250 ms reaction,
  panic holds) ~7.5s · decent controller (180 ms delay) ~65s · sharp controller
  (100 ms delay) ~117s. That matches the intended curve (newbie ~5s, pro 1–2 min).
- **Open issue: blind cadence** *(resolved by the meandering path — see below)*. A metronome — tap 2 Hz with 150 ms holds, no
  perception at all — survives ~135s, beating the perceptive bots, because
  press-time direction sampling makes any steady rhythm self-stabilising on a
  wobble-only path. The designed counter is phase-2 path features: grooves that
  need deliberate long holds, rocks, narrowing, and the difficulty ramp — no fixed
  rhythm handles those. Re-run the harness after hazards land; blind cadence must
  end up well below the perceptive controllers.

### Lean-based sampling (2026-08-01, same day, by request)

Direction sampling switched from side-of-centre to the bike's **visible tilt**
(`leanDeadzone = 0.02 rad`), with slide → position fallbacks when near-vertical.
Consequences measured by the harness:

- Blind cadence weakened (135s → ~93s): a metronome now keeps the bike upright but
  no longer gets free re-centring, so drift claims it sooner. Still the strongest
  bot, pending phase-2 hazards.
- Position-reading bots collapsed to ~20s — the old mental model is now wrong,
  which is the point: the player must read the sprite's tilt, not the centre line.
- Lean-reading bots: ~37s at 100 ms reaction, ~58s at 180 ms, ~42s at 300 ms.
  The non-monotonic peak means *timing quality beats raw reaction speed* — calm,
  well-timed damping wins, twitchy fast reactions inject energy. That matches the
  intended core skill.
- Spam (~4s), idle (~20s) and panic-newbie (~7.5s) are unchanged.

### Meandering path (2026-08-01, first phase-2 feature)

`src/path.ts` adds a seeded meander (sum of three drifting sine waves, 900 px
straight-ish ramp-in ≈ 10 s); its slope enters the sim as a deterministic lateral
disturbance Helen must steer to follow. Harness additions: two `preview*` bots
that read the road ahead (predict the offset `lookahead` seconds out, press only
when the sampled direction helps) — these model real human play, since players
see the upcoming curve. Sweep results (200 seeds, medians):

| meander | newbie | idle | cadence 3 Hz | lean-ctrl 180ms | preview-pro | preview-avg |
|---------|--------|------|--------------|-----------------|-------------|-------------|
| 0 (off) | 7.5s | 20.4s | 93.2s | 58.0s | 191.6s | 249.7s |
| 0.2 | 7.0s | 16.6s | 86.0s | 37.3s | 160.1s | 207.3s |
| **0.35**| 6.5s | 13.7s | 60.0s | 21.0s | 97.3s | 130.0s |
| 0.5 | 5.8s | 11.4s | 28.4s | 13.8s | 32.4s | 52.1s |
| 1.0 | ~5s | 7.9s | 8.7s | 8.8s | 8.5s | 8.9s |

- **`meanderAmount = 0.35` adopted as the default.** At 1.0 the curves kill every
  bot (~9 s median regardless of skill — no skill separation); at 0.5 the pro
  ceiling collapses to ~50 s; at 0.35 the targets line up: newbie ~6.5 s, pro
  1.5–2 min, and spam (~3.5 s) / idle (~14 s) unchanged.
- **The blind-cadence open issue is resolved as designed**: a metronome cannot
  follow curves, so cadence (60 s) now sits well below the road-reading bots
  (97–130 s). It still beats the non-preview lean controllers, but those are
  blindfolded relative to a human — the preview bots are the fair comparison.
- The preview bots repeat the earlier non-monotonicity: the *calmer* 250 ms bot
  with a wider press threshold outlives the twitchier 120 ms one — timing quality
  beats reaction speed, as intended.

### Narrowing pinch-points (2026-08-01, second phase-2 feature)

`halfWidthAt(d)` on the path: seeded pinches on an authored grammar — recovery gap
(600–1100 px, always full width) → 250 px approach taper (≈2.8 s visible warning) →
throat (150–350 px) → 250 px release taper. Phased in from 2000 px; depth ramps to
full over the next 4000 px; throat width floors at 0.5× (24 px vs the 10 px bike).
Physics: the sim preserves Helen's **world-space** position/velocity as the walls
move (normalised `x`,`vx` rescale by the width ratio — a pinch squeezes an off-line
rider) and scales all forces by `fullWidth/currentWidth` so wobble stays constant
in px while the corridor shrinks. Sweep at meander 0.35 (200 seeds, medians):

| narrow | cadence 3 Hz | cadence 2 Hz | preview-pro | preview-avg |
|--------|--------------|--------------|-------------|-------------|
| 0 (off)| 60.0s | 47.7s | 93.0s | 133.8s |
| **0.7**| 51.5s | 38.0s | 71.6s | 99.5s |
| 1.0 | 48.4s | 35.9s | 67.2s | 75.6s |

- **`narrowAmount = 0.7` adopted.** It keeps the pro band at 1–1.5 min with ~2×
  separation over blind cadence; 1.0 compressed everything toward ~70 s and halved
  the skill margin. At 0.7 the narrowest throats are ~0.63× (first pinch ~32 s in,
  inside the design's 25–45 s "modest narrowing" band; ~11 pinches per 3.7 min).
- Newbie (6.4 s), idle (13.7 s), spam (3.5 s) and the non-preview controllers are
  untouched — they die before or near the first pinch, so the opening-phase feel
  and difficulty targets are preserved.
- Caveat: the preview bots are width-blind (fixed normalised thresholds), so these
  numbers understate a skilled human who sets up for a visible pinch. Real skilled
  survival should sit somewhat above the preview medians.

### Ridable verge (2026-08-01, third phase-2 feature)

Layout is now canal-right / verge-left, and the verge is **ridable**: crossing the
left edge no longer kills, but control drops to `vergeControlScale = 0.35` and
wobble jumps to `vergeWobbleScale = 2.8` (far worse than fringe grass), and any
contact kills — the ditch stretches guarding the verge entrance (~55% of
distance), tree/bush blobs (hitboxes 2 px smaller than drawn), or the solid
hedgerow at the far screen edge. Scenery moved from the renderer into the seeded
path model (`vergeObjects`/`ditchWidthAt`) so sim, renderer and harness share one
collidable world and replays stay exact.

Harness effect (200 seeds, medians, vs the narrowing round): every bot gains a
little because the left side now offers a chance to recover — idle 13.7→15.3 s,
cadence 3 Hz 51.5→54.6 s, lean-ctrl 180 ms 21.2→25.7 s, preview-pro 71.6→83.0 s,
preview-avg 99.5→105.9 s; spam (~3.5 s) and panic-newbie (6.8 s) unchanged. Curve
shape and all difficulty targets hold. None of the bots deliberately *uses* the
verge (they treat off-path as failure drift); a human bailing out on purpose in a
ditch gap is an intended skill play the harness doesn't yet model.

### Global tighten (2026-08-01, "still too easy" playtest feedback)

First human playtest verdict: too easy — specifically the opening, where most runs
live, was the easiest stretch of the game (long straight ramp-in, late pinches,
gentle ramp). Changes: meander ramp-in 900→450 px (~5 s), pinches start
2000→1200 px with ramp 4000→3000 px, `wobbleStrength` 0.30→0.34, `driftStrength`
0.30→0.34, `difficultyRamp` 0.012→0.018. Params storage key bumped to
`hfi-params-v2` so stale saved sliders don't mask retuned defaults.

Result (200 seeds, medians): panic-newbie 6.8→**5.4 s** (design target ~5 s hit),
idle 15.3→13.4 s, cadence 3 Hz 54.6→37.3 s, lean-ctrl 180 ms 25.7→20.4 s,
preview-pro 83.0→58.1 s, preview-avg 105.9→74.6 s. Whole curve tightened ~20–30%
with shape preserved; pro band sits at the low end of 1–2 min for width-blind
bots, so verge-using humans should still reach it.

### On-path hazards: grooves, bumps, rocks (2026-08-01, fourth phase-2 feature)

All seeded per run, generated on sequential cursors with enforced gaps, queried
from the shared path model, and **never placed where the path is pinched**
(widthFactor must be >0.95) — the first harness run had bumps landing in throats
and every skilled bot died in a tight 24–27 s wall; de-stacking dissolved it.

- **Grooves** (from ~10 s; every ~6–9 s; 200–450 px long): a rut line at up to
  ±8 px from centre, slanting 5–14 px towards an edge over its length. Inside a
  ±(4+2) px capture zone a spring (`grooveGrip = 8 /s²/px`) drags the wheel to
  the line; max spring force ≈ 48 px/s² vs 72 px/s² for a full held correction —
  **escapable only by a sustained hold**, which gives the game its long-hold-is-
  correct situation. Taps lose to it; the rut walks you towards the edge.
- **Bumps** (from ~20 s; every ~3.5–8 s): rumble strips; a bump stores a relative
  kick (±0.75–1.25) scaled by `bumpKick` (default 0.6 units/s, slider) plus a
  lean knock. Two corrections got here: the first cut (±2.0–3.2) out-ran the
  drag and was effectively fatal (bot death-wall at bump onset); the second
  (±0.8–1.3 fixed) passed the bots but the human playtest called it too extreme
  — halved to 0.6 mean and put on a slider, keeping the lean-knock (the visible
  rattle) at the old strength so bumps stay readable while throwing half as far.
- **Rocks** (from ~30 s; every ~5–11 s): r=2.5 px blobs at up to ±0.7 of
  half-width; contact sets `vx` away from the rock at `rockKick = 2.0` units/s
  (not additive, so lingering contact can't compound).

Harness (200 seeds, medians, vs the global-tighten round; after the bump-soften):
newbie 5.4 s, idle 13.4 s, spam 3.4–3.7 s all unchanged; cadence 3 Hz
37.3→**27.5 s** (grooves break rhythm play, as designed); lean-ctrl ≈18–20 s;
preview-pro 58.1→41.6 s, preview-avg 74.6→51.1 s. Note: every bot is
hazard-blind — none dodges rocks,
braces bumps, or deliberately holds out of grooves — so skilled-human survival
sits above the preview numbers; the human playtest that motivated the tighten
should arbitrate. Separation cadence→preview is ~1.5×; if human play confirms
rhythm is still too strong, slant more grooves or raise `grooveGrip`.

### Downhill stretches (2026-08-01, fifth phase-2 feature)

Seeded descents where forward speed eases (smoothstep tapers, 200 px) up to
`downhillBoost` (default 1.35×, slider) and back; segment depth varies 0.7–1.0 of
the boost. First descent lands ≈40–46 s in, then roughly every ~19 s, each
followed by an enforced recovery gap. Speed multiplies the existing pressures —
meander disturbance scales with it and reaction windows shrink — so no new force
to learn. Never through a pinch (speed and narrowing must not stack): a blocked
descent *slides forward* past the pinch rather than being dropped — the naive
skip-if-blocked gate left only 3 descents in 5½ min with the first at 67 s,
beyond any human run to date. Telegraphed by chevrons on the path (visible
through the whole approach taper). `speedFactor` lives on the sim state so
visual lean, slope disturbance and distance all use the effective speed.

Harness: negligible shift (preview-avg 51.1→50.7 s median) — the bots mostly die
before the first descent, so downhills are late-game spice for humans who outlast
them, priced accordingly.

## Feel & readability improvements adopted

- Telegraph the ramp: skid/dust particles and a subtle sound as `hold` exceeds
  ~0.25 s, and non-linear sprite lean, so the "point of no return" is learnable.
- Explain the drift visually: wind-blown grass/leaves, puddles, path-slope lines —
  the invisible force pushing Helen should have a visible cause.
- Pick **one** canonical score (time or distance) for personal bests — they diverge
  once speed ramps. Display both if desired; rank by one.

### True 2D meander (2026-08-01, the big one)

The centreline became a genuine 2D curve: heading = ramped sum of slow sines
peaking ≈105° — properly sideways, occasionally a touch downward. The camera
follows the path point (north-up, Helen ~58% down the screen), the world is
drawn as ribbon quads along the centreline in world space, and Helen's sprite
rotates with heading + lean. THE SIM IS UNCHANGED — it always lived in the path
frame; the meander now enters as a curvature disturbance
(`slopeAt = curvature × FOLLOW_PX`). Tuning: FOLLOW_PX 50 → everyone died ~8s
(sustained bends, unlike the old oscillating slope, drain bots continuously);
24 → still 40% down; **16 restores the tuned curve** (idle 14.4s, newbie 7.2s,
cadence 20.4s, preview 41.8/55.5s). Note the preview bots' thresholds were
built for oscillating disturbances; humans holding through a bend (the
long-hold skill) should do relatively better. Perf: frames cached per slice,
chunk builds budgeted 2/frame, camera sub-pixel (per-axis rounding of a
diagonal camera stair-steps).
