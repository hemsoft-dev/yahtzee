# iOS changelog

No iOS version has shipped. Windows and web changes have their own release history.

## Unreleased

### Added

- Separate offline native gameplay with acknowledged active-game saves, cold resume, explicit discard/reset, damaged-save recovery, local history and rankings. Repository implementation landed in [#57](https://github.com/HemSoft/yahtzee/pull/57); signed-device acceptance remains open in [#41](https://github.com/HemSoft/yahtzee/issues/41).
- iPhone/iPad layouts, scalable native text, System/Light/Dark appearance, Help and optional preview-before-share diagnostics. Unsigned simulator evidence is linked in [#57](https://github.com/HemSoft/yahtzee/pull/57), not physical-device/VoiceOver acceptance.
- Original development icon/launch artwork and source-bound unsigned simulator CI with gameplay, storage-recovery and privacy-manifest packaging checks. Brand approval, signing and release evidence remain open in [#45](https://github.com/HemSoft/yahtzee/issues/45) and [#46](https://github.com/HemSoft/yahtzee/issues/46).
- Draft release records, editable listing sources and a fail-closed candidate check. Tracked in [#47](https://github.com/HemSoft/yahtzee/issues/47).

## Release entry format

After public-store verification, move the applicable Unreleased entries under `## 1.0.0 - YYYY-MM-DD`, using the release date in Eastern Time. Include the exact iOS build, source commit, source tag and public listing link. Link implementation PRs; do not list planned features as shipped.

Later entries use Added, Changed and Fixed only when applicable. App Store What's New text is a short summary of that release's user-visible changes. The first submission may not expose this updates-only field. Never invent a prior release or a release date to fill it.
