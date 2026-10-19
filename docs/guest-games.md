# Guest games and trusted results

## Authority

The online web and Electron editions deliberately use guest capabilities rather than account login. This contract does not describe the separate [offline native mobile adapter](mobile-offline.md) or [portable offline Windows edition](offline-desktop.md). A nickname is a display label, not proof of identity. `gameSessions.start` creates a 256-bit random secret in a Node action. Only its SHA-256 hash is stored. Each game's read/move endpoint checks the game ID, matching secret and 12-hour expiry. Another game's secret grants no access. Internal creation and expiry functions are not public APIs.

Convex owns the dice, held positions, scorecards, turn order, AI choices, timestamps and completion state. Clients send only roll, hold or category-selection requests with the last observed revision. Dice counts are safe integers from 2 through 20; AI counts are 0 through 3. Names are nonempty labels up to 32 characters with no ASCII control characters. Client-supplied totals, completion times and logs are not accepted. The old `highScores.submit` and `gameLogs.add` endpoints reject even otherwise well-shaped requests.

A completed game's log, durable score receipts and bounded leaderboard changes commit in the same mutation as its terminal state. Repeating an old revision returns the current authorized state without another transition. A future revision is rejected. This prevents duplicate completion writes and supports retrying a lost response. Revisions are not a guarantee that two different concurrent client intentions both execute: only one transition can own a revision.

The secret exists only in the shared hook's memory: not local storage, native preferences, URLs or a public query. Losing the process/reloading abandons the game. The server deletes expired temporary game rows; completed logs, rankings and replay receipts remain. There is no capability recovery, account linking or remote multiplayer.

## Client behavior

The online web and Electron clients use `useGameSession`. Requests are serialized. A failed move leaves its exact intent pending and disables further moves; retry reuses its original revision. A lost completion response can therefore recover the already committed result without creating another log or ranking. Quitting invalidates the local request generation, so a late response cannot resurrect that game or replace a newly started one.

Network access is required throughout a game. The production Convex SDK controls transport reconnection; the isolated UI suite tests loss/retry through its explicit test transport, not Convex's WebSocket implementation. A dead or expired capability requires a new game.

Capabilities are bearer credentials. Anyone who steals one can act in that game until expiry; this does not defend against browser compromise or XSS. Valid guests can automate legal moves, reuse display names and start many games. This is result-integrity enforcement, not identity verification, bot prevention or a production rate-limiting policy.

## Additive migration and deployment

`games` is new. The log and score `verified` fields are optional, and the new indexes include that marker. Existing rows remain schema-valid and are not deleted or silently relabeled. Trusted history, statistics and rankings query only `verified: true` rows created through server completion. Previously self-reported rows consequently disappear from those views but remain in storage. They cannot be made trustworthy by a mechanical backfill.

Deploy the backend and updated clients as a coordinated release. Older clients' direct result submissions intentionally fail after the backend update. Do not restore those public writes as a compatibility workaround. No production deployment, data rewrite or legacy cleanup is part of local qualification.

Normal Convex code generation uses its deployment-aware CLI. For a no-credentials source-only API refresh, run the [offline API generator](../scripts/convex-api-offline.mjs) with `bun run codegen:offline`. It invokes the pinned package's pure API template against local module names. It does not validate or deploy a remote schema. Backend TypeScript and Convex-test validation remain required.

## Checks

`bun run test` covers missing/forged/cross-game capabilities, invalid setup and choices, dice-count bounds and representative supported modes, expiry, atomic completion, concurrent retries, disabled legacy writes and exclusion of historical unverified data. `bun run test:clients` exercises the actual client components through the real backend handlers in isolation. See [the platform and artifact contract](client-qualification.md).
