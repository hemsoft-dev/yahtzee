# Native local game

Mode: Operate. Target: Expo/React Native on iPhone and iPad. This is the separate native adaptation requested by issue #42, not a change to the desktop/web system.

Use the established evergreen dice deck, porcelain pip faces and clay action color as the game-specific layer. Use system typography, scalable text, semantic iOS surfaces and text colors, native stack navigation, sheets/alerts and safe areas for the surrounding interface. Do not copy the desktop's dense table or shrink it to phone width.

Compact windows use a vertical play/score flow with a reachable roll action. Expanded iPad windows separate the play controls from the score list. Window width and text scale determine that structure, not a hard-coded device name. All targets are at least 44 points; no fixed-height text containers or decorative permissions, sound, haptics or animation are required.

The local store owns acknowledgment, retries and persistence. Show loading, corrupt/unavailable data, pending-write retry, explicit reload/reset, Resume/Discard and local-only result states. Never imply that a local score is server-verified. Keep one accessible score action per category and describe held/suggested states in words as well as color.

The existing development name is not public branding approval. There will be no iOS App Store release. Native screenshots must identify their source commit and device; web-adapter tests are only supplemental coverage. Physical-device and VoiceOver checks remain separate.

Verification is bounded: implement the complete flow, inspect a batched iPhone/iPad light/dark and large-text pass, fix the observed issues together, then one confirmation pass. Native functional failures still need diagnosis and regression tests; do not polish indefinitely.
