# Product

<!-- impeccable:product-schema 1 -->

## Scope

Shared product context for the web, desktop, and mobile apps and their shared packages. This record separates the owner's confirmed direction from current implementation details. Existing features are not permanent requirements merely because they are listed here.

## Platform

adaptive

The product spans a React web app, an Electron desktop app, and an Expo/React Native app targeting iOS and Android. The owner permits separate platform interfaces rather than requiring the same interface everywhere. This is permission to adapt future work, not a claim that the current mobile app already has distinct iOS and Android designs.

## Users

The owner and his wife are the intended users. The owner requested a self-contained offline Windows build to send to his wife. No broader audience or public-growth goal has been established.

## Product purpose

A Yahtzee-style dice game for personal and household use. Current play supports solo score chasing or competition against AI opponents.

The owner has not specified a competitive positioning claim or measurable success target. Do not invent either.

## Operating context

The current game has a setup, play, and results flow:

1. Enter a display name and choose a dice count and number of AI opponents.
2. Roll, hold dice, reroll, and choose a scorecard category on each turn.
3. Review final scores and the leaderboard for that dice count, then start another game.

Online web/desktop apps remember recent display names and the light/dark preference locally. Online games require a reachable Convex backend, including solo play. Reloading or losing that client process abandons access to its active game.

The portable Windows edition runs offline and saves completed scores on the player's PC. Its unfinished games are abandoned on close. The separate native mobile app runs the shared rules offline, saves acknowledged active games and resumes them after process loss. Native appearance offers System, Light and Dark. Local scores are not server-verified and do not sync online.

## Capabilities and constraints

These are repository-verified implementation facts, not newly requested commitments:

- One local human can play against zero to three AI opponents. There is no remote human multiplayer or room/join flow.
- Web and desktop expose custom dice counts from 2 to 20. Mobile offers 5, 6, 8, and 10.
- Turns allow up to three rolls, with dice holding and category selection. Scorecards include totals and upper-section bonuses.
- The scoring uses house rules. Five-dice play has 15 categories rather than the standard 13; pairs are included, and three/four of a kind score matching dice only. Do not describe the current rules as standard Yahtzee.
- Upper-section bonus targets are 63 for five dice, 84 for six to eight, 105 for nine or ten, and 210 for twenty. Larger games target half the dice per number, rounded up, with a four-match minimum. Only the combined upper score must reach the target. The bonus remains 35 points for five dice and 100 for six or more.
- Suggested picks and AI category selection preserve Chance when a made combination or an upper score at bonus pace is available. They include any bonus secured by the choice, and use Chance rather than a zero or weak upper score when no preferred pick remains. This is a current-roll heuristic, not a full-game optimizer.
- In the online edition, Convex owns game state, dice rolls, move validation, AI turns, and completed results. Clients request moves rather than submitting trusted totals.
- Completed-game history and top-ten leaderboards are separated by dice count. Display names are labels, not authenticated identities; name-based averages are not account statistics.
- Online guest access expires after 12 hours and stays in client memory. There is no account login or game-access recovery.
- The portable offline Windows edition needs no Convex service or developer tools. It retains local top-ten scores per dice count and the last 500 completed games, with no online sync. Unfinished games are abandoned on quit or close.
- Native mobile retains acknowledged active games, the last 500 completed games and local top-ten scores per dice count. Damaged or unavailable saves enter visible recovery without silent replacement. Exact-byte write retry, explicit discard/reset and cold resume are covered by unsigned native simulator qualification, not signed-device or release acceptance.
- Remote multiplayer is documented as planned, not implemented. The owner has not made it a priority in this product interview.

The owner identified no additional must-preserve requirements. House rules and variable dice counts remain current behavior, but were not confirmed as defining product commitments. This record does not authorize removing or changing them without a scoped request.

## Evidence on hand

- [Repository overview](D:/github/HemSoft/yahtzee/README.md) records implemented gameplay, platform boundaries, setup, and known limits.
- [Guest-game contract](D:/github/HemSoft/yahtzee/docs/guest-games.md) records session lifetime, result authority, retry behavior, and identity limits.
- [High-score replay contract](D:/github/HemSoft/yahtzee/docs/high-score-replays.md) records duplicate-result protection.
- [Web app](D:/github/HemSoft/yahtzee/apps/web/src/App.tsx), [mobile app](D:/github/HemSoft/yahtzee/apps/mobile/app/index.tsx), and [shared settings](D:/github/HemSoft/yahtzee/packages/ui/src/GameSettings.tsx) show the current workflows and controls.

No audience research, testimonials, or comparative product claims were supplied during initialization.

## Product principles

- Prioritize the owner's play experience. Do not assume requirements for public acquisition, monetization, or social growth.
- Allow each platform to use appropriate interactions. Shared game rules and data do not require identical controls or layouts.
- Distinguish implemented behavior from future plans and binding requirements. Personal-use scope does not make unimplemented features available.

## Open decisions

No product-specific accessibility needs or conformance target were established. No new brand or visual commitments were made. Multiplayer priority, broader distribution, and changes to the existing rules remain undecided.
