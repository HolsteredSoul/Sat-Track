# Pages deployment correction — 2026-09-05

After pushing the accuracy release, the public site served unbuilt `src/main.js`. Root cause: repository Pages `build_type` was still `legacy` (main branch root), causing a second deployment to overwrite the Vite artifact. Changed the repository Pages source to `workflow` (GitHub Actions) and redeployed main. Added `.github/scripts/check-pages.mjs` to the deployment workflow: it verifies the public HTML references the expected built entry point and that the JavaScript asset is available, with bounded retries for CDN propagation. Keep Pages source set to GitHub Actions.

---

# Accuracy update — 2026-09-05

The accuracy release is implemented on `codex/orbital-data-accuracy`, based on polish commit `586582b`. See UPDATE_PLAN.md for decisions, verification evidence, and limitations; README.md now describes the current architecture and commands. Historical polish notes follow below.

Key changes: satellite.js 6.0.2 native JSON/OMM ingestion; versioned raw caches with legacy TLE recovery; catalogue-ID links and refresh selection; cancellable fetching with provider cooldown; a monotonic simulation clock with device-time fallback; generation-tagged worker results; and an Orbital Telemetry panel. Shader equations and scene-coordinate conventions are preserved. UI fixes cover search click propagation, mobile drawer sizing, and tooltip placement.

Local gates: 88 unit/integration tests and 8 desktop/mobile browser scenarios passed, with build/lint/format checks. Live data verification accepted 11,086 Starlink records, including 365 six-digit IDs. Browser screenshots use stub textures; physical iOS checks remain pending. No deployment performed.

---

# PROJECT_MEMORY â€” Sat-Track UI/Visual Polish

## Goal & current status

**Goal:** Polish the UI and visual utility of the mature Sat-Track tracker in two areas â€” (1) Earth model visuals in the Three.js scene, (2) mobile/phone UX â€” while preserving all existing functionality, performance, and architecture. No new features, no new backend, no new heavy deps.

**Status:** Implemented on branch `feat/ui-polish-round-2` (includes round-1 polish + round-2 tuning + adversarial-review fixes). Automated gate: `npm run lint`, `npm test` (50), `npm run build` (local; PR CI currently runs lint + format:check + test only â€” not `build`). Visual/runtime items need real-device confirmation where noted below.

## Round 2 â€” deferred polish (branch `feat/ui-polish-round-2`)

Implemented. Addresses the two deferred follow-ups from round 1.

### A6 â€” Ocean sun-glint tuning (`src/StarlinkTracker.js`, `src/constants.js`)

The round-1 glint (`uSpecStrength 0.6`, power `60`) read too hot head-on. Lowered and made tunable:

- Constants: `EARTH_SPEC_STRENGTH: 0.35`, `EARTH_SPEC_POWER: 48`.
- `uSpecPower` uniform wired through `initialUniforms` + the fragment shader.
- Water-texture load callback sets `uSpecStrength = CONSTANTS.EARTH_SPEC_STRENGTH`; fail-soft starts at `0.0`.
- Frame invariant (`earthGroup.rotation.y = -Ï€/2`), tint color, half-vector, and `mixVal` day-side gating all untouched by the tune.

### B7 â€” iOS range-slider thumb (`index.html` inline CSS)

Fully self-styled range controls so WebKit honors thumb size:

- Base `input[type="range"]`: `-webkit-appearance: none` + `appearance: none`; `:focus-visible` and `:disabled` rules.
- Track 6px pill; thumb 16px (WebKit `margin-top: -5px` = `-(16-6)/2`); coarse 24px thumb with `margin-top: -9px`.
- Colors via CSS vars (`--accent`, `--range-track-bg`, `--ui-border`, â€¦) for light + dark.

## Round 3 â€” adversarial-review fixes

Fixes from multi-agent review of `feat/ui-polish-round-2`:

### Earth / shaders (`src/StarlinkTracker.js`, `src/constants.js`)

- Water mask treated as **data texture**: `_configureDataTexture` (no mips, no aniso) + `step(0.5, â€¦)` hard ocean threshold â€” stops coastal land specular bleed.
- Fragment re-normalize of `N` / `V` before Blinn-Phong (and day/night `sunDot`).
- Atmosphere fresnel uses **world-space** view dir (matches sun / Earth shader; was view-space vs world-normal mix).
- Cloud drift: `EARTH_CLOUD_DRIFT_RAD_PER_SEC` (0.0012), frame-dt scaled, angle mod 2Ï€; hitch clamp 0.1s.
- Water/cloud load: `isDisposed` guards + empty `onError` fail-soft; `cloudMesh` null in constructor and on `dispose()`.

### Mobile CSS (`index.html`)

