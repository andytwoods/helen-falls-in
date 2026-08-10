# App Store listing — ready to paste

For App Store Connect once Xcode is installed and the app is archived/uploaded.
The iOS project is `ios/App/App.xcworkspace` (open the workspace, not the
project). Bundle ID: `com.andytwoods.helenfallsin`.

## App Store Connect setup

- Platform: iOS · Name: **Helen Falls In** · Primary language: English (UK)
- Bundle ID: com.andytwoods.helenfallsin (register at
  developer.apple.com/account → Identifiers if not auto-created by Xcode)
- SKU: helenfallsin
- Category: Games > Casual (secondary: Games > Arcade)
- Price: Free · No in-app purchases

## Copy

- Subtitle (30 chars max): **A wobbly bicycle meditation**
- Promotional text (170 max):

  > Cycle the Wey towpath from West Byfleet to Godalming, pub by pub, without
  > falling in. Ten minutes. No ads, no accounts.

- Description: reuse the full description from docs/play-listing.md.
- Keywords (100 chars): cycling,canal,pixel art,meditation,casual,one button,offline,pub,Surrey,relaxing
- Support URL: https://andytwoods.github.io/helen-falls-in/
- Privacy policy URL: https://andytwoods.github.io/helen-falls-in/privacy.html

## App Privacy questionnaire

- Data collection: **No data collected** (the easy path — one answer).

## Age rating questionnaire

- Everything "None" except **Alcohol, Tobacco, or Drug Use or References →
  Infrequent/Mild** (Helen may choose a cocktail at a pub). Expect a 12+ or
  lower rating.

## Screenshots

- Required: 6.9" (1320×2868) and 6.5" (1284×2778 or 1242×2688) iPhone sets —
  capture from the iOS Simulator (iPhone 16 Pro Max etc.) once Xcode is in.
- assets/screenshots/ has Android captures for reference; retake on iOS
  simulator for correct dimensions.

## Build & upload steps (once Xcode installed)

1. `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
2. Open `ios/App/App.xcworkspace`, sign into Xcode → Settings → Accounts with
   the Apple Developer Apple ID, pick the team on the App target.
3. Product → Archive → Distribute App → App Store Connect.
4. TestFlight first (instant for internal testers), then submit for review.
