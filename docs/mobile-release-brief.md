# Third Roll 1.0 release brief

Decided November 2, 2026 EST under Franz's delegated product authority. This
versioned record preserves the [November 1 decision](https://github.com/hemsoft-dev/yahtzee/issues/39#issuecomment-6569139784)
in [issue #39](https://github.com/hemsoft-dev/yahtzee/issues/39).

## Identity and rights

Keep **Third Roll**. A turn allows three rolls, so the name describes the last
chance to improve a hand. It avoids the licensed game's name and fits the free
hobby project better than paying for branding or a domain. Subtitle direction:
"Offline dice, house rules". No trademark registration or exclusive rights are
claimed. The repository name and internal category IDs do not define public branding.

The November 1 conflict screen recorded US/UK/DE App Store, Steam, Google Play,
web and USPTO searches without a matching live game name. A November 2 web
recheck for `"Third Roll" dice game app`, `"Third Roll" trademark game`,
`site:apps.apple.com "Third Roll"` and `site:store.steampowered.com "Third Roll"`
found descriptive references to third rolls rather than an exact game title.
This is a limited conflict screen, not a complete register search or legal
clearance. The prior USPTO result was not independently reproduced in this
session. Non-US registers, unregistered rights and reserved/unpublished store
names remain unchecked. The [USPTO search](https://www.uspto.gov/trademarks/search)
and actual store-name reservation must be rechecked before distribution.
Do not buy a domain or commission a paid clearance search under this decision.

Use repository-authored dice geometry and icon/launch sources under MIT, with
[asset provenance](../apps/mobile/assets/README.md). The website's bundled
Manrope has its [SIL Open Font License](../packages/ui/src/assets/OFL.txt).
Native UI uses system fonts. No third-party sound or music is approved.
Do not copy Hasbro artwork, rulebook text, score sheets or logos. Keep Yahtzee,
Yatzy and close variants out of public titles, keywords and screenshots.
MIT source licensing does not grant third-party trademark rights. Review any
new asset's source and license before including it.

## Launch contract

- Free, English, iPhone and iPad, minimum iOS 17.0. Existing Expo SDK 57
  configuration and inspected simulator packages support this target.
- Automatic orientation, tablet support and `requireFullScreen: false` retain
  rotation and iPad multitasking intent. Device acceptance remains required.
- One local human, zero to three computer opponents, five/six/eight/ten dice.
  Offline play, durable acknowledged saves, local history and local high scores.
- Version 1.0.0/build 1 proposed; identifier `com.hemsoft.thirdroll`. A previously
  uploaded build number must never be reused.
- All storefronts except China mainland, subject to account/legal eligibility
  and the later store setup. No availability is claimed before publication.
- No accounts, ads, purchases, subscriptions, analytics, cloud sync, remote
  players or Game Center. Android distribution, widgets, Apple Watch and
  provider integrations are outside 1.0. CodexBar support parity does not add
  those features.

## Frozen house rules

Source baseline: `0b01666`, the [rename PR](https://github.com/hemsoft-dev/yahtzee/pull/96).
The [scoring registry](../packages/game-engine/src/scoring.ts) and
[suggestion logic](../packages/game-engine/src/game.ts) remain the implementation
contract. No rule change is authorized by this brief.

| Mode | Upper target | Bonus |
| --- | --- | --- |
| 5 dice | 63 | 35 |
| 6 dice | 84 | 100 |
| 8 dice | 84 | 100 |
| 10 dice | 105 | 100 |

Only the combined upper total must reach the target. Full Straight requires
all faces 1 through 6 and scores 50. Castle means two triples of distinct faces,
with the entire hand summed, including extras in eight/ten dice. Six identical
dice are not two distinct triples. Eight/ten-dice games have no dedicated
six-of-a-kind category. All of a Kind requires the whole hand to match and
scores 50 at five dice under the internal ID `yahtzee`. At six or more dice,
`maxi-yahtzee` replaces that row and scores 100. Each scorecard exposes only
one All of a Kind row. The existing category ordering and internal IDs remain
unchanged.

Chance sums the hand. Suggestions preserve it when a made combination or an
upper score at bonus pace is available, count a bonus secured now, and prefer
Chance over a zero or weak upper score when no preferred choice remains. This
is a current-roll heuristic, not an optimal full-game strategy.

## Release boundaries

The [tracker](../apps/mobile/APP-STORE.md) owns candidate evidence and remaining
gates. This decision approves product direction and original repository assets;
it does not certify SDK privacy, export classification, physical-device QA or
legal attestations. No App Store Connect access, upload, submission or spending
is authorized in this session. Public copy must distinguish implemented source
from a shipped release. No iOS release has shipped.
