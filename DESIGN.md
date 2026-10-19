---
name: Yahtzee desktop and web
description: A sampler-style dice console with an evergreen play deck and split scorecard.
colors:
  page: "#eff2ee"
  surface: "#ffffff"
  surface-soft: "#e7ece6"
  ink: "#203a34"
  muted: "#576a61"
  line: "#ccd7cd"
  selected: "#deeadb"
  select-ink: "#284d36"
  deck: "#1e453a"
  deck-ink: "#f5f4e9"
  deck-muted: "#c0d3c5"
  action: "#f2a07e"
  action-ink: "#35281f"
  focus: "#b34f2b"
  error: "#9c342c"
  error-bg: "#fce8e3"
  dark-page: "#182521"
  dark-surface: "#23352e"
  dark-surface-soft: "#2d4137"
  dark-ink: "#edf1e7"
  dark-muted: "#b4c4b6"
  dark-line: "#465e4c"
  dark-selected: "#3c5942"
  dark-select-ink: "#e2eedb"
  dark-deck: "#102f26"
  dark-focus: "#ffba93"
  dark-error: "#ffd0c5"
  dark-error-bg: "#57312a"
  pip-ink: "#244033"
  held-die: "#cee2af"
  held-border: "#f4f4dd"
  lime-detail: "#d4e7b5"
  lime-indicator: "#c9dca4"
  roll-hover: "#ffb292"
  roll-disabled: "#3c594b"
  roll-disabled-ink: "#b8c9b8"
typography:
  display:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "clamp(38px, 4.5vw, 68px)"
    fontWeight: 750
    lineHeight: 1.12
    letterSpacing: "-.04em"
  title:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "clamp(27px, 2.6vw, 40px)"
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: "-.035em"
  body:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 750
    lineHeight: 1.5
  button:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 750
    lineHeight: 1.5
rounded:
  panel: "16px"
  control: "10px"
  field: "9px"
  segment: "7px"
  die: "14px"
  compact-die: "12px"
  potential: "5px"
spacing:
  control-gap: "10px"
  layout-gap: "24px"
  compact-layout-gap: "18px"
  preset-gap: "8px"
  segment-gap: "4px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.page}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.select-ink}"
  button-primary-disabled:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.muted}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 20px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 10px"
  button-quiet-hover:
    backgroundColor: "{colors.error-bg}"
    textColor: "{colors.error}"
  button-roll:
    backgroundColor: "{colors.action}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.control}"
    padding: "10px 20px"
    width: "100%"
  button-roll-hover:
    backgroundColor: "{colors.roll-hover}"
  button-roll-disabled:
    backgroundColor: "{colors.roll-disabled}"
    textColor: "{colors.roll-disabled-ink}"
  button-icon:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    width: "44px"
    padding: "0"
  player-name-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "12px 14px"
    width: "100%"
  opponent-selector:
    backgroundColor: "{colors.surface-soft}"
    rounded: "{rounded.control}"
    padding: "4px"
  dice-preset:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "10px 4px"
  dice-preset-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.select-ink}"
  die:
    backgroundColor: "{colors.deck-ink}"
    textColor: "{colors.pip-ink}"
    rounded: "{rounded.die}"
    padding: "14px"
    width: "70px"
    height: "70px"
  die-held:
    backgroundColor: "{colors.held-die}"
  scorecard:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "22px 24px 16px"
---

# Design System: Yahtzee desktop and web

## Overview

**Creative North Star: "The tactile sampler console"**

The dice sit on an evergreen deck, with the roll button below them and the scorecard alongside. Porcelain faces and circular pips give the controls their physical character. The sampler reference comes through the grouped inputs and persistent roll control, not through imitation audio equipment.

This is a post-build record of the desktop and web redesign. The owner plays the game personally, called the previous interface old-school, plain and boring, and delegated the modern visual direction. The sampler choice was code-led. It is not a claim of public approval. This document records that implementation; it does not authorize another replacement.

