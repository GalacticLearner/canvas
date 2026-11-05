# Canvas technical audit — Phase 11 Assessment B

Method: independent Assessment B sub-agent; no Assessment A or CRITIQUE.md findings read. Target: the built Canvas Electron renderer and `packages/client/src/app`, `packages/client/src/components`, `src/styles.css`, `src/canvas/BoardCanvas.tsx`, Electron host and CSP. Date: 2026-11-04.

## Remediation follow-up — current-build verification

**Current scoped audit score: 15/20 (Good)**: Accessibility 3, Performance 3, Theming 3, Responsive 3, Implementation integrity 3. This remains a scoped engineering judgment, not compliance certification. The initial four findings below are retained as history and have been addressed in the reviewed source/build. The follow-up keyboard fidelity issue has also been corrected and verified; no open P1/P2 issues remain within this audit scope.

Independent Electron follow-up (`design/AUDIT-FOLLOWUP.json`, `screens/audit-followup-light.png`) verified:

- Focusing Workspace settings and pressing Space now opens its dialog (count 1).
- Canvas objects exposes the created object as a native button. Searching by displayed author “You” returns 1 item. Keyboard selection closes the modal, focuses the canvas, and reports 1 selected object.
- Status metadata computes to 12px. Source also applies 12px to message times and participant metadata; avatar initials retain a redundant accessible full name.
- The overlay performed **0 clearRect calls during a 1.5 second idle sample** after deselection, instrumented locally through its canvas drawing context. This establishes the absence of continuous drawing in that short empty-presence state, not a CPU/battery benchmark. The root's latest additional resize optimization was not in this tested build.
- Root reports the separately refreshed E2E matrix passed keyboard connect/draw/chat/leave, dialog containment/Escape/focus return and property/dock reachability in both themes at 100/125/150%. Those matrix checks were not independently replayed by this sub-agent.

### [Resolved P2] Keyboard creation used a stale tool

- Location: `packages/client/src/canvas/BoardCanvas.tsx`, `create()` and the keyboard effect whose dependencies are `[board, editing]`.
- Category: Accessibility / implementation integrity.
- Evidence: after clicking **Rectangle (R)** and focusing the canvas, pressing Enter created an object exposed by the navigator as **stroke**, while the statusbar displayed **Rectangle · 1 selected**. The keyboard listener calls its captured `create()` closure, which reads `props.tool`, while its effect does not update on tool changes. The initial failed rectangle/shape search expectations came from this actual type mismatch; author search succeeded.
- Impact: a keyboard user receives a different object than the selected tool promises.
- Recommendation: construct using current tool/style values or refresh the callback dependencies; verify Rectangle, text and mind-map keyboard creation match the chosen tool. Suggested command: `$impeccable harden`, followed by `$impeccable polish`.


### Final fresh-build verification

After the keyboard effect dependencies were updated, independent fresh-build checks created **rect**, **text**, and **mindnode** objects using the selected Rectangle, Text and Mind map tools and keyboard Enter. Edited text and mind-map content appeared correctly in Canvas objects. All three matched their selected tools (`design/AUDIT-FINAL.json`). The stale-tool finding is resolved.

Primary button hover now retains `var(--accent)` as its background. Actual computed hover styles in the fresh Electron renderer gave foreground/background token contrast **10.58:1 light** and **7.61:1 dark**. These are pre-filter ratios: the active `brightness(1.12)` filter was recorded, and composited screenshot pixel contrast was not separately sampled. The foreground/background token regression is resolved; do not cite those figures as post-compositor measurements.

No open P1/P2 findings remain within the verified design audit scope. This is not an exhaustive accessibility certification: physical assistive technology, physical touch, higher-than-150% scaling, every identity/canvas overlap and measured performance workloads remain qualified as above. The fresh-build check window was closed; its temporary helper removed. Historical detector counts and initial score remain below for traceability.

All follow-up audit apps closed in `finally`. The temporary follow-up helper was removed. Initial detector outputs remain historical and were not rerun; do not present their pre-fix microtext counts as current defects. Contrast, physical touch, assistive-technology and higher-than-150% scaling qualifications below still apply.
## Initial implementation integrity verdict

The product has a coherent token system and real drawing/collaboration controls. Release readiness is limited by keyboard-event scope and the canvas accessibility model. An empty source detector result is not an accessibility pass.

