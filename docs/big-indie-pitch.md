# Big Indie Pitch — entry pack

Everything needed to enter any Big Indie Pitch edition (they all use the same
Google-Form fields). Prepared 2026-08-11.

## Which edition to enter

BIP is **in-person only** (no remote pitching; travel not covered), so pick by
geography, not deadline:

| Edition | Where | When | Deadline | Verdict |
|---|---|---|---|---|
| SLICE 2026 | Seattle, USA | 2 Sep 2026 | 19 Aug | Skip — transatlantic flight for a 5-min pitch |
| PG Connects Nordics (Mobile) | Helsinki | 20 Oct 2026 | ~mid-Oct | Plausible — short hop, mobile-focused |
| PG Connects Nordics (PC+Console) | Helsinki | 21 Oct 2026 | ~mid-Oct | Less relevant |
| **PG Connects London** | **London** | **~late Jan 2027 (announced each autumn)** | ~Jan | **The one — home turf. Watch bigindiepitch.com from ~Oct** |

Check https://www.bigindiepitch.com/ for the London edition announcement.

## Form answers (copy-paste)

- **Your name**: Andy Woods
- **Email**: andytwoods@gmail.com
- **Studio / team name**: Andy Woods (solo developer)
- **Team size**: 1
- **Country**: United Kingdom
- **Game name**: Helen Falls In
- **Platforms**: Mobile (Android — Google Play closed testing; web/PWA for iOS)
- **Stage**: Released (web); Android in closed testing on Google Play
- **Engine**: Custom TypeScript + PixiJS (no engine)
- **Price / business model**: Free. No ads, no IAP, no data collection — a gift.
- **Play it now (judges can play instantly, no install)**:
  https://andytwoods.github.io/helen-falls-in/
- **Elevator description (short)**:
  > A wobbly bicycle meditation. Cycle the real Wey towpath from West Byfleet
  > to Godalming, pub by pub, without falling in the canal. Two thumbs, ten
  > minutes, one very optimistic sunhat.
- **Longer description**:
  > Helen is cycling the Wey Navigation through the Surrey countryside. Two
  > thumbs steer her perpetually wobbling bicycle; the canal is always exactly
  > one overcorrection away. Falling in is allowed — climb out, drip dry,
  > carry on. Real pubs along the real waterway are checkpoints, and what
  > Helen drinks at them is up to you: a cocktail adds speed and wobble, a
  > sensible lemonade sobers her up. Ducks, herons, hecklers, a poo-throwing
  > gorilla and the occasional crocodile complete the towpath. Ten minutes end
  > to end, tuned by a 200-seed headless bot harness so that panicking spam
  > play always loses to calm, patient corrections — it is a meditation
  > disguised as slapstick.
- **What makes it unique (USP)**:
  > 1. A tap-left/tap-right steering model deep enough that bots which panic die in
  >    4 s while patient play survives indefinitely — tuned against a
  >    200-seed automated harness, not vibes.
  > 2. Real geography: an actual named towpath with its actual pubs, which
  >    locals recognise.
  > 3. Anti-commercial by design: free, offline, no ads, no accounts, no
  >    analytics. The store listing's data-safety section is one word: none.
  > 4. Built end-to-end by a solo academic directing an AI pair-programmer —
  >    art, physics, audio and store pipeline included.
- **Video / GIF**: ~/Downloads/helen-falls-in-gameplay.gif (49-frame gameplay
  capture, includes a dunking; re-record any time). Screenshots in
  assets/screenshots/.
- **Anything else**:
  > The whole game is code — even the pixel art and the generative audio are
  > program output, so the repo builds every asset from scratch. Wildlife is a
  > pure function of position and time.

## The 5-minute pitch (script)

1. **(0:00) Hook** — "Helen is cycling to the pub. That's it. That's the game.
   The catch: her bicycle wobbles, the canal is right there, and your entire
   interface is two thumbs, one job each." *(hand judge the phone, game already running)*
2. **(0:30) Let them play.** Say nothing for 45 seconds. The game teaches
   itself; the first dunking usually gets a laugh — and the death card jokes
   land better than any pitch line.
3. **(1:15) The depth** — "It looks like slapstick but it's tuned like a
   meditation: I run 200 headless bot seeds against every physics change.
   Spamming taps kills you in four seconds; calm, late, deliberate taps ride
   forever. Your heart rate is the difficulty curve."
4. **(2:00) The world** — real Wey Navigation, real pubs as checkpoints,
   cocktail-vs-lemonade risk system, unlockable pub starts, wildlife that's a
   pure function of (distance, time) so the world is identical for everyone.
5. **(3:00) The story** — solo academic, built with an AI pair-programmer in
   days, shipped everywhere at once: web, PWA, Google Play (closed test), with
   haptics on native. Free forever, zero monetisation, zero data.
6. **(3:45) The ask** — coverage/feedback: "It's a love letter to a Surrey
   towpath. I want people who walk it to find it. I don't need funding — I
   need eyeballs, so tell me what would make you write about it."
7. **(4:15) Buffer for Q&A spillover.**

## Likely judge questions — prepared answers

- **"How will it make money?"** — It won't; that's a feature. It's a portfolio
  and craft piece; future games may monetise, and this one demonstrates I can
  ship whole products fast.
- **"Made with AI — how much?"** — Directed by me, built substantially by an
  AI assistant: code, pixel-art pipeline, tuning harness. I designed, decided,
  playtested and steered everything. Happy to discuss the workflow — it's part
  of the story, not a secret.
- **"Retention? Sessions?"** — Ten-minute full runs, checkpoint restarts,
  personal bests, full-journey record. It's a cup-of-tea game, not a
  engagement trap — deliberately.
- **"Why such minimal controls?"** — Accessibility and depth: the constraint forces all
  difficulty into timing and restraint, which is what makes it meditative.

## Asset checklist

- [x] Playable web build (no install — judges' favourite thing)
- [x] Gameplay GIF — ~/Downloads/helen-falls-in-gameplay.gif (move somewhere safe)
- [x] Screenshots — assets/screenshots/ (phone 9:16 + iOS)
- [x] Icon 512 / feature graphic — assets/
- [x] Store copy — docs/play-listing.md
- [ ] 60–90s trailer video with sound (worth making before the London entry)
- [ ] Android closed-test opt-in link (once Google review completes, for judges
      who want the native build)
