# 🛰️ Satellite Constellation Tracker

A real-time 3D visualization of satellites orbiting Earth, including Starlink, ISS, GPS, Galileo, and OneWeb constellations.

[![CI](https://github.com/HolsteredSoul/Sat-Track/actions/workflows/ci.yml/badge.svg)](https://github.com/HolsteredSoul/Sat-Track/actions/workflows/ci.yml)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-000000?logo=three.js&logoColor=white)

## 🌐 Live Demo

**[https://holsteredsoul.github.io/Sat-Track/](https://holsteredsoul.github.io/Sat-Track/)**

No installation required — opens directly in any modern browser.

## ✨ Features

- **Real-time satellite tracking** using live TLE (Two-Line Element) data from CelesTrak
- **Multiple constellation support**:
    - 🌐 Starlink (~6000+ satellites)
    - 🚀 ISS (International Space Station) with custom icon
    - 📍 GPS navigation constellation
    - 🇪🇺 Galileo navigation constellation
    - 🌍 OneWeb broadband constellation
- **Day/night Earth visualization** with realistic terminator
- **Eclipse detection** — satellites dim when in Earth's shadow
- **Orbit path visualization** for selected satellites
- **Search** to find specific satellites by name
- **Offline support** with TLE caching and simulation fallback
- **Simulation time controls** — pause, resume, or run up to 200× speed
- **Reset to Now** — snap the simulation clock back to real time in one click
- **Local time display** — Live Stats shows the current simulation time in your browser's timezone
- **Satellite size slider** — adjust dot size from 1 to 8 px to suit your screen
- **Light / dark theme** toggle
- **Screenshot export**
- **Ground station** marker with pass prediction
- **Mobile-friendly** — sidebar collapses on load so the globe is immediately visible

## 🚀 Quick Start

Visit **[https://holsteredsoul.github.io/Sat-Track/](https://holsteredsoul.github.io/Sat-Track/)** — that's it.

To run locally, clone the repo and open `index.html` in a browser. No build step or server required.

```bash
git clone https://github.com/HolsteredSoul/Sat-Track.git
cd Sat-Track
open index.html   # or double-click in your file manager
```

## 🎮 Controls

### Mouse / Touch

| Control             | Action           |
| ------------------- | ---------------- |
| **Drag**            | Rotate the globe |
| **Scroll / Pinch**  | Zoom in/out      |
| **Click satellite** | Select and track |

### Keyboard

| Key           | Action                     |
| ------------- | -------------------------- |
| `H`           | Toggle UI panel            |
| `?`           | Show keyboard shortcuts    |
| `Space` / `P` | Pause / Resume time        |
| `N`           | Reset simulation to now    |
| `R`           | Reset camera view          |
| `C`           | Cycle constellation layer  |
| `T`           | Toggle light / dark theme  |
| `E`           | Export screenshot          |
| `G`           | Set ground station         |
| `Esc`         | Deselect satellite / close |

## 📊 Data Sources

- **Satellite TLE Data**: [CelesTrak](https://celestrak.org/) — NORAD two-line element sets
- **Earth Textures**: [Three Globe](https://github.com/vasturiano/three-globe) example images
- **Time Sync**: [WorldTimeAPI](http://worldtimeapi.org/) (with TLE epoch fallback)

### Data Source Badges

Each constellation shows its data status:

- 🟢 **LIVE** — Real-time TLE data from CelesTrak
- 🔵 **CACHED** — Locally cached TLE data (< 1 hour old)
- 🟠 **SIM** — Simulated orbits (realistic but not tracking real satellites)

## 🛠️ Technical Details

### Dependencies (loaded via CDN)

- [Three.js](https://threejs.org/) v0.128.0 — 3D rendering
- [satellite.js](https://github.com/shashwatak/satellite-js) v4.0.0 — SGP4/SDP4 orbital propagation

### Browser Compatibility

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

### Quality

- **XSS Protection**: All satellite names sanitized before rendering
- **Memory Management**: Proper disposal of Three.js resources
- **Error Handling**: User-facing error notifications
- **41 automated tests** via Jest (run with `npm test`)
- **ESLint + Prettier** enforced in CI

## 📐 Orbital Mechanics

The tracker uses SGP4/SDP4 propagation algorithms via satellite.js:

- **LEO satellites** (Starlink, ISS, OneWeb): ~90 minute orbital periods
- **MEO satellites** (GPS, Galileo): ~12 hour orbital periods
- **Shadow calculation**: Accurate umbra/penumbra detection using Earth's atmospheric radius

### Simulated Constellation Parameters

When live data is unavailable, realistic simulations use these parameters:

| Constellation | Altitude (km) | Inclination (°) | Satellites |
| ------------- | ------------- | --------------- | ---------- |
| Starlink      | 540–570       | 53–97.6         | ~3500      |
| OneWeb        | 1200          | 87.9            | 648        |
| GPS           | 20,200        | 55              | 32         |
| Galileo       | 23,222        | 56              | 24         |
| ISS           | 420           | 51.6            | 1          |

## 📁 Project Structure

```
Sat-Track/
├── index.html              # App shell — HTML, CSS, CDN script tags
├── src/
│   └── StarlinkTracker.js  # All application logic
├── tests/
│   └── StarlinkTracker.test.js
├── .github/
│   └── workflows/
│       ├── ci.yml          # Lint, format check, tests on every PR
│       └── deploy.yml      # Auto-deploy to GitHub Pages on push to main
├── package.json
└── README.md
```

## 🔧 Customization

### Adding New Constellations

1. Add the CelesTrak URL to `config.urls.tle` and `config.urls.tleJson`
2. Add layer configuration to `this.layers` with label and color
3. Add to `this.layerOrder` array
4. Add UI elements (checkbox, badge) in `index.html`
5. Add simulation parameters in `generateSimulationLayer()`

### Adjusting Constants

All configurable values are in the `CONSTANTS` object at the top of `StarlinkTracker.js`:

```javascript
const CONSTANTS = {
    EARTH_RADIUS_KM: 6371, // Earth's radius
    RENDER_SCALE: 0.001, // km to Three.js units
    PHYSICS_HZ: 30, // Update frequency
    CACHE_TTL_MS: 3600000, // Cache lifetime (1 hour)
    POINT_SIZE_MIN: 1, // Minimum satellite dot size (px)
    POINT_SIZE_MAX: 8 // Maximum satellite dot size (px)
    // ... etc
};
```

## 📄 License

MIT License — feel free to use, modify, and distribute.

## 🙏 Acknowledgments

- [CelesTrak](https://celestrak.org/) for providing free satellite TLE data
- [satellite.js](https://github.com/shashwatak/satellite-js) for the orbital mechanics library
- [Three.js](https://threejs.org/) for the 3D rendering engine

## 🐛 Known Issues

- CORS restrictions may prevent direct TLE fetches; the app uses multiple proxy fallbacks
- Very old cached TLE data may show inaccurate positions (refresh to update)
- Mobile performance may vary with large constellation counts

---

Made with ☕ and curiosity about what's orbiting above us.
