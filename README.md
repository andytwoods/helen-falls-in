# Helen Falls In

**▶ Play it now: <https://andytwoods.github.io/helen-falls-in/>**

A brutally difficult one-button retro arcade game. Helen is cycling along a canal
towpath on a very wobbly bike — canal on one side, hedgerow on the other — and she
is almost certainly about to fall in.

One input: **hold space** (desktop) or **touch anywhere** (mobile). Every press
steers against the bike's visible tilt… then rapidly past it. The whole game is a
fight against your own over-corrections. First-timers last about 5 seconds.

See `OVERVIEW.md` for the design and `docs/STEERING.md` for the steering model and
its tuning history (every constant is validated by a headless bot harness).

## Development

```
npm install
npm run dev        # open the printed URL
npm run dev -- --host   # ...or open the LAN URL on a phone
npm run harness    # headless survival stats for idle / tap-spam / controllers
npm run typecheck
npm run build
```

The ⚙ button opens the tuning sliders (persisted to localStorage; export via
"Copy params JSON"), a sound toggle, and run-telemetry download (last 100 runs —
each run's seed + input log makes any death replayable).

Deploys to GitHub Pages automatically on push to `main`.
