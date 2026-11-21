# Development icon and launch assets

These assets use original repository-authored SVG geometry derived from the game's pip controls. There is no external artwork, font, sound or copied product logo. The source and exports follow the repository's MIT license. This does not clear third-party names or trademarks.

`icon-source.svg` is the editable source. It combines a tilted porcelain die, an evergreen background, four evergreen corner pips and a clay center pip. Do not add lettering, an Apple-style rounded mask or an outer transparent margin to the iOS icon exports. iOS applies its own shape.

- `icon.png`: opaque light master, 1024 by 1024.
- `icon-dark.png`: opaque dark variant, 1024 by 1024.
- `icon-tinted.png`: opaque grayscale tinted variant, 1024 by 1024.
- `launch-mark.png`: transparent launch/Android foreground mark, 1024 by 1024.

The PNG exports were rendered from the SVG source with ImageMagick 7.1.2-13 Q16-HDRI. `provenance.json` records that renderer and the source/export hashes; the source hash normalizes line endings to LF. The generator and its PNG check were removed on November 21, 2026 with the iOS release tooling, so nothing regenerates or verifies the exports now. If you change the source or an export, update `provenance.json` to match.

Inspect native launch, small home-screen, dark and tinted rendering on a device. Local image inspection does not prove every system treatment. `publicIdentityApproved` records the name decision in [#39](https://github.com/hemsoft-dev/yahtzee/issues/39). It is not legal clearance.