| Dimension | Score | Verified scope / key finding |
|---|---:|---|
| Accessibility | 2/4 | Native labels, focus outline and dialog support exist; canvas shortcuts intercept native controls and board objects have no semantic navigation. |
| Performance | 2/4 | Spatial culling and separate static/overlay canvases exist; the full overlay clears and redraws on every animation frame while idle. No runtime performance profile recorded. |
| Theming | 3/4 | Light/dark tokens update; measured text token ratios are strong. Selection/cursor/identity colors and white thumbnail backgrounds bypass theme tokens. |
| Responsive design | 3/4 | Prior Electron screenshots cover minimum supported 1100×650 and 100/125/150% UI scale, plus 4K. No physical touch, 200% text, or RTL test performed. |
| Implementation integrity | 3/4 | Consistent primitives and hardened Electron renderer; source scan clean, rendered scan finds functional microtext. |
| Total | **13/20** | **Acceptable; significant accessibility work remains.** |

Scores are audit judgments within this scope, not compliance certification. Issues: P0 0; P1 2; P2 2; P3 0.

## Detailed findings

### [P1] Canvas shortcuts consume native control keys

- Location: `packages/client/src/canvas/BoardCanvas.tsx:742–802`, `:924–993`; the listener is attached to `window`.
- Category: Accessibility / implementation integrity.
- Evidence: the early guard excludes inputs, textareas and selects, but excludes neither buttons nor an active dialog. Space calls `preventDefault()` regardless of focus. In an actual isolated Electron window, focusing **Workspace settings** and pressing Space opened zero dialogs; pressing Enter opened one (`AUDIT-KEYBOARD.json`). With a selected mind node, the global Tab/Enter branch creates and edits nodes instead of limiting that gesture to the board. Delete and arrow handling similarly act on selection outside the board.
- Impact: expected keyboard activation fails; board commands can alter content while the user operates other controls. WCAG 2.1.1 and expected native button interaction are at risk. The mind-node Tab behavior was source verified, not separately exercised in this audit.
- Recommendation: scope board editing keys to the focused canvas or an explicitly active canvas editing context; return when a dialog or unrelated interactive control owns focus. Preserve all mind-map shortcuts inside that context, with Escape restoring normal traversal. Suggested command: `$impeccable harden`.

### [P1] Existing board objects are pixels without an accessible object navigator

- Location: `packages/client/src/canvas/BoardCanvas.tsx:1019–1029`; `packages/client/src/components/SelectionProperties.tsx:6–16`.
- Category: Accessibility.
- Evidence: the rendered canvas has one generic accessible name and no children describing objects. Arrow keys move an internal insertion point when nothing is selected; Enter can create an object. Editing controls only appear after an existing object has been selected. No semantic per-object text, selection traversal, or object list exists in the reviewed canvas implementation.
- Impact: a keyboard or screen-reader user cannot inspect and select arbitrary existing board content through the canvas. A keyboard creation smoke test does not establish accessibility of reading/editing a populated board. Relevant standards: WCAG 1.1.1 / 2.1.1. No physical assistive-technology test was performed.
- Recommendation: add a synchronized, keyboard-navigable object/outline view exposing type, meaningful text, selection, layer order and edit actions; announce selection changes. Keep the visual canvas and all current tools. Suggested command: `$impeccable harden`.

### [P2] Functional metadata uses 10px type

- Location: `packages/client/src/styles.css:173–183`, `:488–495`, `:577–580`; related person metadata at `:555–559`.
- Category: Accessibility / readability.
- Evidence: rendered detector verifies 10px avatar initials and both statusbar items; source also specifies 10px chat time and person metadata.
- Impact: saved state, active tool and identity information require unnecessary visual effort at the default UI scale. This is a quality finding; WCAG does not specify an absolute text pixel floor. Avatar initials have a redundant name, lowering their standalone severity.
- Recommendation: raise functional metadata to at least 11–12px, retaining the compact layout and testing all supported UI scales. Suggested command: `$impeccable typeset`.

### [P2] Idle overlay performs continuous full-surface work

- Location: `packages/client/src/canvas/BoardCanvas.tsx:208–325`.
- Category: Performance.
- Evidence: `draw()` clears the complete DPR-scaled overlay, walks selection/presence and schedules another animation frame unconditionally. A static empty board still follows this loop; the animation is cancelled only on effect cleanup.
- Impact: avoidable CPU/GPU and battery work, especially at 4K/high DPR or with several clients. No measured frame loss or battery regression is claimed.
- Recommendation: invalidate on gesture, selection, presence and viewport changes; schedule timed invalidation for expiring presence, and animate only while necessary. Preserve transient previews and remote cursors. Suggested command: `$impeccable optimize`.

