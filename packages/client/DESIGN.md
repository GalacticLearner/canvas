---
name: Canvas
description: A calm architecture studio for shared classroom drawing.
colors:
  paper: "oklch(97% 0.012 100)"
  surface: "oklch(99% 0.005 100)"
  ink: "oklch(27% 0.035 160)"
  muted: "oklch(46% 0.023 160)"
  line: "oklch(84% 0.018 140)"
  accent: "oklch(36% 0.065 160)"
  on-accent: "#fff"
  wash: "oklch(92% 0.03 145)"
  warning: "oklch(91% 0.09 85)"
  danger: "#a83232"
  focus: "#a26900"
  dark-paper: "oklch(19% 0.018 155)"
  dark-surface: "oklch(23% 0.022 155)"
  dark-ink: "oklch(94% 0.016 100)"
  dark-muted: "oklch(76% 0.02 140)"
  dark-line: "oklch(39% 0.023 150)"
  dark-accent: "oklch(78% 0.09 150)"
  dark-on-accent: "#142d20"
  dark-wash: "oklch(32% 0.04 155)"
  dark-warning: "oklch(37% 0.06 85)"
  dark-danger: "#ff9999"
  dark-focus: "#e9bf65"
typography:
  display:
    fontFamily: "Newsreader Variable, serif"
    fontSize: "clamp(40px, 4vw, 58px)"
    fontWeight: 450
    lineHeight: 1.07
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Public Sans Variable, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Public Sans Variable, sans-serif"
    fontSize: "15px"
    fontWeight: 700
  body:
    fontFamily: "Public Sans Variable, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  label:
    fontFamily: "Public Sans Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 550
rounded:
  compact: "4px"
  control: "6px"
  floating: "8px"
  rail: "10px"
  panel: "12px"
  circular: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px"
  tab-selected:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink}"
  badge:
    textColor: "{colors.ink}"
    rounded: "{rounded.compact}"
    padding: "4px 7px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "26px"
    width: "540px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.floating}"
    padding: "12px 18px"
---
# Design System: Canvas

## Overview

**Creative North Star: "Architecture studio critique"**

Canvas uses the architecture studio critique as its visual world: warm drawing paper, forest ink and compact workshop controls leave the authored board in charge. The connection screen introduces the workspace with a literary serif; the editor uses restrained sans-serif labels and familiar tools.

The system is dense around the edges and open in the center. Floating tools are opaque and lightly lifted; docks use a single dividing line. Fonts are bundled locally for offline use.

**Key Characteristics:**
- Warm paper and forest controls.
- Open canvas with compact perimeter tools.
- Opaque surfaces, visible focus and redundant identity labels.

## Colors

A forest-green primary sits on warm neutral paper; ochre marks focus, text selection and caution.

### Primary
- **Forest action:** accent supplies primary button fill, active borders, connected-state dots and native input accents; on-accent supplies its text.
- **Forest wash:** wash marks hover, active controls, selected tabs and the notification strip.

### Secondary
- **Ochre focus and caution:** focus supplies keyboard and swatch outlines; warning supplies text selection and reconnect banners. These roles are separate even though both are warm.
- **Error red:** danger is reserved for error copy.

### Neutral
- **Warm paper:** paper is the drawing-stage and connection background.
- **Raised paper:** surface is the opaque control, dock and dialog background.
- **Forest ink:** ink supplies primary text; muted supplies supporting copy and placeholders; line supplies separators and control borders.
- Dark-prefixed frontmatter entries record the shipped dark-theme overrides for these same roles. High contrast maps line to muted and muted to ink through CSS variable resolution.

**The Readable Identity Rule.** Pair participant color with initials and an accessible full name; use visible names in participant lists.

Drawing swatches are authored content, not additional UI accents: forest, blue, vermilion, berry, ochre and white are available alongside a custom color input.

## Typography

**Display Font:** Newsreader Variable, serif fallback.
**Body Font:** Public Sans Variable, sans-serif fallback. Both families are bundled through local font packages.

The serif carries the connection heading and empty-board invitation. The sans-serif carries tools, forms and collaboration content. Default body text is compact; paragraphs have a line-height of 1.6.

### Hierarchy
- **Display:** fluid connection heading, as recorded in frontmatter.
- **Headline:** section heading; the empty-board invitation instead uses Newsreader at 32px and weight 450.
- **Title:** compact 15px subsection heading.
- **Body:** 14px default; introduction copy uses 16px and a 39ch measure; chat uses 13px with line-height 1.5.
- **Label:** 13px, weight 550, sentence case. Property-strip labels use 11px, supporting status and timestamps use 12px after cascade overrides; badges and keyboard hints use 11px.
- Room codes use tabular numerals and 0.08em tracking. There is no distinct mono family.

## Layout

**The Canvas First Rule.** Keep persistent controls at the perimeter; the board occupies the remaining workspace.

