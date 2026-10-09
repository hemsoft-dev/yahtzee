# iOS screenshot validation

Checked against Apple's public documentation on September 28, 2026, EDT.

## Format requirement

Apple's [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) allow one to ten JPEG or PNG screenshots per applicable screenshot set. Images must not contain alpha channels or transparency. An RGBA image whose alpha values are all 255 still has an alpha channel.

This repository's capture checker accepts PNG inputs only. It fully decodes the image with CRC checking, then rejects the decoder's alpha/transparency metadata. This covers grayscale-alpha and RGBA images, palette transparency and RGB transparency metadata, including images whose decoded pixels are all opaque. It does not silently flatten or rewrite an approved file. Re-export a rejected capture without alpha, inspect it again and record its new checksum.

[Regression tests](../scripts/ios-release/screenshots.test.mjs) exercise the actual PNG decoder and release checker. Seven alpha/transparency cases failed before the guard was added; the RGB control passed. Dimension matching, provenance and exact-byte checksum checks remain in place.

## Decoder safeguards

The [bounded PNG reader](../scripts/ios-release/png.mjs) validates every chunk's framing and CRC, requires exactly one IHDR and IEND, and rejects animation chunks and nonconsecutive image-data chunks. It checks dimensions before allocation, then verifies the exact decompressed scanline size for standard and Adam7 layouts. Decompression has an output limit and must consume the entire compressed stream. These checks precede the image decoder.

The decoder alone is insufficient for these limits. pngjs accepts a second IHDR after the header inspected by the old guard. A 131-byte reproduction advertised width 1 in its first header but decoded width 8,193, bypassing the 8,192-pixel limit. The repair rejects duplicate headers before decoding. It also checks CRCs of ancillary chunks that pngjs skips, and bounds Adam7 inflation, which pngjs otherwise inflates without an output limit. [Framing regressions](../scripts/ios-release/screenshots.test.mjs) and [decompression regressions](../scripts/ios-release/png.test.mjs) failed before these guards.

Inputs remain limited to 64 MiB, 8,192 pixels per dimension and 32 million pixels. This is a screenshot reader, not a general-purpose PNG conformance or color-management verifier. Alpha-bearing images remain rejected even when opaque.

## What passing means

Passing this checker proves only its listed consistency and PNG checks. An accepted manifest is an input claim, not authenticated owner approval or proof that the image depicts the named app binary.

The checker does not yet validate Apple's per-display size sets, required device/localization coverage, scene completeness or uploaded order. The one-pixel unit fixtures test the PNG contract; they are not valid App Store assets. The [live size table](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) and [upload instructions](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots/) still govern final preparation and storefront review.

[Issue #51](https://github.com/hemsoft-dev/yahtzee/issues/51) also requires deterministic native scene capture, full-size visual inspection, approved identity/content and the final App Store Connect previews. Engineering screenshots and unsigned simulator tests do not satisfy those approvals. This change performs no capture upload, submission or publication.
