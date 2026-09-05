# Sat-Track TODO

## Development Infrastructure

- [x] Add a linter/formatter (ESLint + Prettier) â€” `.eslintrc.json`, `.prettierrc`
- [x] Add unit tests for core functions â€” `tests/core.test.js` (35 tests)
- [x] Set up CI/CD pipeline (GitHub Actions) â€” `.github/workflows/ci.yml`
- [x] Modularize the single-file HTML app into separate JS modules â€” `src/` directory

## Bug Fixes / Known Issues

- [x] Improve CORS fallback handling â€” retry with exponential backoff per proxy
- [x] Address cached TLE data accuracy â€” cache age display, stale warning threshold
- [x] Optimize mobile performance â€” reduced satellite caps, lower Hz, smaller star count
- [x] **Fix keyboard shortcuts not firing as expected** â€” consolidated guard: all shortcuts now check `inInput` at the top of the handler; `H` and `?` are fixed; `Escape` only resets selection when not in an input field.
- [x] **Audit shortcut conflicts across browsers/OS** â€” all shortcuts now use `e.code`-based fallbacks (e.g. `KeyH`, `Slash`+Shift for `?`) alongside `e.key` so they work on non-US keyboard layouts.
- [x] **Satellite pixel size too small in zoomed-out / high-DPI views** â€” `POINT_SIZE_DEFAULT` exposed as a user-adjustable UI slider (1â€“8 px, step 0.5); value persists to localStorage and updates all `PointsMaterial` instances reactively.

## Feature Enhancements

- [x] Add more satellite constellations â€” Iridium, GLONASS, BeiDou
- [x] Add ground station / observer location marker â€” geolocation + 3D marker
- [x] Add satellite pass prediction for a given location â€” 24h lookahead
- [x] Add export/share functionality â€” PNG screenshot export
- [x] Add keyboard shortcuts help overlay â€” `?` key to toggle
- [x] Add dark/light theme toggle â€” `T` key or button, persists in localStorage
- [x] **Add satellite pixel size slider** â€” `#pixelSizeSlider` (1â€“8 px, step 0.5) in the Simulation panel; drives `setPointSize()` which updates all `PointsMaterial` instances and persists to `localStorage`.
- [x] **Add keyboard shortcut to pause / resume time** â€” `P` (or `Space`) calls `togglePause()`; adjusts `simStartTime` on resume so the simulation continues seamlessly; on-screen PAUSED indicator shown.
- [x] **Add keyboard shortcut to reset camera** â€” `R` calls `resetCamera()` which restores the camera to `CAMERA_INITIAL_DISTANCE` and resets `controls.target` to origin.
- [x] **Add keyboard shortcut to cycle active constellations** â€” `C` calls `cycleConstellationLayer()` which advances through enabled layers and selects their first satellite.

## Code Quality

- [x] Add JSDoc type annotations for all public methods in `StarlinkTracker`
- [x] Extract hardcoded CDN URLs into a configuration section â€” `src/constants.js`
- [x] Add input validation for TLE data parsing â€” checksum + format validation
- [x] Improve error recovery in data loading â€” `retryWithBackoff()` helper
- [x] **Add unit tests for new slider + shortcut logic** â€” `clampPointSize()` extracted to `core.js` with 6 tests covering in-range, below-min, above-max, NaN, non-number, and fractional step values; all 41 tests pass.
- [x] **Update keyboard shortcuts overlay** â€” `#keyboard-overlay` updated with P, R, C entries; bottom hint bar updated to list all shortcuts; `src/index.html` reflects all new keys.

## Accuracy maintenance — September 2026

- [x] Native JSON/OMM ingestion and six-digit catalogue support.
- [x] Preserve validated caches during failed or partial refresh.
- [x] Stable catalogue-ID sharing and selection through refresh.
- [x] Device-time fallback, continuous speed changes, pause/resume and Reset to Now.
- [x] Worker generation checks, simulation epoch preservation, and fallback parity tests.
- [x] Orbital Telemetry panel and selected-epoch age display.
- [x] Node 24 CI, production builds and fixture-driven desktop/mobile browser tests.
- [x] Live six-digit data check and independent numerical reference verification.
- [ ] Physical iOS/notch verification; browser emulation does not establish this.
- [ ] Separate observing-feature release: optical filters, tonight's passes and sky chart.
- [ ] Separate dependency-advisory and bundle-performance maintenance review.
