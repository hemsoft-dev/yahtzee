# Yahtzee

A dice game for web, Electron desktop and Expo mobile, sharing a TypeScript game engine. Play one local human against zero to three AI opponents. Convex owns active games and persists their computed results.

Remote play with friends is not implemented. There is no room creation or join flow. The guest-game API supports one local human, not remote human multiplayer. The online clients require a configured, reachable Convex backend. A separate portable Windows edition runs fully offline and saves scores on the player's PC.

## Implemented gameplay

- Five-dice play and extended six-or-more-dice modes. Web and desktop offer custom counts from 2 to 20; mobile offers 5, 6, 8 and 10.
- One human player and up to three AI opponents. The shared engine generates rolls, validates moves and runs AI turns using a single roll and a category-selection heuristic. The online version executes these rules in Convex; the offline edition executes them locally.
- Dice holding, up to three rolls per turn, scorecard totals and upper-section bonuses.
- House-rule scoring includes pairs and scores three/four of a kind using matching dice only. The five-dice scorecard has 15 categories, rather than the standard 13-category Yahtzee sheet.
- Verified completed-game history and top-ten leaderboards per dice count. Display names are not authenticated account identities. Guest capabilities stay in memory, expire after 12 hours and are lost on reload; see [the security and migration contract](docs/guest-games.md).

## Stack and layout

| Directory | Role |
|---|---|
| `apps/web` | React and Vite web application |
| `apps/desktop` | Electron and electron-vite application |
| `apps/mobile` | Expo and React Native application |
| `packages/game-engine` | Dice, scoring, totals and AI rules |
| `packages/ui` | Shared session lifecycle, web/desktop controls and themes |
| `convex` | Authorized game moves, temporary sessions, verified results and rankings |

The project uses Bun workspaces. Native mobile renders its own controls; it does not render the shared HTML scorecard.

## Portable Windows edition

Build a self-contained offline EXE and ZIP on Windows:

```sh
bun run package:offline
bun run test:offline
```

Send the ZIP from [the desktop release directory](D:/github/HemSoft/yahtzee/apps/desktop/release). No Convex setup, internet, installer, or developer tools are needed on the recipient's PC. The unsigned build may trigger a Windows publisher warning. See [offline packaging and local-data details](D:/github/HemSoft/yahtzee/docs/offline-desktop.md).

## Setup

Use Bun 1.4.2 and Node.js 24.3 or newer, or Node 22 LTS at 22.13 or newer. CI uses Node 24; Windows validation used Node 24.12.0. Install the checked-in dependency versions:

```sh
bun install --frozen-lockfile
```

### Online backend and environment

1. Run `bun run dev:convex` from the repository root and follow the Convex development-project setup. This can create deployment configuration and deploy development functions. Use a development project, not production, for local testing.
2. Edit the repository-root `.env.local` created by Convex. Preserve its `CONVEX_DEPLOYMENT` selector and add or verify `VITE_CONVEX_URL` using the development deployment's HTTPS URL. Use `.env.local.example` as a reference, not as a replacement for the generated file. Both Vite configurations explicitly read environment files from this root.
3. For mobile, create `apps/mobile/.env.local` and set `EXPO_PUBLIC_CONVEX_URL` to the same URL. Expo runs from the mobile workspace and reads its environment there; putting only the Expo variable in the repository root is not enough.
4. Restart the frontend after changing environment values. Never commit local environment files or deployment credentials.

Example values, to replace with your own development URL:

```dotenv
# Repository-root .env.local, for web and desktop
VITE_CONVEX_URL=https://your-development-deployment.convex.cloud
```

```dotenv
# apps/mobile/.env.local, for Expo
EXPO_PUBLIC_CONVEX_URL=https://your-development-deployment.convex.cloud
```

The deployment URL is client-visible, not a secret. Do not put Convex deploy keys or other credentials in `VITE_` or `EXPO_PUBLIC_` variables. Missing URLs stop the online applications with a startup error, including solo play. These settings are not used by the portable offline edition.

### Run

Keep the development backend command running in one terminal and start one client in another:

```sh
bun run dev:web
bun run dev:desktop
bun run dev:mobile
```

Mobile device/simulator setup and native packaging require the corresponding Expo/platform tooling. A successful TypeScript check or desktop bundle does not prove a native package is signed or installable.

### Validate and build

```sh
bun run test          # Engine and isolated backend tests
bun run test:watch    # Watch mode
bun run typecheck     # All workspaces, Convex and validation tools
bun run lint          # TypeScript, React Hooks and ESM configuration
bun run security      # Dependency advisories, no exceptions currently accepted
bun run build:web
bun run build:desktop
bun run build:mobile   # Android/iOS JavaScript and Hermes, not signed native packages
bun run test:clients:install  # Install pinned Chromium and Electron test binaries
bun run test:clients          # Web, actual Electron and mobile-source journeys
bun run quality:measure       # Production function complexity, branch coverage and CRAP
bun run mutation:probe        # Reject a deliberately weakened bonus assertion
bun run mutation              # Typechecked core-rule mutation gate
```

See [client qualification](docs/client-qualification.md) for Linux display dependencies, artifacts, failure probes and native-device limits. The suite uses an isolated in-memory backend, not a deployment. [Function-risk measurement](docs/function-risk.md) combines these journeys with instrumented unit/backend tests and an explicit inventory of unimported production code.

[Mutation testing](docs/mutation-testing.md) records the 95% break threshold, 98% target, measured survivors and isolated sensitivity proof.

See [the lint policy](docs/lint-policy.md) for rules and generated-code exclusions. No production deployment is needed for these checks. A frontend build without a URL can compile, but it will not start successfully until configured.

## Planned work

Remote human multiplayer is planned, not part of the current application. Do not interpret shared leaderboards as live multiplayer. Server-authoritative results, durable replay handling and isolated client journeys are implemented. Remaining work is tracked in the [issue queue](https://github.com/hemsoft-dev/yahtzee/issues).

## License

[MIT](LICENSE).
