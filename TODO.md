# Sat-Track TODO

## Development Infrastructure

- [x] Add a linter/formatter (ESLint + Prettier) — `.eslintrc.json`, `.prettierrc`
- [x] Add unit tests for core functions — `tests/core.test.js` (35 tests)
- [x] Set up CI/CD pipeline (GitHub Actions) — `.github/workflows/ci.yml`
- [x] Modularize the single-file HTML app into separate JS modules — `src/` directory

## Bug Fixes / Known Issues

- [x] Improve CORS fallback handling — retry with exponential backoff per proxy
- [x] Address cached TLE data accuracy — cache age display, stale warning threshold
- [x] Optimize mobile performance — reduced satellite caps, lower Hz, smaller star count
- [x] **Fix keyboard shortcuts not firing as expected** — consolidated guard: all shortcuts now check `inInput` at the top of the handler; `H` and `?` are fixed; `Escape` only resets selection when not in an input field.
- [x] **Audit shortcut conflicts across browsers/OS** — all shortcuts now use `e.code`-based fallbacks (e.g. `KeyH`, `Slash`+Shift for `?`) alongside `e.key` so they work on non-US keyboard layouts.
- [x] **Satellite pixel size too small in zoomed-out / high-DPI views** — `POINT_SIZE_DEFAULT` exposed as a user-adjustable UI slider (1–8 px, step 0.5); value persists to localStorage and updates all `PointsMaterial` instances reactively.

## Feature Enhancements

- [x] Add more satellite constellations — Iridium, GLONASS, BeiDou
- [x] Add ground station / observer location marker — geolocation + 3D marker
- [x] Add satellite pass prediction for a given location — 24h lookahead
- [x] Add export/share functionality — PNG screenshot export
- [x] Add keyboard shortcuts help overlay — `?` key to toggle
- [x] Add dark/light theme toggle — `T` key or button, persists in localStorage
- [x] **Add satellite pixel size slider** — `#pixelSizeSlider` (1–8 px, step 0.5) in the Simulation panel; drives `setPointSize()` which updates all `PointsMaterial` instances and persists to `localStorage`.
- [x] **Add keyboard shortcut to pause / resume time** — `P` (or `Space`) calls `togglePause()`; adjusts `simStartTime` on resume so the simulation continues seamlessly; on-screen PAUSED indicator shown.
- [x] **Add keyboard shortcut to reset camera** — `R` calls `resetCamera()` which restores the camera to `CAMERA_INITIAL_DISTANCE` and resets `controls.target` to origin.
- [x] **Add keyboard shortcut to cycle active constellations** — `C` calls `cycleConstellationLayer()` which advances through enabled layers and selects their first satellite.

## Code Quality

- [x] Add JSDoc type annotations for all public methods in `StarlinkTracker`
- [x] Extract hardcoded CDN URLs into a configuration section — `src/constants.js`
- [x] Add input validation for TLE data parsing — checksum + format validation
- [x] Improve error recovery in data loading — `retryWithBackoff()` helper
- [x] **Add unit tests for new slider + shortcut logic** — `clampPointSize()` extracted to `core.js` with 6 tests covering in-range, below-min, above-max, NaN, non-number, and fractional step values; all 41 tests pass.
- [x] **Update keyboard shortcuts overlay** — `#keyboard-overlay` updated with P, R, C entries; bottom hint bar updated to list all shortcuts; `src/index.html` reflects all new keys.
