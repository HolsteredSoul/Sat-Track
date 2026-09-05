# Sat-Track accuracy and maintenance update

Prepared 2026-09-05. Implemented on `codex/orbital-data-accuracy`; local verification is recorded below. The original plan is retained as design history.

## Reassessment after publishing the polish fixes

- PR #51, **Polish Earth visuals + mobile UX**, is the only open PR found in the repository. Its head branch `feat/ui-earth-mobile-polish` was fast-forwarded from `dd4eca2` to `586582b` on 2026-09-05, bringing in all six follow-up commits. Both GitHub CI jobs (Node 18 and 20) passed for that head. It remains open and mergeable; it has not been merged or deployed.
- The same fixes were already published on `feat/ui-polish-round-2`. The push consolidated them into the existing PR instead of creating a competing polish PR.
- `main` remains at `1580cf4`. Begin accuracy work on a new `codex/` branch from `586582b`, preserving the complete polish baseline. Until #51 merges, any accuracy PR should target the polish branch to show only accuracy changes. If #51 is squash-merged, transplant only the new accuracy commits onto updated main before retargeting.
- Keep the release priorities: native JSON/OMM ingestion, correct clock behaviour, then build and browser checks. Treat the findings below as required parts of those changes, not a new feature expansion.
- `refreshData()` deletes existing caches before attempting the network and reports success unconditionally. Replace this with a forced network refresh that preserves known-good caches and reports full, partial, or failed refresh accurately.
- Share links currently encode `layer:index`. New links must use a stable catalogue ID; continue reading old index links with bounds checks. Old links cannot be guaranteed to identify the original satellite after catalogue reordering because they never stored its identity.
- Distinguish payload validation from intentional layer filtering. The ISS layer should select catalogue ID 25544 instead of matching names containing ISS, and a simulated fallback must never receive a LIVE badge.
- Resolve the partial-payload cache policy explicitly: valid rows may render with a warning, but an incomplete response must not replace an existing known-good cache. Cache fully validated responses atomically; preserve source and epoch metadata on all fallback paths.
- Guard against worker results arriving after a refresh or time reset. Associate messages with a data/time generation so obsolete results cannot overwrite newer meshes, selection, or the current clock. Preserve simulated-orbit epochs when reconstructing objects in the worker.

PR: https://github.com/HolsteredSoul/Sat-Track/pull/51

## Objective and scope

Restore complete current satellite-data ingestion and reliable current-time tracking, with regression coverage and repeatable build checks. Preserve existing Earth visuals, controls, constellations, observer settings, and offline simulation.

Deliver in separate reviewable changes. Defer new observing features and broad rendering refactors until the accuracy release is verified. Do not deploy as part of implementing this plan.

## Reviewed baseline

- Local HEAD: `586582b`, dated 2026-07-10.
- `npm test`: 50 tests pass. `npm run lint` and `npm run build` pass.
- Build emits an approximately 603 kB main JavaScript chunk warning; it is not a build failure.
- Browser behaviour and real mobile devices have not yet been verified.
- Main application: `src/StarlinkTracker.js`; propagation worker: `src/workers/propagator.worker.js`; pure helpers: `src/core.js`; configuration: `src/constants.js`.
- Dependencies declare satellite.js 4.x and Three.js 0.172.x. Choose exact upgrade versions after checking current official compatibility guidance.

## 1. Confirm the migration design

Read repository instructions and PROJECT_MEMORY.md, inspect the current branch and working changes, and reproduce baseline checks before editing.

- Inspect all consumers of satellite records: parsing, caching, worker initialization, selection, sharing, pass prediction, and refresh.
- Verify official satellite.js JSON/OMM ingestion support, return values, propagation errors, and worker serialization in the selected release. Upgrade only dependencies needed for this release.
- Define a small data-ingestion module that normalizes identity, display name, epoch, source metadata, and propagation records.
- Prefer native CelesTrak JSON/OMM input. Do not convert six-digit IDs back to fixed-width TLE text.
- Preserve the Earth/scene coordinate conventions documented in PROJECT_MEMORY.md.

