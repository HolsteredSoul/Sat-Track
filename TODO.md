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

## Feature Enhancements

- [x] Add more satellite constellations — Iridium, GLONASS, BeiDou
- [x] Add ground station / observer location marker — geolocation + 3D marker
- [x] Add satellite pass prediction for a given location — 24h lookahead
- [x] Add export/share functionality — PNG screenshot export
- [x] Add keyboard shortcuts help overlay — `?` key to toggle
- [x] Add dark/light theme toggle — `T` key or button, persists in localStorage

## Code Quality

- [x] Add JSDoc type annotations for all public methods in `StarlinkTracker`
- [x] Extract hardcoded CDN URLs into a configuration section — `src/constants.js`
- [x] Add input validation for TLE data parsing — checksum + format validation
- [x] Improve error recovery in data loading — `retryWithBackoff()` helper
