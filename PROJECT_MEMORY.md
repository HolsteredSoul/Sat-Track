# PROJECT_MEMORY — Sat-Track UI/Visual Polish

## Goal & current status

**Goal:** Polish the UI and visual utility of the mature Sat-Track tracker in two areas — (1) Earth model visuals in the Three.js scene, (2) mobile/phone UX — while preserving all existing functionality, performance, and architecture. No new features, no new backend, no new heavy deps.

**Status:** ✅ Implemented, integrated, and verified on branch `feat/ui-earth-mobile-polish`. CI-equivalent checks (lint, prettier, 50 tests, build) pass. Browser-verified on desktop (1280) and phone widths (375/360/340/320). Pending: PR review/merge.

## Round 2 — deferred polish (branch `feat/ui-polish-round-2`)

✅ Implemented, integrated, and verified. CI-equivalent checks (lint, 50 tests, build) pass on the merged branch. Addresses the two deferred follow-ups from round 1.

### A6 — Ocean sun-glint tuning (`src/StarlinkTracker.js`, `src/constants.js`)

The round-1 glint (`uSpecStrength 0.6`, power `60`) read too hot head-on. Lowered and made tunable:

- New constants in `src/constants.js`: `EARTH_SPEC_STRENGTH: 0.35`, `EARTH_SPEC_POWER: 48`.
- New `uSpecPower` uniform wired through `initialUniforms` + the fragment shader; the hardcoded `60.0` exponent is now `uSpecPower`.
- The water-texture load callback sets `uSpecStrength = CONSTANTS.EARTH_SPEC_STRENGTH` (was `0.6`); fail-soft unchanged (still starts `0.0`).
- Frame invariant (`earthGroup.rotation.y = -π/2`), tint color, half-vector, and `mixVal` day-side gating all untouched.

### B7 — iOS range-slider thumb (`index.html` inline CSS)

The round-1 coarse-pointer `::-webkit-slider-thumb { width/height }` was a no-op on iOS Safari because the base `input[type="range"]` lacked `-webkit-appearance: none`. Fully self-styled the control:

- Base `input[type="range"]`: `-webkit-appearance: none` + `appearance: none`; removed the now-no-op `accent-color`; added `:focus-visible` (accent outline) and `:disabled` (50% opacity) rules.
- Styled `::-webkit-slider-runnable-track` / `::-moz-range-track` (6px pill, var-themed) and `::-webkit-slider-thumb` / `::-moz-range-thumb` (16px accent circle). WebKit thumb `margin-top: -4px` (centers 16px thumb on 8px track; math commented inline).
- Coarse-pointer block: thumb bumped to 24px with `margin-top: -8px` (24px on 8px track; math commented). Mozilla thumb needs no margin-top (auto-centers). Coarse block still gated inside `@media (hover: none) and (pointer: coarse)` — desktop untouched.
- All colors via CSS vars (`--accent`, `--ui-item-bg`, `--ui-border`, `--ui-item-border`) → both dark and light themes render correctly. All 4 sliders (`growthSlider`, `timeSpeed`, `pixelSizeSlider`, `min-el-slider`) restyled uniformly.

### Round-2 verification

- [x] Frame intact; fail-soft preserved (uSpecStrength starts 0.0); `uSpecPower` declared + used; no new deps/textures/meshes.
- [x] Coarse gating preserved; no horizontal overflow (slider widths unchanged); light+dark theme-agnostic via vars.
- [x] `npm run lint`, `npm test` (50 pass), `npm run build` all green on `feat/ui-polish-round-2`. Prettier: committed blobs are LF-clean (CI runs on ubuntu-latest; local Windows `autocrlf=true` flags CRLF in the working tree only — not a real violation).
- [x] Pre-existing >500 kB chunk-size build warning unchanged (not introduced here).

### Round-2 delivery

Worktree-isolated parallel code agents (one per workstream) + orchestrator-run adversarial QA review (subagent QA returned empty, so the orchestrator performed the full checklist directly), then `--no-ff` merge of both worktree branches, full CI gate, and worktree/branch pruning. Commits: `ed4a537` (Earth), `ac8fcf3` (Mobile), merges `f5b1a19` + `db3d8fa`.

## What changed

### Earth visuals (`src/StarlinkTracker.js`, `src/constants.js`)

- **Ocean sun-glint (A1):** Blinn-Phong specular over an ocean mask (`earth-water.png`) added _inside the existing day/night fragment shader_ — no extra mesh/draw call. New uniforms `specularMap` + `uSpecStrength` (starts `0.0`, set to `0.6` only in the texture load callback → fail-soft if the PNG never loads). New `vViewDir` varying. Day-side only (× `mixVal`). Verified view-dependent (hotspot at the sub-solar point, vanishes off-axis).
- **Cloud layer (A2):** Desktop-only (`if (!this.isMobile)`) `MeshLambertMaterial` sphere at radius ×1.01, lit by the existing `sunLight` so it darkens on the night side automatically. **Child of `this.earthGroup`** (inherits the −90° frame rotation). Slow drift in `animate()` (`rotation.y += 0.00002`). Starts `visible:false`, revealed in the load callback to avoid a white-flash on slow networks.
- **Atmosphere rim (A3):** Shader-only horizon gradient (deep blue → pale) + softer fresnel; kept AdditiveBlending/BackSide/depthWrite:false.
- **Exposure/light (A5):** `renderer.toneMappingExposure = 1.15`; DirectionalLight intensity 2.5 → 2.2.
- **Skipped (A4):** bump/topology relief — invisible at globe distance, would force abandoning the custom day/night shader.