Acceptance: document the chosen library version, cache schema, compatibility decisions, and files affected before implementing the migration.

## 2. Add fixtures and migrate orbital-data loading

Current JSON fallback looks for `TLE_LINE1` and `TLE_LINE2`, while CelesTrak JSON supplies OMM element fields. Native JSON loading must replace that assumption.

- Add deterministic fixtures for a five-digit object represented in both formats, a six-digit object, malformed input, and an empty response.
- Validate required fields and finite values; handle individual invalid objects without discarding valid objects. Treat an entirely invalid response as a load failure.
- Keep catalogue identity intact through selection, refresh, worker processing, and share links wherever identity is used.
- Version cached payloads and explicitly support reading or migrating existing TLE caches. Validate before storing a successful result.
- Preserve stale-cache recovery on fetch failure, clearly label simulations, and distinguish downloaded-at time from orbital epoch.
- Keep retries bounded; cancel outstanding network work when the overall request expires or the tracker is disposed. Respect provider retry guidance.

Acceptance tests:

- Six-digit catalogue IDs load and produce finite positions.
- Equivalent TLE and OMM fixtures produce matching positions at fixed times within a documented numerical tolerance justified by fixture precision.
- Main-thread and worker propagation agree for the same record and timestamp.
- Malformed data, partial failures, offline startup, old caches, and refresh failure have explicit tested outcomes.
- No partially invalid or empty payload overwrites a known-good cache.

## 3. Correct clock fallback and freshness reporting

`initTimeSync()` currently uses the primary satellite epoch when the external time request fails. Orbital epoch is not current UTC.

- Use device time when time synchronization fails; validate successful API timestamps before accepting them.
- Keep simulation time, clock source, orbital-data epoch, and cache-download time distinct.
- Preserve pause/resume, speed changes, Reset to Now, and intentional shared-link timestamps. Inspect initialization ordering so synchronization does not overwrite an intentional historical view.
- Show age relative to the relevant simulation time and explain stale orbital data without presenting a numerical accuracy guarantee.

Acceptance tests: time-service rejection, timeout, malformed response, valid response, stale orbital data, pause/resume, Reset to Now, and shared historical time. Use fixed clocks so failures are reproducible.

## 4. Strengthen build and integration checks

- Move CI and deployment to a supported Node LTS compatible with the chosen dependencies; use the same major version in both.
- Run the production build in PR CI as well as lint, formatting, and tests.
- Fix npm formatting-glob quoting for Windows compatibility.
- Add a small browser smoke suite using controlled fixtures: startup, satellite selection, layer toggles, observer setting, pass prediction, refresh, and offline fallback.
- Check the built site under the `/Sat-Track/` deployment path, including worker and texture URLs.
- Update README setup commands, dependency information, architecture, data-format description, and test information.

Acceptance: clean dependency installation and required checks pass on supported tooling. Browser tests do not depend on public services being available.

## 5. Verify the release candidate

- Check desktop and mobile layouts, time controls, Earth orientation, orbit paths, satellite picking, observer marker, and existing share links.
- Perform a limited live-data smoke check separately from deterministic tests; report provider/network failures accurately.
- Inspect a six-digit object and confirm it is live data rather than a simulation fallback.
- Compare a known satellite at a fixed epoch against a trusted reference with documented provenance and tolerance.
- Exercise worker failure and confirm synchronous fallback continues to render correct positions.
- Review the final diff for unintended visual, coordinate, dependency, and deployment changes.
- Report automated results, manual checks, and any unverified real-device behaviour separately.

Definition of done: all acceptance tests pass, live data compatibility is demonstrated where network access permits, documentation is current, and remaining limitations are explicit. A build passing alone is insufficient evidence of orbital accuracy.

## Later feature release

