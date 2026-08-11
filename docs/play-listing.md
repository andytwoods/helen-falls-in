# Google Play listing — ready to paste

Everything below is staged for the Play Console once account verification
completes. Asset files live in `assets/`; the signed AAB is
`android/app/build/outputs/bundle/release/app-release.aab`.

## Create app

- App name: **Helen Falls In**
- Default language: **English (United Kingdom) – en-GB**
- App or game: **Game**
- Free or paid: **Free**

## Store listing

- Short description (max 80 chars):

  > A wobbly bicycle meditation: cycle the Wey towpath, pub by pub, stay dry.

- Full description:

  > Helen is cycling the Wey Navigation from West Byfleet to Godalming — about
  > ten minutes of towpath, if she stays out of the water.
  >
  > One thumb steers her wobbly bicycle. Falling in is allowed: climb out,
  > carry on. Reach a pub and it becomes a starting point for next time — and
  > what Helen drinks there is up to you (a cocktail adds speed and wobble; a
  > sensible lemonade sobers her up).
  >
  > A small, free pixel-art meditation set in the Surrey countryside: ducks,
  > herons, dragonflies, hecklers, the occasional crocodile, and real pubs
  > along a real English waterway.
  >
  > • Two thumbs, two directions — that's the whole control scheme
  > • About ten minutes end to end, with checkpoints at real pubs
  > • Full journey record and personal bests
  > • No ads, no accounts, no data collection — works offline
  > • Set on the real Wey Navigation: West Byfleet → Godalming

- App icon (512×512): `assets/play-icon-512.png`
- Feature graphic (1024×500): `assets/play-feature.png`
- Phone screenshots (min 2): capture from emulator/device at 1080×2400
  (intro, riding, a pub stop, a dunking)
- Category: **Game > Casual** (or Arcade)
- Tags: casual, arcade, offline
- Contact email: andytwoods@gmail.com
- Privacy policy URL: https://andytwoods.github.io/helen-falls-in/privacy.html
  (public/privacy.html — deploys with the next push to main)

## Questionnaires

- Content rating: no violence against realistic humans, no sex, no profanity,
  **references to alcohol** (Helen may choose a cocktail at a pub — answer the
  "references to alcohol" question YES; expect a PEGI 3–7 / Everyone-with-note
  style rating). No gambling, no user-generated content, no chat.
- Data safety: collects **nothing**, shares **nothing**; data stored locally on
  device only. No encryption-in-transit question applies (no transmission).
- Ads: **none**. In-app purchases: **none**.
- Target audience: 13+ (avoids the extra "designed for children" policy work;
  the game is family-friendly but declaring under-13 target triggers Families
  policy requirements).
- App access: all functionality available without credentials — "All
  functionality is available without special access".

## Release plan

1. Closed testing track ("Helen testers"), upload `app-release.aab`
   (versionCode 1, versionName 0.1.0, signed with android/upload.keystore).
2. Add ~12 testers by email (Google requirement for new personal accounts:
   closed test running 14 days with 12 testers before production access).
3. After the 14 days: apply for production, roll out.