### Mobile UX (`index.html` inline CSS + meta — no JS changes)

- **Touch targets + `:active` (B2/B4):** new `@media (hover: none) and (pointer: coarse)` block — ≥48px targets for `.action-btn`/`.toggle-row`/`.search-item`, larger checkboxes/range thumbs, `:active` feedback, `-webkit-tap-highlight-color: transparent`.
- **Safe-area (B3):** `viewport-fit=cover` + `env(safe-area-inset-*, 0px)` on `#ui-toggle`/`#controls`/`#ui-container`.
- **Drawer polish (B1):** `overscroll-behavior: contain`; `max-height: 70vh` then `calc(100dvh - 90px)` (URL-bar-safe).
- **Small-phone reflow (B5):** `.btn-group` 4→3 cols at ≤480px, →2 cols at ≤340px (+ panel width at ≤340px).
- **PWA meta (B6):** `theme-color`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`. No manifest/SW (deferred — SW caching would entangle the CelesTrak/CDN fetch logic).

## Key architecture / design decisions

- **Frame invariant (do not break):** the Earth coordinate frame is coupled across `earthGroup.rotation.y = -π/2`, the satellite ECI→scene transform, and `calculateSunDirection`'s `{x,z,-y}` remap (`core.js`). All new Earth layers use standard `vUv` and parent to `earthGroup`, so geography/terminator/satellite alignment is provably unchanged — none of those three were touched.
- **Mobile gating:** touch _density_ is gated behind `(hover:none) and (pointer:coarse)` (never matches a mouse → desktop untouched); _layout_ reflow uses `max-width` queries; safe-area uses `0px` fallbacks. The desktop 340px card and all hover/keyboard/mouse behavior are unchanged.
- **New textures reuse the existing `unpkg.com/three-globe/example/img/` CDN** — no new npm deps; consistent CORS/fail-soft surface with the existing day/night textures.
- **Delivery via worktree-isolated parallel agents + a QA gate** (see below).

## Lessons / corrections

- A `MeshLambertMaterial` whose `map`/`alphaMap` point at a not-yet-loaded texture renders as an **opaque white sphere** until load — start it hidden and reveal on load. (Caught by QA, fixed in commit `bc599a0`.)
- The headless browser preview reports `pointer: fine` / `hover: hover`, so `(hover:none) and (pointer:coarse)` rules are **not active under simple viewport resize**. Verified them instead via CSSOM (rules parsed cleanly) + adversarial QA; they apply on real touch devices.
- `npm run format:check`'s single-quoted globs misbehave on Windows/Git-Bash (spurious "no files" lines); use double-quoted `npx prettier --check "src/**/*.js" ...` to judge true compliance.

## Known issues / risks / follow-ups

- **iOS slider thumb:** the base `input[type="range"]` lacks `-webkit-appearance: none`, so the coarse-pointer `::-webkit-slider-thumb { width/height }` is a no-op on iOS Safari (the `height: 28px` row still enlarges the touch target). Adding `-webkit-appearance: none` requires fully styling the track to avoid an unstyled native look — deferred follow-up, not a blocker.
- **Sun-glint intensity** (`uSpecStrength 0.6`, power 60) reads bright head-on; physically plausible sun-glitter but tunable if it feels strong.
- **Safe-area / notch** padding can't be visually confirmed in the headless preview (insets resolve to 0); fallback correctness verified statically. Confirm on a real notched device.
- Pre-existing (not introduced here): 24 npm-audit advisories in the lockfile; the >500 kB JS bundle chunk-size build warning.

## Verification checklist

- [x] Earth: clouds render (desktop), absent on mobile gate; ocean glint day-side only & view-dependent; atmosphere rim blue→pale; brighter exposure.
- [x] Frame intact: terminator on correct hemisphere, satellites aligned, day/night correct after rotation.
- [x] No shader-compile / texture-404 / CORS errors in console; `earth-water.png` + `earth-clouds.png` load in-app.
- [x] Mobile: no horizontal overflow at 375/360/340/320; grid reflows 4→3 (≤480) →2 (≤340); drawer toggle (hamburger) still works; coarse + dvh + 8× safe-area rules parsed in CSSOM.
- [x] Desktop unchanged at 1280: 340px card, 4-col grid, base button padding/min-height (coarse rules NOT applied).
- [x] `npx prettier --check`, `npm run lint`, `npm test` (50 pass), `npm run build` all green.

## Delegated-agent work summary

- **Earth code agent** (worktree): implemented A1/A2/A3/A5 in `StarlinkTracker.js` + `constants.js`; self-validated lint/format/test/build.
- **Mobile code agent** (worktree): implemented B1–B6 in `index.html`; self-validated build.
- **QA agents** (one per workstream, adversarial, read-only): both returned PASS with evidence; the Earth QA surfaced the cloud white-flash (fixed) and the mobile QA surfaced the iOS slider-thumb note (deferred).
- **Orchestrator:** merged both QA-passed worktrees onto the feature branch, applied the cloud-flash fix, ran the integrated browser + CI verification, pruned the worktrees, authored this memory.
