# Sat-Track TODO

## Development Infrastructure

- [ ] Add a linter/formatter (e.g., ESLint + Prettier) for code consistency
- [ ] Add unit tests for core functions (orbital calculations, shadow detection, coordinate transforms)
- [ ] Set up CI/CD pipeline (GitHub Actions) for automated linting/testing
- [ ] Consider modularizing the single-file HTML app into separate JS modules with a build step

## Bug Fixes / Known Issues

- [ ] Improve CORS fallback handling — currently uses multiple proxy fallbacks for TLE fetching
- [ ] Address cached TLE data accuracy — stale cache (< 1 hour TTL) can show inaccurate positions
- [ ] Optimize mobile performance for large constellation counts (Starlink ~6000+ satellites)

## Feature Enhancements

- [ ] Add more satellite constellations (e.g., Iridium, GLONASS, BeiDou)
- [ ] Add ground station / observer location marker
- [ ] Add satellite pass prediction for a given location
- [ ] Add export/share functionality for current view
- [ ] Add keyboard shortcuts help overlay (beyond H and Esc)
- [ ] Add dark/light theme toggle for the UI panel

## Code Quality

- [ ] Add JSDoc type annotations for all public methods in `StarlinkTracker`
- [ ] Extract hardcoded CDN URLs into a configuration section
- [ ] Add input validation for TLE data parsing
- [ ] Improve error recovery in data loading (retry logic with backoff)
