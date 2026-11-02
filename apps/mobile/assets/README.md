# Development icon and launch assets

These assets use original repository-authored SVG geometry derived from the game's pip controls. There is no external artwork, font, sound or copied product logo. The source and exports follow the repository's MIT license. This does not clear third-party names or trademarks.

`icon-source.svg` is the editable source. It combines a tilted porcelain die, an evergreen background, four evergreen corner pips and a clay center pip. Do not add lettering, an Apple-style rounded mask or an outer transparent margin to the iOS icon exports. iOS applies its own shape.

- `icon.png`: opaque light/App Store master, 1024 by 1024.
- `icon-dark.png`: opaque dark variant, 1024 by 1024.
- `icon-tinted.png`: opaque grayscale tinted variant, 1024 by 1024.
- `launch-mark.png`: transparent launch/Android foreground mark, 1024 by 1024.

Regenerate from the repository root with ImageMagick 7.1.2-13 Q16-HDRI:

```sh
node scripts/ios-assets/generate.mjs
node --test scripts/ios-assets/check.test.mjs
```

The generator changes colors from the SVG source, strips export metadata and records the renderer plus source/export hashes in `provenance.json`. The source hash normalizes line endings to LF. Tests fully decode the PNGs, check hashes/dimensions/opacity, enforce grayscale for the tinted variant and check app-configuration references.

Inspect native launch, small home-screen, dark and tinted rendering before release. File validation and local image inspection do not prove every system treatment. `publicIdentityApproved` records the name decision in [#39](https://github.com/hemsoft-dev/yahtzee/issues/39). It is not legal clearance. Do not treat the icon files or source license as App Store approval.
