# PROJECT_MEMORY — Sat-Track UI/Visual Polish

## Goal & current status

**Goal:** Polish the UI and visual utility of the mature Sat-Track tracker in two areas — (1) Earth model visuals in the Three.js scene, (2) mobile/phone UX — while preserving all existing functionality, performance, and architecture. No new features, no new backend, no new heavy deps.

**Status:** ✅ Implemented, integrated, and verified on branch `feat/ui-earth-mobile-polish`. CI-equivalent checks (lint, prettier, 50 tests, build) pass. Browser-verified on desktop (1280) and phone widths (375/360/340/320). Pending: PR review/merge.

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
