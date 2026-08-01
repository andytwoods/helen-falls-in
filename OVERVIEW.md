# Helen Falls In

A brutally difficult one-button retro arcade game about Helen, who is cycling down a canal towpath on a very wobbly bike and is almost certainly about to fall in.

## Elevator pitch

Helen cycles along a narrow towpath with canal water on **both** sides — falling either way gets you soaked. The bike constantly wobbles and drifts. You have exactly **one input** — a button press (spacebar on web, touch anywhere on mobile) — and every press steers *towards* the centre of the path... then rapidly *past* it. The whole game is a fight against your own over-corrections. Newbies last about 5 seconds. A pro lasts a minute or two. Then Helen falls in, surfaces with a frog on her head, and you press to try again.

## Core mechanic: one-button over-correction steering

The entire game is a single held/released button. The rules:

1. **At press time**, the direction of correction is decided by which side of true centre Helen currently is:
   - Left of centre → holding the button steers **right**.
   - Right of centre → holding the button steers **left**.
2. **While held**, the correction accelerates — it starts gentle and ramps quickly, so holding even slightly too long swings Helen across the centre line into an over-steer in the opposite direction.
3. **Releasing and re-pressing** re-samples which side of centre Helen is on, so the correction direction flips as she crosses the line. Skilled play is a rhythm of short taps and micro-holds, feathering the steering; panicked long holds are what kill you.
4. **With no input**, the bike doesn't run straight: it wobbles. A base sway (noise + slow drift) is always pulling Helen off-line, and it worsens with speed and time, so you can never just leave it alone.

Tuning intent:
- Correction acceleration is deliberately too strong relative to the wobble — over-correcting must feel almost inevitable at first.
- The steering state (current lean/heading) carries momentum: crossing the centre line while holding doesn't stop you, it slings you towards the other edge.
- Death spiral: each over-correction tends to be bigger than the last unless the player taps to damp it. Learning to *damp* rather than *steer* is the core skill.

## Difficulty targets

- **First-time player:** ~5 seconds before falling in.
- **Average player after a few sessions:** 15–30 seconds.
- **Pro:** 1–2 minutes.
- No difficulty settings, no mercy. The score is time survived (and/or distance). The entire meta-game is chasing a personal best and daring friends to beat 10 seconds.

## Failure & the frog

Falling off either side of the path lands Helen in the canal, and triggers a short splash animation followed by a few stills (retro style, maybe 3–4 frames):

1. Splash / legs in the air.
2. Ripples.
3. Helen surfaces, dripping, with a **frog sitting on her head**. The frog blinks.
4. Score card: time survived, personal best, "press to ride again".

Because there's water on both sides, one animation set covers every failure. Instant restart — from splash to riding again in a couple of seconds, to keep the "one more go" loop tight.

## The path (level design)

The towpath scrolls vertically (or at a slight angle) with Helen near the bottom of the screen. It is procedurally varied and gets nastier the longer you survive:

