# Portable offline edition

The Windows offline edition runs the existing game locally, without Convex, internet access, an account, or installed developer tools. It uses the shared rules, including the recent scoring, bonus, and suggestion changes. The online desktop/web entry points and the [separate offline native mobile adapter](mobile-offline.md) remain separate. Native mobile can resume acknowledged active games; this Windows edition stores completed games only.

## Build and share

On Windows with the repository dependencies installed:

```sh
bun run package:offline
bun run test:offline
```

Packaging produces a portable x64 EXE and a ZIP in [the desktop release directory](D:/github/HemSoft/yahtzee/apps/desktop/release). Send the ZIP. The recipient extracts it and double-clicks the application. Windows 10 or 11, 64-bit, is required. There is no installer or administrator requirement.

The build is unsigned. Windows may display an unknown-publisher or SmartScreen warning. Do not disable system security to distribute it. The ZIP includes [player instructions](D:/github/HemSoft/yahtzee/docs/offline-player.txt).

Building may download Electron and packaging tools. Running the resulting application does not need those downloads or an internet connection.

## Local data

Electron keeps the offline edition's data in `%APPDATA%\Yahtzee Offline`, separate from the online app. To back up or move scores, close the app and copy that entire directory. The executable's temporary extraction directory does not hold saved scores.

Completed scores and history persist across app restarts. High scores retain the top ten per dice count; history retains the last 500 games. Unfinished games stay in memory and are abandoned when the window closes or the player chooses Quit Game. Local scores do not sync to Convex and are not presented as server-verified scores.

The adapter rejects unreadable saved records without overwriting them. It checks that storage is writable before starting. If saving a final move fails, the app offers Retry move and keeps the computed result in memory, avoiding duplicate entries or rerolled AI turns. Free disk space and retry before closing the window.

## Packaging boundary

[The offline build configuration](D:/github/HemSoft/yahtzee/apps/desktop/electron.offline.config.ts) selects independent main and renderer entry points. There is no Convex provider or endpoint in this renderer. Its content security policy forbids connections, and the Electron session blocks non-file/non-data requests and navigation to other pages. Node integration is disabled and the renderer is sandboxed.

[The packaging script](D:/github/HemSoft/yahtzee/scripts/package-offline.ts) stages only compiled code, local assets, metadata, and licenses. It verifies the packaged archive contains only those entries. It explicitly excludes node_modules because electron-builder otherwise discovers the online workspace's dependencies. No environment files, credentials, development backend, or user profile are shipped.

[The shared session rules](D:/github/HemSoft/yahtzee/packages/game-engine/src/session.ts) are also used by the existing Convex functions. Online authorization, revisions, expiry, schema, and result verification remain server-side. This extraction does not deploy the backend.

## Verification

[Offline unit tests](D:/github/HemSoft/yahtzee/packages/game-engine/tests/offline.test.ts) cover every supported preset, three AI opponents, roll/hold rules, invalid moves, corrupt data, storage failure, and idempotent completion retries. The normal quality command also runs the existing online client journeys and backend tests.

[The portable smoke test](D:/github/HemSoft/yahtzee/tests/offline/portable.spec.ts) copies the actual single-file EXE into a temporary folder with spaces in its path and launches it with an isolated profile. It disables network connectivity, plays six-, eight-, and ten-dice games through the UI, restarts the EXE, verifies saved data, and checks play-again and quit. It attaches through a local debugging port because the portable wrapper does not forward Electron's normal automation pipe. Ordinary launches do not enable that port. The test-only `YAHTZEE_OFFLINE_DATA_DIR` override prevents qualification games from entering the owner's scores.

This is a local Windows qualification, not a signed release or a test on the recipient's PC.
