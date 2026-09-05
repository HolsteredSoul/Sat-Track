# Satellite Constellation Tracker

A real-time 3D view of Starlink, ISS, GPS, Galileo, OneWeb, Iridium, GLONASS, and BeiDou, with Earth day/night rendering, orbit paths, observer locations, and elevation-based pass predictions.

[Live site](https://holsteredsoul.github.io/Sat-Track/) · [CI](https://github.com/HolsteredSoul/Sat-Track/actions/workflows/ci.yml)

## Run locally

Use Node.js 24 LTS and npm:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, under `/Sat-Track/`. This application uses a module worker and npm dependencies, so it needs a local server; opening index.html directly is not supported.

```sh
npm run build
npm run preview
```

In GitHub repository Settings → Pages, set Source to **GitHub Actions**. Publishing raw files from the main branch can overwrite the Vite deployment and break module loading. The deployment workflow verifies the published HTML and JavaScript assets after publishing.

The production build is configured for the GitHub Pages `/Sat-Track/` path. For another host path, change `base` in vite.config.js. The high-resolution Earth texture follows that base path.

## Tracking and data

- Native CelesTrak JSON using OMM orbital elements supports catalogue IDs up to nine digits, including newly catalogued six-digit satellites. satellite.js 6.0.2 performs SGP4/SDP4 propagation.
- The **Orbital Telemetry** panel separates the clock source from live, saved, and simulated layer counts. Select a satellite to inspect its orbital epoch relative to the view time. A time gap over 72 hours is highlighted as a caution; it is not an accuracy estimate.
- **LIVE** means successfully downloaded orbital elements, not measured real-time positions. **LIVE · PARTIAL** means invalid records were skipped. **SAVED** means validated cached data. **SIM** means illustrative orbits that do not track actual satellites.
- Validated raw JSON is cached for two hours, following CelesTrak's update guidance. Existing TLE caches remain readable. Partial or invalid downloads never overwrite a known-good cache.
- Refresh preserves saved and in-memory data on network failure and reports full, partial, or failed updates. HTTP errors stop retries; the service's Retry-After is respected with at least a two-hour cooldown in the running session. Only transport failures receive one retry. Third-party CORS proxies are no longer used.
- Time-service failure falls back to the device clock. Pause/resume and speed changes preserve the current instant. **Reset to Now** returns to device time, unpauses, and restores 1x speed.
- New links select real satellites by catalogue ID, surviving list reordering. Older `sat=layer:index` links still open with bounds checks, but cannot guarantee the original identity after the catalogue changes.
- Offline recovery works when the application itself is available and has loaded. This is not an installable offline PWA: there is no service worker, and some textures and the map picker require the network.

Pass predictions currently indicate elevation above the observer's horizon. They do not guarantee optical or naked-eye visibility. Darkness and illumination filters are a separate planned feature.

## Controls

Drag to rotate, scroll or pinch to zoom, and click a satellite or search result to select it. The observer can be set by map, geolocation, or manual coordinates. Point size, theme, and observer preferences are saved locally.

| Key       | Action                       |
| --------- | ---------------------------- |
| H         | Toggle panel                 |
| ?         | Keyboard help                |
| Space / P | Pause or resume              |
| N         | Reset to Now                 |
| R         | Reset camera                 |
| C         | Cycle enabled constellations |
| F         | Focus selected satellite     |
| L         | Toggle labels                |
| T         | Toggle theme                 |
| E         | Export screenshot            |
| G         | Set observer location        |
| Esc       | Deselect / close help        |

Controls also include follow-camera mode, orbit paths, visibility highlighting, screenshot export, and share links. The sidebar initially collapses on narrow screens.

## Verification

```sh
npm run lint
npm run format:check
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Browser tests build and serve the production app at `/Sat-Track/`, using deterministic data and intercepted external requests. They exercise desktop and mobile layouts, selection, sharing, refresh failure, legacy caches, observer passes, layer controls, and worker fallback. They do not depend on CelesTrak being available.

If a managed browser download is unavailable, set `PLAYWRIGHT_CHANNEL=chrome` or `msedge` in your shell to use an installed browser with an isolated test profile. For example in PowerShell: `$env:PLAYWRIGHT_CHANNEL = 'chrome'`.

Numerical tests compare equivalent TLE/OMM fixtures, worker/main-thread results, and the independent Vallado satellite-5 reference at epoch. Synthetic six-digit fixtures test identity handling and must not be mistaken for current live data. See [UPDATE_PLAN.md](UPDATE_PLAN.md) for the implementation scope and validation record.

CI uses Node 24 and runs lint, formatting, unit/integration tests, a build, and Chromium browser tests. Deployment runs on pushes to main. This update does not itself authorize a deployment.

## Project structure

```text
index.html                      App shell, styles, and accessible status text
src/StarlinkTracker.js          Scene, controls, selection, and application integration
src/orbitalData.js              JSON/TLE validation, identity, network, and cache
src/trackingClock.js            Clock synchronization and simulation timing
src/core.js                    Pure orbital and coordinate helpers
src/constants.js               Rendering and application configuration
src/helpers.js                 Browser utilities and saved preferences
src/workers/propagator.worker.js  Background orbital propagation
tests/*.test.js                Unit and integration regression tests
tests/fixtures/                Deterministic orbital fixtures
tests/browser/                 Production-site browser smoke tests
public/textures/               Local high-resolution Earth texture
```

Three.js 0.172 supplies rendering. Leaflet 1.9.4 is loaded from a CDN for the optional map picker. Manual coordinates remain available when that picker cannot load. Preserve the documented Earth/scene coordinate convention when changing render code.

## Sources and limitations

- [CelesTrak orbital formats and usage guidance](https://celestrak.org/NORAD/documentation/gp-data-formats.php)
- [satellite.js](https://github.com/shashwatak/satellite-js)
- [Vallado SGP4 verification reference](https://celestrak.org/publications/AIAA/2006-6753/AIAA-2006-6753-Rev3.pdf)
- [Earth textures: three-globe](https://github.com/vasturiano/three-globe)
- [UTC service: WorldTimeAPI](https://worldtimeapi.org/)

Use a current browser with WebGL and module-worker support. A synchronous propagation fallback is provided when worker startup fails. Real-device iOS safe-area behaviour still needs manual confirmation. Very old orbital elements, satellite maneuvers, and large simulation-time offsets can reduce positional accuracy. The existing large JavaScript bundle warning remains a performance follow-up.

MIT License.