## Detector evidence and adjudication

- Source: `impeccable detect --json packages/client/src/app packages/client/src/components`, run once. Exit **0**, **0 findings**; raw `design/DETECTOR.json` is `[]`.
- Desktop: `impeccable detect --cdp 9222 --target Canvas --json`, against the built app with a separate `.runtime/audit/profile`. Exit **2**, **7 findings**: 3 `undersized-ui-text` warnings; 1 `cream-palette` warning; 1 `straggler` advisory; 2 `low-contrast` advisories. Raw JSON: `design/DETECTOR-CDP.json`; stdout/stderr: `design/DETECTOR-CDP.txt`.
- Microtext is verified. Cream palette is an intentional product palette, not an implementation defect. A single trailing word in the empty chat helper is a minor composition advisory, not a technical release issue.
- Contrast advisories report **4.4:1** for two canvas-underlay helper strings. Direct rendered token conversion and WCAG luminance calculation give muted-on-paper **6.46:1 light / 8.62:1 dark**, ink-on-surface **14.43:1 light / 14.12:1 dark** (`AUDIT-KEYBOARD.json`). The underlay advisories are therefore not confirmed token contrast failures; they use sampled canvas/alpha backgrounds. Do not promote them to proven WCAG violations. Dynamic image/canvas overlaps, identity colors and every focus-ring pair remain unmeasured.

## Scope notes and positive findings

- **Focus:** visible 2px focus tokens, labeled icon buttons, roving arrow-key tabs and modal containment/return logic are present. Prior `screens/e2e-result.json` records dialog Tab/Shift+Tab, Escape and focus return in both themes at 100/125/150%; this audit independently verified the Space/Enter failure above, not that entire matrix.
- **Responsive:** inspected `board-light-1100-1.5.png` and the prior screenshot/layout artifacts. A 1100px minimum native window is declared, so lack of mobile layout is not treated as a desktop defect. The screenshot shows wrapping and a usable canvas alongside the dock, with a large properties surface occupying part of the board. Earlier layout JSON reports no document overflow at 1100×650; this is prior-run evidence, not a fresh replay. Desktop zoom above 150%, operating-system text scaling, RTL and physically small screens remain untested.
- **Touch targets/gestures:** live swatches are 23×23px with 6px spacing; spacing can meet WCAG 2.5.8's exception, so size alone is not reported as an AA failure. Native range controls are also small and have a user-agent exception. Many controls remain below the 44px ergonomic target. Board and dock use pointer events and `touch-action:none`; pointer cancellation is handled. No synthesized or physical touch gesture was exercised.
- **Motion:** reduced-motion preference disables CSS transitions and the presentation viewport animation has an explicit immediate-state alternative. No flashing test performed.
- **Theming:** theme tokens update and text token contrast is measured in both modes after transitions settle. Hard-coded board handles, authored colors, identity badges and white thumbnails require separate context-specific review; user-authored colors must remain editable rather than being blindly replaced.
- **Electron security:** source retains context isolation, no Node integration, sandbox, permission denial, blocked new windows/navigation, bundled resources and restrictive CSP. No source/CSP/permission change made for audit. This is source inspection, not a security penetration test.
- **Networking/cleanup:** CDP was launched with `--remote-debugging-address=127.0.0.1`, port 9222, isolated profile and local offline board. No public server was started. The normal Connect screen invokes existing LAN discovery on mount; it was not used to connect to a room. All audit Electron instances closed in `finally`; no live-server or overlay was started. The initial restricted launch failed; elevated local launch succeeded. A first CDP helper invocation had Windows command quoting failure; corrected direct bundled-engine invocation succeeded. Temporary audit helper scripts were removed; retained audit profile and evidence artifacts are local.

## Recommended actions

1. `$impeccable harden`: contain canvas shortcuts and expose existing board objects to keyboard and assistive technology.
2. `$impeccable typeset`: increase functional metadata sizes without losing supported-scale layouts.
3. `$impeccable optimize`: invalidate the overlay on demand; measure idle and active behavior at minimum size and 4K.
4. `$impeccable polish`: check focus, identity contrast and controls after fixes; rerun the audit.

Questions skipped: user requested autonomous completion without questions.



