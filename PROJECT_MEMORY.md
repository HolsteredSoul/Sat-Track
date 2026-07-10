# PROJECT_MEMORY — Sat-Track UI/Visual Polish

## Goal & current status

**Goal:** Polish the UI and visual utility of the mature Sat-Track tracker in two areas — (1) Earth model visuals in the Three.js scene, (2) mobile/phone UX — while preserving all existing functionality, performance, and architecture. No new features, no new backend, no new heavy deps.

**Status:** Implemented on branch `feat/ui-polish-round-2` (includes round-1 polish + round-2 tuning + adversarial-review fixes). Automated gate: `npm run lint`, `npm test` (50), `npm run build` (local; PR CI currently runs lint + format:check + test only — not `build`). Visual/runtime items need real-device confirmation where noted below.

## Round 2 — deferred polish (branch `feat/ui-polish-round-2`)

Implemented. Addresses the two deferred follow-ups from round 1.

### A6 — Ocean sun-glint tuning (`src/StarlinkTracker.js`, `src/constants.js`)

The round-1 glint (`uSpecStrength 0.6`, power `60`) read too hot head-on. Lowered and made tunable:

- Constants: `EARTH_SPEC_STRENGTH: 0.35`, `EARTH_SPEC_POWER: 48`.
- `uSpecPower` uniform wired through `initialUniforms` + the fragment shader.
- Water-texture load callback sets `uSpecStrength = CONSTANTS.EARTH_SPEC_STRENGTH`; fail-soft starts at `0.0`.
- Frame invariant (`earthGroup.rotation.y = -π/2`), tint color, half-vector, and `mixVal` day-side gating all untouched by the tune.

### B7 — iOS range-slider thumb (`index.html` inline CSS)

Fully self-styled range controls so WebKit honors thumb size:

- Base `input[type="range"]`: `-webkit-appearance: none` + `appearance: none`; `:focus-visible` and `:disabled` rules.
- Track 6px pill; thumb 16px (WebKit `margin-top: -5px` = `-(16-6)/2`); coarse 24px thumb with `margin-top: -9px`.
- Colors via CSS vars (`--accent`, `--range-track-bg`, `--ui-border`, …) for light + dark.

## Round 3 — adversarial-review fixes

Fixes from multi-agent review of `feat/ui-polish-round-2`:

### Earth / shaders (`src/StarlinkTracker.js`, `src/constants.js`)

- Water mask treated as **data texture**: `_configureDataTexture` (no mips, no aniso) + `step(0.5, …)` hard ocean threshold — stops coastal land specular bleed.
- Fragment re-normalize of `N` / `V` before Blinn-Phong (and day/night `sunDot`).
- Atmosphere fresnel uses **world-space** view dir (matches sun / Earth shader; was view-space vs world-normal mix).
- Cloud drift: `EARTH_CLOUD_DRIFT_RAD_PER_SEC` (0.0012), frame-dt scaled, angle mod 2π; hitch clamp 0.1s.
- Water/cloud load: `isDisposed` guards + empty `onError` fail-soft; `cloudMesh` null in constructor and on `dispose()`.

### Mobile CSS (`index.html`)

- Thumb centering math aligned to **6px** track (`-5px` / `-9px`).
- Dead selector `#visible-scope-btn` → `#btn-visible-scope` (matches DOM/JS).
- Drawer safe-area: horizontal inset on `#ui-container`; `max-height` subtracts top+bottom safe-area.
- `.toggle-row:active` uses `--accent-wash` (was no-op same as default bg).
- Coarse targets: scope/manual `min-height: 48px`; hamburger 48×48; theme-aware `--accent-wash` / `--range-track-bg`.

## What changed (cumulative polish)

### Earth visuals (`src/StarlinkTracker.js`, `src/constants.js`)

- **Ocean sun-glint (A1):** Blinn-Phong specular over ocean mask (`earth-water.png`) inside the day/night fragment shader — no extra mesh/draw call. Uniforms `specularMap` + `uSpecStrength` (starts `0.0`, set to `EARTH_SPEC_STRENGTH` on successful load) + `uSpecPower`. Day-side only (× `mixVal`). Mask configured as data + hard threshold.
- **Cloud layer (A2):** Desktop-only (`if (!this.isMobile)`) `MeshLambertMaterial` sphere at radius ×1.01, child of `earthGroup`. Drift via `EARTH_CLOUD_DRIFT_RAD_PER_SEC`. Starts `visible:false`, revealed on load.
- **Atmosphere rim (A3):** Horizon gradient + fresnel in world space; AdditiveBlending/BackSide/depthWrite:false.
- **Exposure/light (A5):** `renderer.toneMappingExposure = 1.15`; DirectionalLight 2.2.
- **Skipped (A4):** bump/topology relief.