Scope is the shared desktop/web interface in [GameApp](D:/github/HemSoft/yahtzee/packages/ui/src/GameApp.tsx) and [game.css](D:/github/HemSoft/yahtzee/packages/ui/src/game.css), following the [direction contract](D:/github/HemSoft/yahtzee/apps/desktop/.impeccable/surfaces/apps-desktop-src-renderer-app-tsx.md). Native mobile is a separate adaptation with an evergreen dice deck, porcelain faces and clay actions. Its [fallback palette](D:/github/HemSoft/yahtzee/apps/mobile/src/ui/palette.ts) and [semantic iOS colors](D:/github/HemSoft/yahtzee/apps/mobile/src/ui/colors.ios.ts) surround that game layer with native system surfaces and scalable typography. This desktop/web record does not prescribe the native layout. Narrow browser layouts below are still web layouts, not native mobile specifications.

**Key Characteristics:**
- Evergreen play deck against a mineral-white shell, with graphite-green dark mode.
- Clay-orange roll action and pale-green held dice and score suggestions.
- Manrope text, tabular scores, and visible pip geometry.
- Blurred die shadows and a lifted held state; flat surrounding panels.

Frontmatter tokens are normative extracts of the current CSS. Unsuffixed colors describe light mode. Each `dark-` token replaces the matching color in dark mode; colors without a dark override stay unchanged. Radius and spacing names label observed values, not an added CSS token API. Component values describe default desktop/web styles; the responsive overrides below still apply.

## Colors

### Primary

Clay-orange `action` identifies the roll and play-again controls in both themes. The setup start button uses `ink` on `page`, not orange. `focus` supplies the general keyboard outline and the brand punctuation.

### Secondary

Pale greens identify held dice, selected setup options, the suggested score, and small deck details. `selected` and `select-ink` change with the theme. Die face colors remain fixed so pips keep their porcelain-and-green treatment.

### Neutral

`page`, `surface`, and `surface-soft` separate the shell, panels, and grouped controls. `ink`, `muted`, and `line` carry text and table structure. `deck`, `deck-ink`, and `deck-muted` form the contrasting play area. Error text and backgrounds have their own light and dark pairs.

**The state evidence rule.** Color accompanies an observable state. Held dice also lift and say "Held"; selected setup buttons expose pressed state; suggested scores use a marker and a filled score badge.

## Typography

Manrope is a bundled variable font, loaded with swap behavior and weights 200 through 800. Segoe UI and sans-serif are fallbacks, not the intended display face. There is no separate mono font.

The display role belongs to the welcome heading. The title role belongs to the current turn heading. Body text uses the base role; settings labels and legends use the label role. Tables, progress, round counts, turn summaries, and final scores use tabular numerals.

The compact desktop query sets the welcome heading to 45px and the turn heading to 29px. Settings headings use `clamp(24px, 2.5vw, 34px)` with a 1.25 line height. Scorecard headings are 21px normally and 18px in the compact query. Table body text remains 12px in that query; the compact fit comes mainly from spacing. Small metadata varies by context and is not a new universal type scale.

## Layout

The centered frame caps at 1560px with 32px horizontal padding. Setup pairs the welcome deck and form in a 1.15fr / 1fr split. Play uses `minmax(290px, .78fr) minmax(0, 1.6fr)` with the deck first and scoring second. Results use `minmax(300px, .85fr) minmax(0, 1.25fr)`.

At widths of at least 900px and heights at most 900px, the frame padding becomes 24px, the header becomes 64px tall, and the play deck has a 552px minimum height. Score rows use a 27px minimum height and 4px padding. Totals use a 10px top margin and 6px top cell padding. These are bounded desktop density adjustments, not defaults for every display.

Between 900px and 1100px wide, play uses a 280px deck, a flexible scorecard, and a 16px gap. Below 900px, play and results stack. At 580px and below, setup and the scorecard sections also stack, frame padding becomes 14px, and score actions have a 44px minimum height.

