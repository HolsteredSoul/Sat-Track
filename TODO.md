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
- [ ] **Fix keyboard shortcuts not firing as expected** — `H` and `?` lack the `!e.target.closest('input')` guard that `T`, `E`, and `G` have; pressing these while typing in the search box triggers unintended side-effects. `Escape` also fires unconditionally, which can disrupt text input UX.
- [ ] **Audit shortcut conflicts across browsers/OS** — `?` (Shift+/) and `G` may be intercepted by browser or IME on non-US keyboard layouts; add `e.code`-based fallbacks where needed.
- [ ] **Satellite pixel size too small in zoomed-out / high-DPI views** — `POINT_SIZE_DEFAULT` is a fixed `2.0` screen-space pixels with `sizeAttenuation: false`; on retina displays or when many constellations are visible simultaneously the dots are nearly invisible.

## Feature Enhancements

- [x] Add more satellite constellations — Iridium, GLONASS, BeiDou
- [x] Add ground station / observer location marker — geolocation + 3D marker
- [x] Add satellite pass prediction for a given location — 24h lookahead
- [x] Add export/share functionality — PNG screenshot export
- [x] Add keyboard shortcuts help overlay — `?` key to toggle
- [x] Add dark/light theme toggle — `T` key or button, persists in localStorage
- [ ] **Add satellite pixel size slider** — expose `POINT_SIZE_DEFAULT` (currently hardcoded `2.0`) as a UI range slider (e.g. 1–8 px) so users can adjust dot size to taste; update all active `PointsMaterial` instances reactively; persist the chosen value in `localStorage`; update keyboard overlay docs and README.
- [ ] **Add keyboard shortcut to pause / resume time** — `Space` bar or `P` to toggle `timeSpeed` between 0 and the last non-zero value; useful when comparing satellite positions.
- [ ] **Add keyboard shortcut to reset camera** — `R` to snap the camera back to the default distance and orientation so users can recover from disorienting zoom states.
- [ ] **Add keyboard shortcut to cycle active constellations** — `Tab` or `C` to step through enabled layers and jump to the next visible satellite, complementing the existing search box.

## Code Quality

- [x] Add JSDoc type annotations for all public methods in `StarlinkTracker`
- [x] Extract hardcoded CDN URLs into a configuration section — `src/constants.js`
- [x] Add input validation for TLE data parsing — checksum + format validation
- [x] Improve error recovery in data loading — `retryWithBackoff()` helper
- [ ] **Add unit tests for new slider + shortcut logic** — cover `pointSize` persistence, slider min/max clamping, and key-event guards introduced by the fixes above.
- [ ] **Update keyboard shortcuts overlay** — reflect any newly added or corrected shortcuts in the `#keyboard-overlay` HTML and the README shortcut table.