- Thumb centering math aligned to **6px** track (`-5px` / `-9px`).
- Dead selector `#visible-scope-btn` â†’ `#btn-visible-scope` (matches DOM/JS).
- Drawer safe-area: horizontal inset on `#ui-container`; `max-height` subtracts top+bottom safe-area.
- `.toggle-row:active` uses `--accent-wash` (was no-op same as default bg).
- Coarse targets: scope/manual `min-height: 48px`; hamburger 48Ã—48; theme-aware `--accent-wash` / `--range-track-bg`.

## What changed (cumulative polish)

### Earth visuals (`src/StarlinkTracker.js`, `src/constants.js`)

- **Ocean sun-glint (A1):** Blinn-Phong specular over ocean mask (`earth-water.png`) inside the day/night fragment shader â€” no extra mesh/draw call. Uniforms `specularMap` + `uSpecStrength` (starts `0.0`, set to `EARTH_SPEC_STRENGTH` on successful load) + `uSpecPower`. Day-side only (Ã— `mixVal`). Mask configured as data + hard threshold.
- **Cloud layer (A2):** Desktop-only (`if (!this.isMobile)`) `MeshLambertMaterial` sphere at radius Ã—1.01, child of `earthGroup`. Drift via `EARTH_CLOUD_DRIFT_RAD_PER_SEC`. Starts `visible:false`, revealed on load.
- **Atmosphere rim (A3):** Horizon gradient + fresnel in world space; AdditiveBlending/BackSide/depthWrite:false.
- **Exposure/light (A5):** `renderer.toneMappingExposure = 1.15`; DirectionalLight 2.2.
- **Skipped (A4):** bump/topology relief.

### Mobile UX (`index.html` inline CSS + meta)

- Touch density behind `(hover: none) and (pointer: coarse)`; safe-area on chrome + drawer; self-styled ranges; small-phone reflow; PWA meta (no manifest/SW).

## Key architecture / design decisions

- **Frame invariant (do not break):** Earth frame is coupled across `earthGroup.rotation.y = -Ï€/2`, satellite ECIâ†’scene transform, and `calculateSunDirection`'s `{x,z,-y}` remap (`core.js`). New Earth layers use standard `vUv` and parent to `earthGroup`.
- **Mobile gating:** touch density = CSS coarse pointer; cloud mesh = JS `isMobileDevice()` once at startup (predicates can diverge on tablets â€” intentional perf vs density split).
- **Textures:** `unpkg.com/three-globe/example/img/` CDN (same origin as day/night). Offline â†’ glint stays off / clouds stay hidden (silent fail-soft).
- **Delivery:** worktree agents + adversarial multi-agent review + fix pass.

## Lessons / corrections

- Unloaded `MeshLambertMaterial` map flashes opaque white â€” hide until load.
- Headless preview reports `pointer: fine` â€” coarse rules need real devices or CSSOM checks.
- Specular/data masks must not share color mip/aniso settings with albedo textures.
- WebKit range thumb centering: margin must match **declared track height**, not a guessed 8px.
- CSS id selectors must match DOM ids (`btn-visible-scope` not `visible-scope-btn`).
- `npm run format:check` single-quoted globs misbehave on Windows; use double-quoted Prettier globs when judging locally.

## Known issues / risks / follow-ups

- **Real-device safe-area / notch:** static CSS uses `env(safe-area-inset-*, 0px)`; confirm on a notched iPhone (landscape + home indicator). Headless insets are 0.
- **iOS Safari range thumbs:** self-styled path is in code; still confirm vertical centering on a real device after the 6px-track margin fix.
- **CDN offline / unpkg outage:** water + clouds have no local `public/textures` fallback (unlike hi-res day). Fail-soft is silent (no toast).
- **Exposure stack:** toneMapping 1.15 + shader night boost + glint can still read hot head-on on some displays â€” tune `EARTH_SPEC_STRENGTH` / exposure if needed.
- **Cloud gate vs CSS coarse:** `isMobileDevice()` â‰  `(pointer: coarse)`; large tablets may get desktop clouds + coarse UI.
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
- [ ] Texture load: water + clouds from CDN; kill network â†’ glint off, clouds stay hidden (no white flash)
- [ ] Mobile: no horizontal overflow 375/360/340/320; reflow 4â†’3â†’2; drawer + safe-area on notched device
- [ ] Range thumbs centered on track (iOS Safari + desktop WebKit/Firefox)
- [ ] Scope chip (`#btn-visible-scope`) gets coarse touch sizing; toggle-row press feedback visible

## Delegated-agent work summary

- Round 1: Earth + Mobile worktrees, QA, cloud white-flash fix.
- Round 2: A6 glint tune + B7 iOS range self-style.
- Round 3: Adversarial multi-agent review (shaders / CSS / frame / docs) + fix pass for land-bleed, thumb math, dead selector, safe-area, dispose guards, dt cloud drift, doc honesty.