Scorecard sections normally sit side by side. With more than two players they use wider columns and stack at 1199px and below. The scorecard retains horizontal scrolling when its minimum table widths exceed the available space. Dice wrap; hands above ten dice use 48px faces. Do not infer that every 20-dice or multi-opponent game fits in one viewport. The desktop shell permits vertical scrolling as a fallback.

## Elevation & Depth

Only the dice need object shadows. Welcome dice use `0 12px 22px #061d2540`; playable dice use `0 5px 10px #071f2145`; held dice use `0 8px 14px #071f2152`. Panels separate through color rather than shadows.

**The lifted die rule.** Hover moves an enabled die up 3px. Held state applies a 5px lift, a pale border, and the held label. Keep the blurred shadows; hard offset slabs are not part of this system.

Button color and press transitions take .16s with ease-out. Dice settle over .4s and unheld dice toss over .5s while rolling. Score totals settle over .35s. Dice movement uses `cubic-bezier(.16,1,.3,1)` where specified. Reduced-motion preference disables animations and transitions throughout the game.

## Shapes

Panels use the shared panel radius. Controls have smaller rounded corners, while dice have square faces with rounded edges. Welcome dice use a proportional 22% radius; playable dice use the die radius, with compact sizes adjusted in CSS.

Pips are circles arranged on a three-by-three grid. Their positions express actual die values; they are not texture. Brand and action icons are inline SVG. The setup illustration is CSS and pip geometry, with no shipping raster illustration.

## Components

### Buttons

Primary, secondary, quiet, roll, and icon buttons share rounded controls and a visible keyboard outline. General buttons have a 44px minimum height. Start and roll buttons normally use 52px; the compact roll button uses 44px. Pressed buttons move down 1px. Primary and roll buttons have explicit disabled color pairs. The quiet quit action gains error colors on hover. Secondary retry has a border but no distinct hover color in the current CSS.

The general focus ring is a 3px solid `focus` outline with a 3px offset. Dice use the action color and a 5px offset. Disabled controls keep native disabled semantics. Pending start and move states have text announcements; do not substitute animation alone.

### Inputs and selectors

The player name field is a bordered panel-colored input with a 48px minimum height. Its placeholder uses `muted`. The custom dice-count field is narrower and permits the existing 2 to 20 range.

The opponent selector is a four-button group on `surface-soft`. Its pressed button uses `surface`, `ink`, and weight 800. Dice presets are four bordered options with a large count and a smaller label. Pressed presets use selected colors and a stronger border. Recent names are underlined text buttons, not navigation tabs.

### Dice

[DiceRow](D:/github/HemSoft/yahtzee/packages/ui/src/DiceRow.tsx) renders real pip faces and hold buttons. Each die has a value label and pressed state for assistive technology. The visible Hold/Held text sits below it. Rerolling affects only unheld dice. No raster image or text glyph replaces a numbered pip face.

### Scorecard and results

[Scorecard](D:/github/HemSoft/yahtzee/packages/ui/src/Scorecard.tsx) uses separate Numbers and Combinations tables. Available categories are buttons; potential scores are outlined. The suggested category has a tinted row, an arrow, and a filled score badge. Already-scored values remain plain. Bonus progress and grand totals stay within the card.

Results reuse the dark deck and light panel pairing, with ranked final scores on one side and the leaderboard on the other. The header is a brand and action bar, not a route-navigation system. Do not invent tabs or chips for it.

## Do's and Don'ts

### Do:
- Do keep the roll control directly below the dice and put play before scoring when the web layout stacks.
- Do show held and suggested states with text, geometry, or markers as well as color.
- Do retain keyboard outlines, pending-state text, and reduced-motion behavior.
- Do use the current CSS theme overrides for desktop and web.

### Don't:
- Don't apply this palette to native mobile or replace its existing theme without a separate request.
- Don't turn the dice into raster illustrations or substitute glyphs for pip faces.
- Don't restore hard offset die shadows or give every panel a shadow.
- Don't shrink all text to force large hands and multi-opponent tables into one viewport.