### Mobile UX (`index.html` inline CSS + meta)

- Touch density behind `(hover: none) and (pointer: coarse)`; safe-area on chrome + drawer; self-styled ranges; small-phone reflow; PWA meta (no manifest/SW).

## Key architecture / design decisions

- **Frame invariant (do not break):** Earth frame is coupled across `earthGroup.rotation.y = -π/2`, satellite ECI→scene transform, and `calculateSunDirection`'s `{x,z,-y}` remap (`core.js`). New Earth layers use standard `vUv` and parent to `earthGroup`.
- **Mobile gating:** touch density = CSS coarse pointer; cloud mesh = JS `isMobileDevice()` once at startup (predicates can diverge on tablets — intentional perf vs density split).
- **Textures:** `unpkg.com/three-globe/example/img/` CDN (same origin as day/night). Offline → glint stays off / clouds stay hidden (silent fail-soft).
- **Delivery:** worktree agents + adversarial multi-agent review + fix pass.

## Lessons / corrections

- Unloaded `MeshLambertMaterial` map flashes opaque white — hide until load.
- Headless preview reports `pointer: fine` — coarse rules need real devices or CSSOM checks.
- Specular/data masks must not share color mip/aniso settings with albedo textures.
- WebKit range thumb centering: margin must match **declared track height**, not a guessed 8px.
- CSS id selectors must match DOM ids (`btn-visible-scope` not `visible-scope-btn`).
- `npm run format:check` single-quoted globs misbehave on Windows; use double-quoted Prettier globs when judging locally.

## Known issues / risks / follow-ups

- **Real-device safe-area / notch:** static CSS uses `env(safe-area-inset-*, 0px)`; confirm on a notched iPhone (landscape + home indicator). Headless insets are 0.
- **iOS Safari range thumbs:** self-styled path is in code; still confirm vertical centering on a real device after the 6px-track margin fix.
- **CDN offline / unpkg outage:** water + clouds have no local `public/textures` fallback (unlike hi-res day). Fail-soft is silent (no toast).
- **Exposure stack:** toneMapping 1.15 + shader night boost + glint can still read hot head-on on some displays — tune `EARTH_SPEC_STRENGTH` / exposure if needed.
- **Cloud gate vs CSS coarse:** `isMobileDevice()` ≠ `(pointer: coarse)`; large tablets may get desktop clouds + coarse UI.
- **No automated visual regression:** unit tests cover `core.js` only; PR CI does not run `npm run build` (deploy workflow does on `main`).
- **A11y:** pre-existing `user-scalable=no` remains.
- Pre-existing: lockfile npm-audit noise; >500 kB JS chunk-size build warning.

## Verification checklist

### Automated (local)

- [ ] `npm run lint`
- [ ] `npm test` (50)
- [ ] `npm run build`
- [ ] (optional) `npx prettier --check "src/**/*.js" "tests/**/*.js" "index.html" "vite.config.js"`

### Manual / device

- [ ] Earth: clouds (desktop), absent on mobile JS gate; ocean glint day-side only & view-dependent; no coastal land glint; atmosphere rim OK
- [ ] Frame intact: terminator, sats, day/night after rotation
- [ ] Texture load: water + clouds from CDN; kill network → glint off, clouds stay hidden (no white flash)
- [ ] Mobile: no horizontal overflow 375/360/340/320; reflow 4→3→2; drawer + safe-area on notched device
- [ ] Range thumbs centered on track (iOS Safari + desktop WebKit/Firefox)
- [ ] Scope chip (`#btn-visible-scope`) gets coarse touch sizing; toggle-row press feedback visible

## Delegated-agent work summary

- Round 1: Earth + Mobile worktrees, QA, cloud white-flash fix.
- Round 2: A6 glint tune + B7 iOS range self-style.
- Round 3: Adversarial multi-agent review (shaders / CSS / frame / docs) + fix pass for land-bleed, thumb math, dead selector, safe-area, dispose guards, dt cloud drift, doc honesty.
