# Privacy policy draft

Prepared September 27, 2026. This is development copy, not an approved policy for a published app. The owner must approve the public identity, contact information and final declarations after the signed candidate is measured. See the [privacy acceptance issue](https://github.com/hemsoft-dev/yahtzee/issues/48).

## Data on the device

The native gameplay code stores the player name, up to five recent names, game preferences, the active game and its held dice, completed scores, and local rankings in the app's private storage. It retains the latest 500 completed games and the all-time top ten entries per supported dice mode. Local rankings are not an online leaderboard.

The development build has no account, remote players, cloud-sync feature, advertising or purchases. It does not import online game records. Its SQLite document is not encrypted by the application. Device security and operating-system data protection are separate from application-level encryption.

## Retention, deletion and backups

An active game stays available until it is completed, explicitly discarded or removed with the local-data reset. A confirmed reset deletes the app's current game data and preferences from its container. A failed reset remains visible and can be retried. Damaged or unsupported data remains in place until an explicit recovery or reset choice.

Deleting the app removes its local container. Offloading may retain it. The storage location is eligible for operating-system backups, subject to device settings and backup behavior. Restoring a backup can restore older game data. Resetting the current app does not erase existing backups. Physical-device backup and restore verification is still pending.

## Diagnostics and support

The current source requires a preview before sharing diagnostics. The preview contains the app version and build, platform and OS version, a compact or expanded window category, and save-schema and scoring-rule versions. It excludes player names, game identifiers, scores, saved documents, error text, logs and credentials. Nothing is sent when a preview opens or closes.

Choosing Share opens the operating system's share controls with exactly the previewed text. The selected app or destination may use the network and follows its own privacy practices. Sharing is optional.

The repository's [GitHub issue page](https://github.com/hemsoft-dev/yahtzee/issues) is public. Do not post player names, save files, credentials or screenshots containing private information there. GitHub handles information submitted to it under [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

An owner-approved private support contact and final public policy URL have not been selected. They must be provided before this draft is published as the release policy.

## Native SDKs and release verification

The first unsigned simulator build contains an embedded JavaScript bundle and has Expo updates disabled in its compiled configuration. Static inspection is not proof of zero network traffic or a completed privacy audit. Bundled SDK behavior, manifests and signatures, signed-archive permissions, and measured traffic still require release verification.

The [engineering inventory](../../docs/mobile-privacy-audit.md) records observations and open work. App Store privacy answers and export-compliance classification remain unset. No legal attestation is supplied by this draft.