The editor fills the viewport with a session bar above a flexible drawing region. At standard scale the floating tool rail has two 38px columns, with the property strip starting 112px from the left. At 125% and 150% scales it has three 32px columns, rendered through the app zoom, with the property strip starting at 142px. Viewport controls anchor bottom-left; presentation controls center near the bottom. Presentation hides ordinary editor chrome.

The right dock starts at 320px and is resized with a pointer separator or 20px arrow-key increments between 280px and 480px, additionally constrained by available workspace width. At widths of 1280px or less it overlays the board; the top bar wraps. Above that boundary the dock participates in layout. The app compensates its viewport dimensions for the selected UI zoom.

The connection screen is a two-column grid, capped at 1600px, with 54px/6vw outer padding and an 8vw gap. Its form is capped at 480px. At the 1280px breakpoint padding becomes 40px/5vw and the gap 5vw; the grid remains two columns. Reused spacing steps are in frontmatter; local form gaps also include 14px and 17px.

## Elevation & Depth

Depth comes from opaque tonal layers, single borders and a shared soft shadow. There is no glass treatment. A 24px dotted board grid is a working aid rather than ornamental texture.

### Shadow Vocabulary
- **Floating light:** `0 5px 18px #142d201c` on tool rails, properties, popovers, viewport controls, dialogs and toasts.
- **Floating dark:** `0 6px 20px #0005` replaces the shared shadow in dark theme.
- **Overlay dock:** `-8px 0 24px #15251b15` at the compact-width breakpoint.

**The Quiet Lift Rule.** Use the shared soft shadow for floating tools and overlays; resting docks and rows use borders.

The dock layer is 20; presentation controls are 30; toasts sit at 40 near the top (78px), below dialogs at 50. The final cascade takes precedence over earlier stylesheet declarations.

## Shapes

Controls use gently rounded corners; badges and keyboard hints are tighter. Floating groups have slightly broader corners and dialogs are broadest. Exact reused radii are in frontmatter. Participant avatars and drawing swatches are circular; navigation tabs have square edges and an active underline. Dividers and field borders are one pixel.

## Components

### Buttons
Compact, familiar controls with a 36px minimum height, 8px icon gap and shared padding. Primary uses accent/on-accent; secondary uses surface/ink. Hover uses wash; the primary hover also applies brightness(1.12) under the actual cascade. Disabled buttons use opacity 0.5 and a not-allowed cursor. Keyboard focus is a 2px focus-colored outline offset by 3px. Background feedback uses 140ms ease-out; reduced motion removes transitions and animations.

Icon buttons are 38px wide at standard scale; SVG icons are normally 18px. Higher-scale rail buttons use the compact dimensions described in Layout. Connection primary actions have a 44px minimum height; inline action buttons are 30px high.

### Chips
Badges are supplementary, capitalized text with a thin line border and no filled status color. Keyboard hints use paper fill and compact borders. Avatars use participant color, two initials and an accessible full name.

### Cards / Containers
There is no general card grid. The reusable dialog panel is a 540px-wide opaque surface with 26px padding, 20px internal gap and a maximum height of 85vh. Dock content uses 16px padding and gaps; version rows are separated with a bottom border. Popover disclosures use a minimum width of 180px, 12px padding and the floating surface treatment.

### Inputs / Fields
Inputs use surface fill, ink text, line border and the shared control radius, with 10px padding. Placeholders are muted; carets use accent. Labels stack above fields with a 7px gap. Error copy is adjacent and danger-colored. Checkboxes and ranges use native controls with accent color. The app has no separate custom disabled-field visual token.

### Navigation
Tabs and segmented controls share a flat row: equal-width 13px labels, a 4px gap and a dividing line. Selection adds wash and a 2px accent underline. Tabs carry selected semantics and use left/right arrows to move focus and selection.

### Frames and presentation
Frame rows pair a flexible text navigation button with compact adjacent actions and wrap as needed. Frame navigation and presentation controls connect the authored board to a slide-like sequence without introducing a separate visual identity.

### Notifications
Toasts invert ink and paper, use the floating radius and shadow, and appear in a centered stack near the top. Persistent connection notifications use wash or warning bands and text, preserving a distinct treatment from transient feedback.

## Do's and Don'ts

### Do:
- **Do** use semantic palette roles so light, dark and high contrast stay coordinated.
- **Do** preserve the visible focus outline and reduced-motion override.
- **Do** keep fonts local and use SVG icons with accessible labels.
- **Do** keep drawing colors distinct from interface status colors.

### Don't:
- **Don't** add glass decoration, ornamental gradients or emoji icons.
- **Don't** use color as the only participant or connection-state cue.
- **Don't** nest decorative cards around the canvas or introduce network fonts.

Evidence: extracted from `src/styles.css` including its final overrides, `src/components/ui.tsx`, `src/design/Gallery.tsx` and frame/presentation markup in `src/app/App.tsx`. This records shipped source behavior; it does not establish a measured contrast or runtime accessibility result.
