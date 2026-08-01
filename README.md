# Helen Falls In

**▶ Play it now: <https://andytwoods.github.io/helen-falls-in/>**

A one-button pixel-art journey, set in the Surrey countryside, UK: Helen is
cycling the Wey Navigation from West Byfleet to Godalming on a very wobbly
bike, calling at the pubs along the way. Canal on one side, hedgerow on the
other. The whole ride takes about ten minutes — falling in is allowed (climb
out, carry on), and every pub you reach becomes a starting point for next time.

One input: **hold space** (desktop) or **touch anywhere** (mobile). Every press
steers against the bike's visible tilt… then rapidly past it. It's a small
meditation — for you; perhaps less so for Helen.

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