- **Bumps and dips** — visible ripples in the path that jolt the steering (a bump kicks the lean angle randomly).
- **Grooves/ruts** — longitudinal grooves that "capture" the wheel and drag Helen sideways until she taps out of them.
- **Occasional rocks** — small obstacles; clipping one gives a hard sideways kick (usually fatal if you're already off-line).
- **Narrowing** — the path pinches down in places, sometimes to little more than the bike's width.
- **Grassy fringe** — a strip of grass on each edge of the path. Riding on it is survivable but the steering becomes heavy, sluggish and extra-wobbly — it's especially hard to recover from, a last-chance zone before the water.
- Speed slowly increases with distance, which shortens reaction time and amplifies everything above.

## Art direction: quaint retro

- **Pixel art**, low resolution (e.g. a ~160×288-ish virtual canvas scaled up with crisp nearest-neighbour), limited palette — think warm, storybook English-canal charm rather than harsh arcade.
- The world is *pretty on purpose*, in contrast to the cruelty of the gameplay: canal boats moored along the water, ducks and moorhens, dragonflies, a heron that flaps off as you pass, butterflies, rabbits in the verge.
- **Lots of flowers**: foxgloves, poppies, cow parsley, wildflowers dotted along both edges; lily pads and reeds in the canal.
- Gentle parallax: water shimmer on one side, hedgerow/fields beyond the verge on the other.
- Helen is **blond** — her hair is a key readable feature of the sprite at low resolution (and comically plastered down in the soaked frog-on-head frames).
- Helen and the bike have a pronounced wobble animation — the bike visibly leans with the current steering state so the player reads the physics from the sprite, not from a HUD.
- Chirpy chiptune loop; ding of a bicycle bell on new personal best; big daft *sploosh* on failure; frog "ribbit" on the score card.

## Platforms & tech (one codebase)

Targets: **Web, Android, iOS** from the same source.

Chosen approach:
- **TypeScript + Pixi.js** (thin WebGL renderer, pixel-art friendly via nearest-neighbour scaling) with a small bespoke game loop — fixed-timestep update, nothing between us and the steering tuning constants. Audio via howler.js or ZzFX; letterbox scaling handled with a small shim.
- Wrapped with **Capacitor** for the Android and iOS store builds; the web build deploys as-is (works instantly in any browser, easy to share).
- Input abstraction is trivial: `pointerdown/pointerup` and `keydown/keyup(space)` both map to the same single `button` state.
- Fixed-timestep physics update so the feel is identical across devices/refresh rates.
- Portrait orientation on mobile; the same tall play-field letterboxed on desktop web.
- Local high-score persistence (localStorage / Capacitor Preferences). Online leaderboards are a possible later addition, not v1.

## Decisions (2026-08-01)

- **Layout change (supersedes "water on both sides" above):** the canal is on the
  **right** of the towpath only; on the **left** is a grassy verge with trees,
  bushes, drainage ditches and a hedgerow. Falling right is the splash + frog
  sequence (the frog animation stays a single set).
- **The verge is ridable** (second decision, same day): riding off the left edge
  is survivable, but steering turns very choppy there (control cut to ~a third,
  wobble nearly tripled) and hitting *anything* is fatal — a tree, a bush, the
  drainage ditch that guards the verge entrance in stretches, or the solid
  hedgerow at the far edge. Each obstacle death gets its own flavour text (and
  needs its own crash still in the art pass). Verge scenery is therefore part of
  the seeded, replayable world model, not decoration.

- **Perspective:** top-down vertical scroll — path scrolls down the screen, Helen near the bottom; left/right screen position maps literally to path position. Portrait-native.
- **First milestone:** greybox feel prototype — rectangles only, full wobble/over-correction model, on-screen tuning sliders, seeded/replayable runs with telemetry. Prove the feel before any art. **Tested in a phone browser from the start** — touch latency (50–100 ms vs a desktop spacebar) changes the tuning, so mobile-web testing happens during the greybox phase, not after (per external review).
- **Art:** AI-generated pixel art, hand-tweaked in a pixel editor for palette consistency. Placeholders until gameplay is proven.
- **Mobile:** web app (Vite + TS + Pixi) tested in mobile browsers throughout; Capacitor store shells added only once the game is fun.
- **Steering model:** specified in `docs/STEERING.md` — persistent-lean model with velocity damping, predictive press sampling, and OU-noise wobble, synthesised from two independent LLM design reviews (raw replies in `docs/llm-reviews/`).
- **Art pass v1 (2026-08-01):** in-code pixel art replacing the greybox — warm
  storybook palette (`PAL` in `render.ts`), top-down Helen sprite authored as a
  pixel map (blond hair dominant, per the art direction; swappable for hand-drawn
  textures later), textured verge/path/water, wildflowers (poppy, cow parsley,
  foxglove), lily pads, lit tree canopies. All decoration is hash-deterministic —
  replays render identically. Still to art: splash + frog-on-head sequence, hedge
  and ditch crash stills, sound.

## Scope for v1

1. Core steering/wobble physics tuned to the difficulty targets above.
2. Scrolling procedural path with bumps, dips, grooves, rocks, narrowing, grass fringes.
3. Fall-in animation with frog, score card, instant restart.
4. Pixel art pass: Helen + bike (wobble/lean frames), path tileset, water, flowers, a handful of wildlife sprites.
5. Chiptune loop + a few sound effects.
6. Web build live; Capacitor shells building for Android/iOS.

Out of scope for v1: leaderboards, unlockables, multiple characters, power-ups (arguably the game should *never* have power-ups — the purity of one button and certain doom is the point).