Plan separately: above-horizon versus potentially observable passes, observer darkness and satellite illumination filters, a tonight-from-my-location list, a sky-direction chart, and pass-computation performance improvements. Optical observability must not be presented as guaranteed naked-eye visibility.

## Sources to recheck during implementation

- CelesTrak formats and catalogue-ID transition: https://celestrak.org/NORAD/documentation/gp-data-formats.php
- satellite.js implementation and documentation: https://github.com/shashwatak/satellite-js
- Node release support: https://nodejs.org/en/about/previous-releases

## Handoff prompt

Read UPDATE_PLAN.md and repository instructions. Implement the accuracy and maintenance release in the order described, using separate reviewable changes. Verify the proposed library and cache design against the existing code and official documentation first. Preserve existing visuals and coordinate conventions. Add meaningful regression tests, run the required checks, and report evidence and limitations. Defer the later feature release. Do not deploy.

## Implementation decisions

- Pin satellite.js 6.0.2: installed source confirms native `json2satrec`, plain serializable records, and the existing `propagate` API. Validate both position and velocity and guard failed propagation.
- Use `src/orbitalData.js` for normalization, fetch cancellation, and raw cache version 2 (`orbit_cache_v2_<layer>`). Read validated legacy TLE caches without converting new JSON to TLE. Never cache a partial payload.
- Fetch native JSON directly. Remove third-party proxy retries from the active loading path; stop on HTTP errors and honor Retry-After with a minimum two-hour cooldown. CelesTrak requests a two-hour cache interval. Retry only a transport TypeError, at most once.
- Use `src/trackingClock.js` to re-anchor elapsed time on pause and speed changes. Device UTC is the network failure fallback.
- Keep Node 24 across development and CI. Add Playwright Chromium smoke tests against the built `/Sat-Track/` site.
- Add a compact Orbital Telemetry panel, with distinct clock source, layer source counts, and selected orbital epoch. The 72-hour age color is a visual caution, not a numerical accuracy guarantee.

## Completion and verification record — 2026-09-05

Implemented native OMM ingestion, raw cache version 2 with legacy TLE recovery, stable catalogue-ID selection/sharing, bounded cancellable network recovery, the monotonic tracking clock, generation-guarded worker results, and the Orbital Telemetry panel. Updated Node 24 tooling, production-path handling, README, and CI browser checks. The later observing-feature release remains deferred.

Verification:

- Clean `npm ci --ignore-scripts` installation completed; the subsequent production build verifies the installed bundler works.
- ESLint and Prettier checks pass. All 88 unit/integration tests pass.
- Full browser suite: all 8 scenarios pass across desktop and Pixel 7 emulation using installed Chrome in isolated profiles. The managed Chromium download failed with TLS errors; CI is configured to install its own Chromium.
- Equivalent TLE/OMM trajectories agree within 1 metre at epoch, +1 hour, and +24 hours for the deterministic fixture.
- Independent Vallado satellite-5 reference matches within 1 cm position and 0.01 mm/s velocity at epoch. Worker and main-thread position/color arrays match, including reconstructed simulations and observer highlighting.
- A single live Starlink JSON download contained 11,086 records; all were accepted, including 365 six-digit IDs. Example catalogue ID 100001, epoch 2026-09-04T09:23:11.715Z, propagated successfully at the live check time. This is separate from the synthetic unit/browser fixtures.
- Browser testing caught and fixed search-click bubbling that immediately deselected a result. Screenshot review caught and fixed the mobile drawer's padding overflowing its declared width. Tooltip placement is clamped to the viewport on mouse movement.
- Final refresh-state review preserves follow-camera mode when the selected catalogue ID survives refresh and clears obsolete hover state.

Limits: browser tests stub external textures and map requests, so their screenshots verify controls/layout rather than real texture appearance. Physical iOS/notch verification and broad rendering/performance work remain follow-ups. The existing large-chunk warning and npm's nine dependency advisories remain; no blanket dependency upgrade was attempted. No merge or deployment was performed.
