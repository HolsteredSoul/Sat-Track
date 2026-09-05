/**
 * Main satellite tracker application class.
 * @module StarlinkTracker
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as satellite from 'satellite.js';
import { CONSTANTS } from './constants.js';
import { OrbitalDataStore, describeEpoch, validPV } from './orbitalData.js';
import { TrackingClock } from './trackingClock.js';
import {
    computeShadowFactorKm,
    calculateSunDirection,
    SimulatedOrbit,
    calculateElevation,
    calculateAzimuth,
    azimuthToCardinal,
    isMobileDevice,
    clampPointSize
} from './core.js';
import {
    handleError,
    showErrorToast,
    createISSIcon,
    saveThemePreference,
    loadThemePreference,
    savePointSizePreference,
    loadPointSizePreference,
    saveObserverLocation,
    loadObserverLocation,
    saveLabelsPreference,
    loadLabelsPreference
} from './helpers.js';

export class StarlinkTracker {
    constructor() {
        this.isMobile = isMobileDevice();

        // === Effective constants (adjusted for mobile) ===
        this.effectiveStarCount = this.isMobile
            ? CONSTANTS.MOBILE_STAR_COUNT
            : CONSTANTS.STAR_COUNT;
        this.effectivePhysicsHz = this.isMobile
            ? CONSTANTS.MOBILE_PHYSICS_HZ
            : CONSTANTS.PHYSICS_HZ;
        this.effectiveRaycastHz = this.isMobile
            ? CONSTANTS.MOBILE_RAYCAST_HZ
            : CONSTANTS.RAYCAST_HZ;
        this.effectiveOrbitPoints = this.isMobile
            ? CONSTANTS.MOBILE_ORBIT_POINTS
            : CONSTANTS.ORBIT_POINTS;

        // === Configuration ===
        this.config = {
            urls: {
                earthDay: CONSTANTS.EARTH_DAY_TEXTURE,
                earthNight: CONSTANTS.EARTH_NIGHT_TEXTURE,
                earthDayHi: CONSTANTS.EARTH_DAY_TEXTURE_HI,
                earthWater: CONSTANTS.EARTH_WATER_TEXTURE,
                earthClouds: CONSTANTS.EARTH_CLOUDS_TEXTURE,
                orbitalData: CONSTANTS.GP_JSON_URLS
            }
        };

        // === Earth Texture LOD State ===
        this._earthLodHigh = false;
        this._earthLodCache = null;
        this._earthLodLoading = false;
        this._earthLodLastCheck = 0;
        this._earthLodFailed = false;
        this._earthLodDefaultDay = null;

        // === Layer Configuration ===
        this.layerOrder = [
            'starlink',
            'iss',
            'gps',
            'galileo',
            'oneweb',
            'iridium',
            'glonass',
            'beidou'
        ];
        this.layers = {
            starlink: {
                label: 'Starlink',
                color: new THREE.Color(1.0, 1.0, 1.0),
                enabled: true,
                source: 'loading'
            },
            iss: {
                label: 'ISS',
                color: new THREE.Color(1.0, 0.8, 0.0),
                enabled: true,
                source: 'loading'
            },
            gps: {
                label: 'GPS',
                color: new THREE.Color(0.0, 1.0, 0.5),
                enabled: true,
                source: 'loading'
            },
            galileo: {
                label: 'Galileo',
                color: new THREE.Color(0.4, 0.7, 1.0),
                enabled: true,
                source: 'loading'
            },
            oneweb: {
                label: 'OneWeb',
                color: new THREE.Color(1.0, 0.3, 0.3),
                enabled: true,
                source: 'loading'
            },
            iridium: {
                label: 'Iridium',
                color: new THREE.Color(0.7, 0.3, 1.0),
                enabled: true,
                source: 'loading'
            },
            glonass: {
                label: 'GLONASS',
                color: new THREE.Color(1.0, 0.5, 0.0),
                enabled: true,
                source: 'loading'
            },
            beidou: {
                label: 'BeiDou',
                color: new THREE.Color(1.0, 0.4, 0.7),
                enabled: true,
                source: 'loading'
            }
        };

        // === State Variables ===
        this.clock = new TrackingClock();
        let storage;
        try {
            storage = window.localStorage;
        } catch {
            /* Private mode. */
        }
        this.dataStore = new OrbitalDataStore({ storage });
        this._lifetime = new AbortController();
        this._generation = 0;
        this._lastFreshnessUpdate = 0;
        this.lastPhysicsUpdate = 0;
        this.lastRaycastUpdate = 0;
        this.sunPosition = new THREE.Vector3();
        this.currentSimDate = null;
        this.mouseMoved = false;
        this.isInitialized = false;
        this.isDisposed = false;
        this.cloudMesh = null;
        this._lastAnimTime = 0;

        // === Pause State ===
        this.paused = false;

        // === Auto-Rotation State ===
        this.autoRotateEnabled = false; // user preference; selection may override temporarily

        // === Visible Count State ===
        this._lastVisibleCountMs = 0;
        this._visibleCountScope = 'starlink'; // 'starlink' | 'all'

        // === Point Size ===
        this.pointSize = clampPointSize(
            loadPointSizePreference(CONSTANTS.POINT_SIZE_DEFAULT),
            CONSTANTS.POINT_SIZE_MIN,
            CONSTANTS.POINT_SIZE_MAX
        );

        // === Constellation Cycle State ===
        this.cycleLayerIndex = -1;

        // === Focus / Follow Mode ===
        this.followMode = false;
        this._cameraAnim = null; // { start, end, target, startTime, duration }
        this.labelsEnabled = loadLabelsPreference(true);

        // === Observer / Ground Station ===
        this.observerLocation = null; // { lat, lon } in degrees
        this.groundStationMarker = null;
        this._leafletMap = null;
        this._locationPickerOpen = false;

        // === Theme ===
        this.currentTheme = loadThemePreference();

        // === Data Storage ===
        this.layerData = {};
        this.layerMeshes = {};
        this.layerFade = {};
        this.allSatIndex = [];

        // === Selection State ===
        this.hovered = null;
        this.selected = null;

        // === Visibility Highlighting ===
        this.highlightVisible = false;

        // === Event Handler References ===
        this._boundHandlers = {};

        // === UI Element References ===
        this.ui = {
            container: document.getElementById('ui-container'),
            toggleBtn: document.getElementById('ui-toggle'),
            time: document.getElementById('utcTime'),
            count: document.getElementById('satCount'),
            lit: document.getElementById('litCount'),
            dark: document.getElementById('darkCount'),
            statusText: document.getElementById('status-text'),
            statusDot: document.getElementById('status-dot'),
            clockStatus: document.getElementById('clock-status'),
            dataHealth: document.getElementById('data-health'),
            selectedEpoch: document.getElementById('selected-epoch'),
            tooltip: document.getElementById('tooltip'),
            slider: document.getElementById('growthSlider'),
            speedSlider: document.getElementById('timeSpeed'),
            speedDisplay: document.getElementById('speedDisplay'),
            pixelSizeSlider: document.getElementById('pixelSizeSlider'),
            pixelSizeDisplay: document.getElementById('pixelSizeDisplay'),
            pauseIndicator: document.getElementById('pause-indicator'),
            localTime: document.getElementById('localTime'),
            localTzLabel: document.getElementById('localTzLabel'),
            loader: document.getElementById('loader-overlay'),
            loaderText: document.getElementById('loader-text'),
            progress: document.getElementById('progress-fill'),
            searchBox: document.getElementById('search-box'),
            searchCount: document.getElementById('search-count'),
            searchResults: document.getElementById('search-results'),
            checkOrbit: document.getElementById('toggle-orbit'),
            offlineBanner: document.getElementById('offline-banner'),
            keyboardOverlay: document.getElementById('keyboard-overlay'),
            passInfo: document.getElementById('pass-info'),
            locationPanel: document.getElementById('location-panel'),
            visibleCountText: document.getElementById('visible-count-text'),
            visibleScopeBtn: document.getElementById('btn-visible-scope'),
            minElSlider: document.getElementById('min-el-slider'),
            minElDisplay: document.getElementById('min-el-display'),
            selectedPassPanel: document.getElementById('selected-pass-panel'),
            passTableContainer: document.getElementById('pass-table-container'),
            toggleVisHighlight: document.getElementById('toggle-vis-highlight'),
            inputDms: document.getElementById('input-dms'),
            inputLat: document.getElementById('input-lat'),
            inputLon: document.getElementById('input-lon'),
            manualLocationForm: document.getElementById('manual-location-form'),
            layers: {},
            badges: {},
            tooltipElements: {
                name: document.getElementById('tooltip-name'),
                layer: document.getElementById('tooltip-layer'),
                id: document.getElementById('tooltip-id'),
                alt: document.getElementById('tooltip-alt'),
                vel: document.getElementById('tooltip-vel'),
                light: document.getElementById('tooltip-light'),
                locked: document.getElementById('tooltip-locked')
            }
        };

        // Dynamically collect layer checkboxes and badges
        for (const key of this.layerOrder) {
            this.ui.layers[key] = document.getElementById(`layer-${key}`);
            this.ui.badges[key] = document.getElementById(`badge-${key}`);
        }

        // === Three.js Objects ===
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.sunLight = null;
        this.earthMat = null;
        this.atmoMat = null;
        this.orbitPathLine = null;
        this.pointTex = null;
        this.issSprite = null;
        this.issTex = null;

        // === Raycaster Setup ===
        this.raycaster = new THREE.Raycaster();
        // Threshold is overwritten dynamically in checkRaycast() based on zoom level.
        this.mouse = new THREE.Vector2();

        this._tmpVec = new THREE.Vector3();
        this._disposables = [];

        // === Web Worker ===
        this.worker = null;
        this.workerBusy = false;
        this.workerAvailable = false;
        this._initWorker();

        // Apply initial theme
        this.applyTheme(this.currentTheme);

        this.init();
    }

    // ========================================================================
    // WEB WORKER
    // ========================================================================

    /** Creates the propagation worker. Falls back to synchronous path on failure. */
    _initWorker() {
        try {
            this.worker = new Worker(new URL('./workers/propagator.worker.js', import.meta.url), {
                type: 'module'
            });
            this.worker.onmessage = (e) => this._handleWorkerResult(e.data);
            this.worker.onerror = (err) => {
                handleError('Propagation worker', err);
                this.workerAvailable = false;
                this.workerBusy = false;
                this.worker?.terminate();
            };
            this.workerAvailable = true;
        } catch (e) {
            handleError('Worker init', e);
            this.workerAvailable = false;
        }
    }

    /** Sends satellite data to the worker after TLE loading. */
    _postWorkerInit() {
        if (!this.workerAvailable) return;
        const layers = {};
        for (const key of this.layerOrder) {
            const ld = this.layerData[key];
            if (!ld) continue;
            const simParams = ld.satData.map((sat) => {
                if (sat.isSimulated) {
                    return {
                        alt: sat.alt,
                        incDeg: sat.inc * (180 / Math.PI),
                        raanDeg: sat.raan0 * (180 / Math.PI),
                        anomalyDeg: sat.anomaly0 * (180 / Math.PI),
                        epoch: sat.epoch
                    };
                }
                return null;
            });
            const color = this.layers[key].color;
            layers[key] = {
                satData: ld.satData,
                simParams,
                satNames: ld.satNames,
                color: { r: color.r, g: color.g, b: color.b }
            };
        }
        this.worker.postMessage({ type: 'init', layers });
    }

    /** Returns the active Starlink count based on the density slider. */
    _getStarlinkActiveCount() {
        const ld = this.layerData.starlink;
        if (!ld) return 0;
        return Math.floor(ld.satData.length * (this.ui.slider.value / 100));
    }

    /** Handles result messages from the propagation worker. */
    _handleWorkerResult(data) {
        this.workerBusy = false;
        if (this.isDisposed || data.generation !== this._generation) return;

        for (const key of this.layerOrder) {
            const layer = data.layers[key];
            if (!layer) continue;
            const mesh = this.layerMeshes[key];
            if (!mesh) continue;
            const posAttr = mesh.geometry.attributes.position;
            const colAttr = mesh.geometry.attributes.color;
            posAttr.array.set(layer.positions);
            posAttr.array.fill(0, layer.activeCount * 3);
            posAttr.needsUpdate = true;
            mesh.geometry.boundingSphere = null; // force recompute from real positions on next raycast
            colAttr.array.set(layer.colors);
            colAttr.needsUpdate = true;
            mesh.geometry.setDrawRange(0, layer.activeCount);
        }

        if (this.issSprite) {
            if (data.issPos && this.layers.iss.enabled) {
                this.issSprite.position.set(data.issPos.x, data.issPos.y, data.issPos.z);
                this.issSprite.visible = true;
                this.issSprite.material.opacity = 1 - data.issShadow * 0.7;
            } else {
                this.issSprite.visible = false;
            }
        }

        if (data.tooltipData && (this.selected || this.hovered)) {
            const td = data.tooltipData;
            this.updateTooltip(td.layerKey, td.idx, td.distKm, td.speed, td.shadow, td.isLocked);
        }

        if (data.stats) {
            this.ui.count.innerText = data.stats.total;
            this.ui.lit.innerText = data.stats.lit;
            this.ui.dark.innerText = data.stats.dark;
        }
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    /**
     * Main initialization entry point.
     */
    async init() {
        try {
            this.setupScene();
            this.setupEarth();
            this.setupLighting();
            this.setupStars();
            this.setupOrbitVisualizer();
            this.setupISSSprite();
            this.setupEvents();

            // Restore saved observer location (if any)
            const savedLocation = loadObserverLocation();
            if (savedLocation) {
                this._applyObserverLocation(savedLocation.lat, savedLocation.lon);
            }

            // Collapse panel by default on mobile so the globe is visible
            if (window.innerWidth <= 768) {
                this.ui.container.classList.add('hidden');
                this.ui.toggleBtn.textContent = '\u2630';
            }

            // Set timezone label once (browser's local timezone)
            if (this.ui.localTzLabel) {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                this.ui.localTzLabel.textContent = tz;
            }

            await this.loadData();

            this.isInitialized = true;
            this.animate();
        } catch (error) {
            handleError('Initialization', error, true);
            this.updateStatus('Initialization failed', 'status-err');
        }
    }

    /**
     * Sets up the Three.js scene, camera, renderer, and controls.
     */
    setupScene() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            CONSTANTS.CAMERA_FOV,
            window.innerWidth / window.innerHeight,
            CONSTANTS.CAMERA_NEAR,
            CONSTANTS.CAMERA_FAR
        );
        this.camera.position.set(
            CONSTANTS.CAMERA_INITIAL_DISTANCE,
            CONSTANTS.CAMERA_INITIAL_DISTANCE * 0.48,
            CONSTANTS.CAMERA_INITIAL_DISTANCE
        );

        this.renderer = new THREE.WebGLRenderer({
            antialias: !this.isMobile,
            alpha: false,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;
        document.body.appendChild(this.renderer.domElement);

        // CSS2D overlay renderer for satellite labels
        this.css2dRenderer = new CSS2DRenderer();
        this.css2dRenderer.setSize(window.innerWidth, window.innerHeight);
        this.css2dRenderer.domElement.style.position = 'absolute';
        this.css2dRenderer.domElement.style.top = '0';
        this.css2dRenderer.domElement.style.left = '0';
        this.css2dRenderer.domElement.style.pointerEvents = 'none';
        document.body.appendChild(this.css2dRenderer.domElement);
        this._satLabel = null; // current CSS2DObject label

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = CONSTANTS.DAMPING_FACTOR;
        this.controls.minDistance = CONSTANTS.CAMERA_MIN_DISTANCE;
        this.controls.maxDistance = CONSTANTS.CAMERA_MAX_DISTANCE;
        this.controls.autoRotate = false;
        this.controls.autoRotateSpeed = CONSTANTS.AUTO_ROTATE_SPEED;
        this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

        // Default point texture
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(8, 8, 8, 0, Math.PI * 2);
        ctx.fill();
        this.pointTex = new THREE.CanvasTexture(canvas);
        this._disposables.push(this.pointTex);
    }

    /**
     * Sets up the Earth globe with day/night shader and atmosphere.
     */
    setupEarth() {
        const loader = new THREE.TextureLoader();
        this._texLoader = loader;
        this._maxAniso = this.renderer.capabilities.getMaxAnisotropy();

        const initialUniforms = {
            dayTexture: {
                value: loader.load(this.config.urls.earthDay, (tex) => this._configureTexture(tex))
            },
            nightTexture: {
                value: loader.load(this.config.urls.earthNight, (tex) =>
                    this._configureTexture(tex)
                )
            },
            sunDirection: { value: new THREE.Vector3(1, 0, 0) },
            uTerminatorStart: { value: CONSTANTS.TERMINATOR_BLEND_START },
            uTerminatorEnd: { value: CONSTANTS.TERMINATOR_BLEND_END },
            uScatterStart: { value: CONSTANTS.ATMOSPHERE_SCATTER_START },
            uSpecStrength: { value: 0.0 },
            uSpecPower: { value: CONSTANTS.EARTH_SPEC_POWER },
            specularMap: {
                // Fail-soft: strength stays 0 until load succeeds; onError leaves glint off.
                value: loader.load(
                    this.config.urls.earthWater,
                    (tex) => {
                        if (this.isDisposed) {
                            tex.dispose();
                            return;
                        }
                        // Water mask is data, not color — no mips/aniso (avoids coastal land bleed).
                        this._configureDataTexture(tex);
                        if (this.earthMat) {
                            this.earthMat.uniforms.uSpecStrength.value =
                                CONSTANTS.EARTH_SPEC_STRENGTH;
                        }
                    },
                    undefined,
                    () => {
                        /* network/404: keep uSpecStrength at 0 */
                    }
                )
            }
        };

        this._earthLodDefaultDay = initialUniforms.dayTexture.value;

        this._disposables.push(initialUniforms.dayTexture.value);
        this._disposables.push(initialUniforms.nightTexture.value);
        this._disposables.push(initialUniforms.specularMap.value);

        this.earthMat = new THREE.ShaderMaterial({
            uniforms: initialUniforms,
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                void main() {
                    vUv = uv;
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vViewDir = normalize(cameraPosition - worldPos.xyz);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                uniform sampler2D dayTexture;
                uniform sampler2D nightTexture;
                uniform vec3 sunDirection;
                uniform float uTerminatorStart;
                uniform float uTerminatorEnd;
                uniform float uScatterStart;
                uniform sampler2D specularMap;
                uniform float uSpecStrength;
                uniform float uSpecPower;
                varying vec2 vUv;
                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                void main() {
                    vec3 day = texture2D(dayTexture, vUv).rgb;
                    vec3 night = texture2D(nightTexture, vUv).rgb;
                    // Re-normalize after raster interpolation (Blinn-Phong is sensitive).
                    vec3 N = normalize(vWorldNormal);
                    vec3 V = normalize(vViewDir);
                    float sunDot = dot(N, sunDirection);
                    float mixVal = smoothstep(uTerminatorStart, uTerminatorEnd, sunDot);
                    vec3 atmosphere = vec3(1.0, 0.6, 0.3);
                    float scatter = smoothstep(uScatterStart, 0.0, abs(sunDot));
                    vec3 final = mix(night * 2.5, day, mixVal);
                    final += atmosphere * scatter * 0.5 * (1.0 - mixVal);
                    // Hard ocean mask threshold — soft greys from filtering must not glint land.
                    float ocean = step(0.5, texture2D(specularMap, vUv).r);
                    vec3 H = normalize(sunDirection + V);
                    float spec = pow(max(dot(N, H), 0.0), uSpecPower);
                    final += vec3(1.0, 0.95, 0.85) * spec * ocean * uSpecStrength * mixVal;
                    gl_FragColor = vec4(final, 1.0);
                }
            `
        });

        const geometry = new THREE.SphereGeometry(
            CONSTANTS.EARTH_RADIUS_KM * CONSTANTS.RENDER_SCALE,
            64,
            64
        );
        this.earthGroup = new THREE.Mesh(geometry, this.earthMat);
        // This -90° Y rotation is coupled with the coordinate transforms used
        // elsewhere and must not be changed in isolation:
        //   - Satellite positions map ECI lon/lat to scene space as
        //     x = cos(lat)sin(lon), y = sin(lat), z = cos(lat)cos(lon).
        //   - calculateSunDirection (core.js) emits the sun vector remapped as
        //     (x, z, -y) into the same scene frame.
        // Rotating the sphere -90° about Y aligns the blue-marble texture's 0°
        // longitude seam with that frame so the day/night terminator lands on the
        // correct meridian. Changing this rotation, the sat mapping, or the sun
        // remapping requires re-tuning the others together.
        this.earthGroup.rotation.y = -Math.PI / 2;
        this.scene.add(this.earthGroup);
        this._disposables.push(geometry);
        this._disposables.push(this.earthMat);

        // Atmosphere shell
        const atmoGeo = new THREE.SphereGeometry(
            CONSTANTS.EARTH_RADIUS_KM * CONSTANTS.RENDER_SCALE * CONSTANTS.ATMOSPHERE_SCALE,
            64,
            64
        );
        this.atmoMat = new THREE.ShaderMaterial({
            uniforms: {
                sunDirection: { value: new THREE.Vector3(1, 0, 0) },
                uDaysideBlend: { value: CONSTANTS.ATMOSPHERE_DAYSIDE_BLEND }
            },
            vertexShader: `
                varying vec3 vWorldNormal;
                varying vec3 vWorldViewDir;
                void main() {
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    // Same world-space view dir as the Earth day/night/glint shader.
                    vWorldViewDir = cameraPosition - worldPos.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision mediump float;
                uniform vec3 sunDirection;
                uniform float uDaysideBlend;
                varying vec3 vWorldNormal;
                varying vec3 vWorldViewDir;
                void main() {
                    vec3 N = normalize(vWorldNormal);
                    vec3 V = normalize(vWorldViewDir);
                    float fres = pow(clamp(0.75 - dot(N, V), 0.0, 1.0), 2.5);
                    float sunOrientation = dot(N, sunDirection);
                    float daySide = smoothstep(-uDaysideBlend, uDaysideBlend, sunOrientation);
                    vec3 skyHi = vec3(0.30, 0.55, 1.0);
                    vec3 skyLo = vec3(0.55, 0.75, 1.0);
                    vec3 col = mix(skyHi, skyLo, fres);
                    gl_FragColor = vec4(col, 1.0) * fres * daySide * 1.6;
                }
            `,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false
        });
        const atmoMesh = new THREE.Mesh(atmoGeo, this.atmoMat);
        this.scene.add(atmoMesh);
        this._disposables.push(atmoGeo);
        this._disposables.push(this.atmoMat);

        if (!this.isMobile) {
            const cloudGeo = new THREE.SphereGeometry(
                CONSTANTS.EARTH_RADIUS_KM * CONSTANTS.RENDER_SCALE * 1.01,
                48,
                48
            );
            // Reveal the cloud shell only once its texture has loaded — otherwise
            // an unloaded map samples as opaque white and flashes a white sphere
            // over the globe on slow connections.
            const cloudTex = loader.load(
                this.config.urls.earthClouds,
                (tex) => {
                    if (this.isDisposed) {
                        tex.dispose();
                        return;
                    }
                    this._configureTexture(tex);
                    if (this.cloudMesh) this.cloudMesh.visible = true;
                },
                undefined,
                () => {
                    /* network/404: leave cloudMesh hidden */
                }
            );
            const cloudMat = new THREE.MeshLambertMaterial({
                map: cloudTex,
                alphaMap: cloudTex,
                transparent: true,
                depthWrite: false,
                opacity: 0.85
            });
            this.cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
            this.cloudMesh.visible = false;
            this.earthGroup.add(this.cloudMesh);
            this._disposables.push(cloudGeo);
            this._disposables.push(cloudMat);
            this._disposables.push(cloudTex);
        }
    }

    /**
     * Configures color texture quality settings (anisotropy, trilinear mips).
     */
    _configureTexture(tex) {
        tex.anisotropy = this._maxAniso;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
    }

    /**
     * Configures a data/mask texture: no mipmaps or anisotropy so hard thresholds
     * (e.g. ocean vs land) stay sharp under globe-distance minification.
     */
    _configureDataTexture(tex) {
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = 1;
        tex.needsUpdate = true;
    }

    /**
     * Checks camera distance and swaps Earth day texture between default (4K) and high-res (8K).
     */
    _updateEarthLOD(camDist, now) {
        if (!this.earthMat) return;
        if (this.isMobile) return;
        if (now - this._earthLodLastCheck < CONSTANTS.EARTH_LOD_CHECK_MS) return;
        this._earthLodLastCheck = now;

        const shouldBeHigh = camDist < CONSTANTS.EARTH_LOD_THRESHOLD;
        const shouldBeLow =
            camDist > CONSTANTS.EARTH_LOD_THRESHOLD + CONSTANTS.EARTH_LOD_HYSTERESIS;

        if (
            shouldBeHigh &&
            !this._earthLodHigh &&
            !this._earthLodLoading &&
            !this._earthLodFailed
        ) {
            // Already fetched the high-res texture on a previous zoom-in — just
            // reapply the cached one. Re-fetching would allocate a new GPU texture
            // and overwrite _earthLodCache without disposing the old one (leak).
            if (this._earthLodCache) {
                this.earthMat.uniforms.dayTexture.value = this._earthLodCache;
                this._earthLodHigh = true;
                return;
            }
            this._earthLodLoading = true;
            const loader = this._texLoader;

            const loadPromise = new Promise((resolve, reject) => {
                loader.load(this.config.urls.earthDayHi, resolve, undefined, reject);
            });

            const timeout = new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error('LOD texture load timeout')),
                    CONSTANTS.EARTH_LOD_LOAD_TIMEOUT_MS
                )
            );

            Promise.race([loadPromise, timeout])
                .then((dayHi) => {
                    if (this.isDisposed) {
                        dayHi.dispose();
                        return;
                    }
                    this._configureTexture(dayHi);
                    this._earthLodCache = dayHi;
                    const currentDist = this.camera.position.length();
                    if (
                        currentDist <
                        CONSTANTS.EARTH_LOD_THRESHOLD + CONSTANTS.EARTH_LOD_HYSTERESIS
                    ) {
                        this.earthMat.uniforms.dayTexture.value = dayHi;
                        this._earthLodHigh = true;
                    }
                })
                .catch(() => {
                    this._earthLodFailed = true;
                })
                .finally(() => {
                    this._earthLodLoading = false;
                });
        } else if (shouldBeLow && this._earthLodHigh) {
            this.earthMat.uniforms.dayTexture.value = this._earthLodDefaultDay;
            this._earthLodHigh = false;
        }
    }

    /**
     * Sets up scene lighting.
     */
    setupLighting() {
        this.scene.add(new THREE.AmbientLight(0x111111));
        this.sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
        this.scene.add(this.sunLight);
    }

    /**
     * Creates the background star field.
     */
    setupStars() {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(this.effectiveStarCount * 3);
        for (let i = 0; i < this.effectiveStarCount * 3; i++) {
            pos[i] = (Math.random() - 0.5) * CONSTANTS.STAR_SPREAD;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({
            color: 0x888888,
            size: 1.2,
            sizeAttenuation: false
        });
        this.scene.add(new THREE.Points(geo, mat));
        this._disposables.push(geo);
        this._disposables.push(mat);
    }

    /**
     * Sets up the orbit path visualization line.
     */
    setupOrbitVisualizer() {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
            'position',
            new THREE.BufferAttribute(new Float32Array(this.effectiveOrbitPoints * 3), 3)
        );
        const mat = new THREE.LineBasicMaterial({
            color: 0x33aaff,
            opacity: 0.8,
            transparent: true
        });
        this.orbitPathLine = new THREE.Line(geo, mat);
        this.orbitPathLine.visible = false;
        this.scene.add(this.orbitPathLine);
        this._disposables.push(geo);
        this._disposables.push(mat);
    }

    /**
     * Creates the ISS sprite with custom icon.
     */
    setupISSSprite() {
        const issCanvas = createISSIcon();
        this.issTex = new THREE.CanvasTexture(issCanvas);
        this.issTex.needsUpdate = true;
        this._disposables.push(this.issTex);

        const spriteMaterial = new THREE.SpriteMaterial({
            map: this.issTex,
            transparent: true,
            depthTest: true,
            depthWrite: false
        });

        this.issSprite = new THREE.Sprite(spriteMaterial);
        this.issSprite.scale.set(0.6, 0.6, 1);
        this.issSprite.visible = false;
        this.issSprite.userData.isISS = true;
        this.scene.add(this.issSprite);
        this._disposables.push(spriteMaterial);
    }

    // ========================================================================
    // EVENT HANDLING
    // ========================================================================

    /**
     * Sets up all event listeners.
     */
    setupEvents() {
        // Resize
        this._boundHandlers.resize = () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.css2dRenderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', this._boundHandlers.resize);

        // Mouse move
        this._boundHandlers.mouseMove = (e) => {
            this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            this.mouseMoved = true;
            const tip = this.ui.tooltip;
            if (tip.style.display === 'block') {
                tip.style.left =
                    Math.max(8, Math.min(e.clientX + 20, window.innerWidth - tip.offsetWidth - 8)) +
                    'px';
                tip.style.top =
                    Math.max(
                        8,
                        Math.min(e.clientY + 20, window.innerHeight - tip.offsetHeight - 8)
                    ) + 'px';
            }
        };
        window.addEventListener('mousemove', this._boundHandlers.mouseMove);

        // UI toggle
        const toggleMenu = () => {
            this.ui.container.classList.toggle('hidden');
            const isHidden = this.ui.container.classList.contains('hidden');
            this.ui.toggleBtn.textContent = isHidden ? '\u2630' : '\u2715';
        };
        this._boundHandlers.toggleClick = toggleMenu;
        this.ui.toggleBtn.addEventListener('click', this._boundHandlers.toggleClick);

        // Layer toggles
        this.layerOrder.forEach((key) => {
            const el = this.ui.layers[key];
            if (!el) return;
            const handler = () => {
                this.layers[key].enabled = el.checked;
                if (this.layerMeshes[key] && this.layerFade[key]) {
                    this.layerFade[key].target = el.checked ? 1.0 : 0.0;
                    if (el.checked) this.layerMeshes[key].visible = true;
                }
                if (key === 'iss' && this.issSprite) {
                    this.issSprite.visible = el.checked;
                }
                if (this.selected && this.selected.layer === key && !el.checked) {
                    this.resetSelection();
                }
                if (this.hovered && this.hovered.layer === key && !el.checked) {
                    this.hovered = null;
                    if (!this.selected) this.ui.tooltip.style.display = 'none';
                }
            };
            this._boundHandlers[`layer_${key}`] = handler;
            el.addEventListener('change', handler);
        });

        // Search results click
        this._boundHandlers.searchClick = (e) => {
            const item = e.target.closest('.search-item');
            if (item) {
                // Selection removes the result from the DOM; don't let its click
                // reach the globe handler and immediately deselect it.
                e.stopPropagation();
                const layer = item.dataset.layer;
                const index = parseInt(item.dataset.index, 10);
                this.selectSatellite(layer, index);
            }
        };
        this.ui.searchResults.addEventListener('click', this._boundHandlers.searchClick);

        // Search input with debounce
        let searchTimeout = null;
        this._boundHandlers.searchInput = (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(
                () => this.performSearch(e.target.value),
                CONSTANTS.SEARCH_DEBOUNCE_MS
            );
        };
        this.ui.searchBox.addEventListener('input', this._boundHandlers.searchInput);

        // Search keyboard navigation (arrow keys + Enter)
        this._boundHandlers.searchKeyDown = (e) => {
            const items = Array.from(this.ui.searchResults.querySelectorAll('.search-item'));
            if (!items.length) return;

            const current = this.ui.searchResults.querySelector('.search-item.keyboard-selected');
            let idx = items.indexOf(current);

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                idx = idx < items.length - 1 ? idx + 1 : 0;
                items.forEach((i) => i.classList.remove('keyboard-selected'));
                items[idx].classList.add('keyboard-selected');
                items[idx].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                idx = idx > 0 ? idx - 1 : items.length - 1;
                items.forEach((i) => i.classList.remove('keyboard-selected'));
                items[idx].classList.add('keyboard-selected');
                items[idx].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter' && current) {
                e.preventDefault();
                this.selectSatellite(current.dataset.layer, parseInt(current.dataset.index, 10));
            }
        };
        this.ui.searchBox.addEventListener('keydown', this._boundHandlers.searchKeyDown);

        // Window click for selection / location placement
        this._boundHandlers.windowClick = (e) => {
            if (
                e.target.closest('#ui-container') ||
                e.target.closest('#ui-toggle') ||
                e.target.closest('#controls') ||
                e.target.closest('#keyboard-overlay')
            )
                return;

            if (this.hovered) {
                this.selectSatellite(this.hovered.layer, this.hovered.index);
            } else if (this.selected) {
                this.resetSelection();
            }
        };
        window.addEventListener('click', this._boundHandlers.windowClick);

        // Keyboard
        this._boundHandlers.keyDown = (e) => {
            const inInput = !!e.target.closest('input, textarea');

            if (e.key === 'Escape') {
                if (
                    this.ui.keyboardOverlay &&
                    this.ui.keyboardOverlay.classList.contains('visible')
                ) {
                    this.ui.keyboardOverlay.classList.remove('visible');
                } else if (!inInput) {
                    this.resetSelection();
                }
                return;
            }

            if (inInput) return;

            // Use e.code as a cross-layout fallback alongside e.key where needed.
            const key = e.key.toLowerCase();
            const code = e.code;

            if (key === 'h' || code === 'KeyH') toggleMenu();
            // ? is Shift+/ on US layout; e.code covers non-US keyboards
            if (key === '?' || (e.shiftKey && code === 'Slash')) this.toggleKeyboardOverlay();
            if (key === 't' || code === 'KeyT') this.toggleTheme();
            if (key === 'e' || code === 'KeyE') this.exportScreenshot();
            if (key === 'g' || code === 'KeyG') this.requestGroundStation();
            if (key === 'p' || code === 'KeyP' || code === 'Space') {
                e.preventDefault();
                this.togglePause();
            }
            if (key === 'a' || code === 'KeyA') this.toggleAutoRotate();
            if (key === 'n' || code === 'KeyN') this.resetToNow();
            if (key === 'r' || code === 'KeyR') this.resetCamera();
            if (key === 'c' || code === 'KeyC') this.cycleConstellationLayer();
            if (key === 'f' || code === 'KeyF') this.focusOnSatellite();
            if (key === 'l' || code === 'KeyL') this.toggleLabels();
        };
        window.addEventListener('keydown', this._boundHandlers.keyDown);

        // Speed slider
        this._boundHandlers.speedInput = (e) => {
            this.clock.setSpeed(Number(e.target.value));
            this._generation++;
            this.ui.speedDisplay.textContent = e.target.value;
            this.updateDataHealth();
        };
        this.ui.speedSlider.addEventListener('input', this._boundHandlers.speedInput);

        // Pixel size slider
        if (this.ui.pixelSizeSlider) {
            this.ui.pixelSizeSlider.value = this.pointSize;
            if (this.ui.pixelSizeDisplay) this.ui.pixelSizeDisplay.textContent = this.pointSize;
            this._boundHandlers.pixelSizeInput = (e) => {
                const size = clampPointSize(
                    parseFloat(e.target.value),
                    CONSTANTS.POINT_SIZE_MIN,
                    CONSTANTS.POINT_SIZE_MAX
                );
                this.setPointSize(size);
            };
            this.ui.pixelSizeSlider.addEventListener('input', this._boundHandlers.pixelSizeInput);
        }

        // Online/offline
        this._boundHandlers.online = () => {
            this.ui.offlineBanner.style.display = 'none';
            this.refreshData();
        };
        this._boundHandlers.offline = () => {
            this.ui.offlineBanner.style.display = 'block';
        };
        window.addEventListener('online', this._boundHandlers.online);
        window.addEventListener('offline', this._boundHandlers.offline);

        if (!navigator.onLine) {
            this.ui.offlineBanner.style.display = 'block';
        }

        // Action buttons (store references for cleanup)
        this._actionButtons = [];
        const bindBtn = (id, handler) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('click', handler);
                this._actionButtons.push({ el, handler });
            }
        };
        bindBtn('btn-export', () => this.exportScreenshot());
        bindBtn('btn-location', () => this.requestGroundStation());
        bindBtn('btn-auto-rotate', () => this.toggleAutoRotate());
        bindBtn('btn-theme', () => this.toggleTheme());
        bindBtn('btn-keyboard', () => this.toggleKeyboardOverlay());
        bindBtn('btn-reset-time', () => this.resetToNow());
        bindBtn('btn-share', () => this.copyShareableURL());
        bindBtn('btn-focus', () => this.focusOnSatellite());
        bindBtn('btn-follow', () => this.toggleFollowMode());
        bindBtn('btn-labels', () => this.toggleLabels());
        bindBtn('btn-reset-camera', () => this.resetCamera());
        bindBtn('btn-refresh', () => this.handleRefresh());

        // Set initial active state for labels button
        const labelsBtn = document.getElementById('btn-labels');
        if (labelsBtn) labelsBtn.classList.toggle('active', this.labelsEnabled);

        // Collapsible section headings
        const setupCollapsible = (headingId, contentId) => {
            const heading = document.getElementById(headingId);
            const content = document.getElementById(contentId);
            if (heading && content) {
                const handler = () => {
                    heading.classList.toggle('collapsed');
                    content.classList.toggle('collapsed');
                };
                heading.addEventListener('click', handler);
                this._actionButtons.push({ el: heading, handler });
            }
        };
        setupCollapsible('heading-simulation', 'content-simulation');
        setupCollapsible('heading-layers', 'content-layers');

        bindBtn('keyboard-overlay-close', () => {
            this.ui.keyboardOverlay.classList.remove('visible');
        });

        // Manual location form
        const manualToggle = document.getElementById('btn-manual-toggle');
        if (manualToggle) {
            this._boundHandlers.manualToggle = () => {
                if (this.ui.manualLocationForm) {
                    const hidden = this.ui.manualLocationForm.style.display === 'none';
                    this.ui.manualLocationForm.style.display = hidden ? '' : 'none';
                }
            };
            manualToggle.addEventListener('click', this._boundHandlers.manualToggle);
            this._actionButtons.push({
                el: manualToggle,
                handler: this._boundHandlers.manualToggle
            });
        }
        bindBtn('btn-manual-location', () => {
            const lat = parseFloat(this.ui.inputLat?.value);
            const lon = parseFloat(this.ui.inputLon?.value);
            this.setManualLocation(lat, lon);
        });

        // DMS paste input — auto-fills the decimal lat/lon fields
        if (this.ui.inputDms) {
            this._boundHandlers.dmsInput = () => {
                const parsed = this._parseDMS(this.ui.inputDms.value);
                if (parsed) {
                    if (this.ui.inputLat) this.ui.inputLat.value = parsed.lat.toFixed(6);
                    if (this.ui.inputLon) this.ui.inputLon.value = parsed.lon.toFixed(6);
                }
            };
            this.ui.inputDms.addEventListener('input', this._boundHandlers.dmsInput);
        }

        // Min elevation slider
        if (this.ui.minElSlider) {
            this._boundHandlers.minElInput = (e) => {
                if (this.ui.minElDisplay) this.ui.minElDisplay.textContent = e.target.value;
                this._lastVisibleCountMs = 0;
                if (this.currentSimDate) this._updateVisibleCount(this.currentSimDate);
                if (this.selected) this.predictPasses(this.selected.layer, this.selected.index);
                this.updateStarlinkVisibilityHighlights(); // keep highlight in sync with slider
            };
            this.ui.minElSlider.addEventListener('input', this._boundHandlers.minElInput);
        }

        // Visibility highlight toggle
        if (this.ui.toggleVisHighlight) {
            this._boundHandlers.visHighlightChange = () => {
                this.updateStarlinkVisibilityHighlights();
            };
            this.ui.toggleVisHighlight.addEventListener(
                'change',
                this._boundHandlers.visHighlightChange
            );
        }

        // Visible count scope toggle
        if (this.ui.visibleScopeBtn) {
            this._boundHandlers.scopeToggle = () => {
                this._visibleCountScope =
                    this._visibleCountScope === 'starlink' ? 'all' : 'starlink';
                if (this.ui.visibleScopeBtn) {
                    this.ui.visibleScopeBtn.textContent =
                        this._visibleCountScope === 'starlink' ? 'Starlink \u25BE' : 'All \u25BE';
                }
                this._lastVisibleCountMs = 0;
                if (this.currentSimDate) this._updateVisibleCount(this.currentSimDate);
            };
            this.ui.visibleScopeBtn.addEventListener('click', this._boundHandlers.scopeToggle);
            this._actionButtons.push({
                el: this.ui.visibleScopeBtn,
                handler: this._boundHandlers.scopeToggle
            });
        }
    }

    // ========================================================================
    // SEARCH
    // ========================================================================

    /**
     * Performs satellite search and updates results UI.
     * @param {string} val - Search query
     */
    performSearch(val) {
        const results = this.ui.searchResults;
        results.innerHTML = '';
        if (this.ui.searchCount) this.ui.searchCount.textContent = '';
        val = val.toLowerCase();
        if (val.length < CONSTANTS.SEARCH_MIN_CHARS) return;

        try {
            const allMatches = this.allSatIndex.filter(
                (item) => item.name && item.name.toLowerCase().includes(val)
            );
            const matches = allMatches.slice(0, CONSTANTS.SEARCH_MAX_RESULTS);

            if (this.ui.searchCount && allMatches.length > 0) {
                this.ui.searchCount.textContent =
                    allMatches.length > CONSTANTS.SEARCH_MAX_RESULTS
                        ? `Showing ${CONSTANTS.SEARCH_MAX_RESULTS} of ${allMatches.length} matches`
                        : `${allMatches.length} match${allMatches.length !== 1 ? 'es' : ''}`;
            }

            matches.forEach((m) => {
                const div = document.createElement('div');
                div.className = 'search-item';
                div.style.cssText =
                    'display:flex; justify-content:space-between; align-items:center;';
                div.dataset.layer = m.layer;
                div.dataset.index = m.index;

                // Name with matched text highlighted
                const nameSpan = document.createElement('span');
                nameSpan.style.cssText =
                    'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                const name = m.name;
                const matchIdx = name.toLowerCase().indexOf(val);
                if (matchIdx !== -1) {
                    nameSpan.appendChild(document.createTextNode(name.slice(0, matchIdx)));
                    const mark = document.createElement('mark');
                    mark.style.cssText =
                        'background:rgba(51,170,255,0.35); color:inherit; border-radius:2px; padding:0 1px;';
                    mark.textContent = name.slice(matchIdx, matchIdx + val.length);
                    nameSpan.appendChild(mark);
                    nameSpan.appendChild(
                        document.createTextNode(name.slice(matchIdx + val.length))
                    );
                } else {
                    nameSpan.textContent = name;
                }

                const labelSpan = document.createElement('span');
                labelSpan.style.cssText =
                    'color:var(--ui-subtext); font-size:10px; white-space:nowrap; margin-left:8px; flex-shrink:0;';
                labelSpan.textContent = `[${this.layers[m.layer].label}]`;

                div.appendChild(nameSpan);
                div.appendChild(labelSpan);
                results.appendChild(div);
            });
        } catch (error) {
            handleError('Search', error);
        }
    }

    // ========================================================================
    // SELECTION
    // ========================================================================

    /**
     * Resets the current satellite selection.
     */
    resetSelection() {
        this._generation++;
        if (!this.selected) return;
        try {
            const { layer, index } = this.selected;
            const mesh = this.layerMeshes[layer];
            if (mesh) {
                const colors = mesh.geometry.attributes.color;
                colors.setXYZ(index, 1, 1, 1);
                colors.needsUpdate = true;
            }
            this.selected = null;
            this.followMode = false;
            const followBtn = document.getElementById('btn-follow');
            if (followBtn) followBtn.classList.remove('active');
            this.removeSatelliteLabel();
            this.ui.tooltip.style.display = 'none';
            this.controls.autoRotate = this.autoRotateEnabled;
            this.orbitPathLine.visible = false;
            this.ui.searchBox.value = '';
            if (this.ui.passInfo) this.ui.passInfo.textContent = '';
            if (this.ui.selectedPassPanel) this.ui.selectedPassPanel.style.display = 'none';
            if (this.ui.passTableContainer) this.ui.passTableContainer.innerHTML = '';
        } catch (error) {
            handleError('Reset selection', error);
        }
    }

    /**
     * Toggles camera auto-rotation on/off, respecting user preference across deselects.
     */
    toggleAutoRotate() {
        this.autoRotateEnabled = !this.autoRotateEnabled;
        if (!this.selected) {
            this.controls.autoRotate = this.autoRotateEnabled;
        }
        const btn = document.getElementById('btn-auto-rotate');
        if (btn) btn.classList.toggle('active', this.autoRotateEnabled);
    }

    /**
     * Selects a satellite by layer and index.
     * @param {string} layerKey - Layer identifier
     * @param {number} index - Satellite index
     */
    selectSatellite(layerKey, index) {
        if (!Number.isInteger(index) || index < 0 || !this.layerData[layerKey]?.satData[index])
            return;
        this._generation++;
        try {
            if (this.selected) {
                const prev = this.selected;
                const prevMesh = this.layerMeshes[prev.layer];
                if (prevMesh) {
                    prevMesh.geometry.attributes.color.setXYZ(prev.index, 1, 1, 1);
                    prevMesh.geometry.attributes.color.needsUpdate = true;
                }
            }
            this.selected = { layer: layerKey, index };
            this.ui.searchResults.innerHTML = '';
            this.ui.searchBox.value = '';
            this.ui.searchBox.blur();
            if (document.activeElement) document.activeElement.blur();
            this.controls.autoRotate = false;

            const mesh = this.layerMeshes[layerKey];
            if (!mesh) return;
            const colors = mesh.geometry.attributes.color;
            colors.setXYZ(index, 0, 1, 0);
            colors.needsUpdate = true;

            // Trigger pass prediction if observer is set
            if (this.observerLocation) {
                this.predictPasses(layerKey, index);
            }
        } catch (error) {
            handleError('Select satellite', error);
        }
    }

    // ========================================================================
    // FOCUS / FOLLOW / LABELS
    // ========================================================================

    /**
     * Returns the world position of a satellite from its mesh geometry.
     * @param {string} layerKey - Layer identifier
     * @param {number} index - Satellite index
     * @returns {THREE.Vector3|null}
     */
    getSatelliteWorldPosition(layerKey, index) {
        const mesh = this.layerMeshes[layerKey];
        if (!mesh) return null;
        const pos = mesh.geometry.attributes.position;
        if (!pos || index >= pos.count) return null;
        return new THREE.Vector3(pos.getX(index), pos.getY(index), pos.getZ(index));
    }

    /**
     * Smoothly moves the camera to focus on the currently selected satellite.
     */
    focusOnSatellite() {
        if (!this.selected) return;
        const pos = this.getSatelliteWorldPosition(this.selected.layer, this.selected.index);
        if (!pos || pos.lengthSq() === 0) return;

        const targetDist = 0.15; // ~150 km above surface in render scale
        const endPos = pos
            .clone()
            .normalize()
            .multiplyScalar(pos.length() + targetDist);

        this._cameraAnim = {
            start: this.camera.position.clone(),
            end: endPos,
            target: pos.clone(),
            startTime: performance.now(),
            duration: 800
        };
    }

    /**
     * Toggles the follow-camera mode for the selected satellite.
     */
    toggleFollowMode() {
        this.followMode = !this.followMode;
        const btn = document.getElementById('btn-follow');
        if (btn) btn.classList.toggle('active', this.followMode);
        if (this.followMode && this.selected) {
            this.controls.autoRotate = false;
        }
    }

    /**
     * Updates the camera animation (smooth focus transition).
     */
    updateCameraAnimation() {
        if (!this._cameraAnim) return;
        const { start, end, target, startTime, duration } = this._cameraAnim;
        const t = Math.min(1, (performance.now() - startTime) / duration);
        // Smooth ease-out
        const ease = 1 - Math.pow(1 - t, 3);
        this.camera.position.lerpVectors(start, end, ease);
        this.controls.target.lerp(target, ease);
        if (t >= 1) this._cameraAnim = null;
    }

    /**
     * Updates the follow-camera to track the selected satellite.
     */
    updateFollowMode() {
        if (!this.followMode || !this.selected) return;
        const pos = this.getSatelliteWorldPosition(this.selected.layer, this.selected.index);
        if (!pos || pos.lengthSq() === 0) return;
        // Keep the camera offset constant but shift it to follow the satellite
        const offset = this.camera.position.clone().sub(this.controls.target);
        this.controls.target.copy(pos);
        this.camera.position.copy(pos).add(offset);
    }

    /**
     * Creates or updates the CSS2D label for the selected/hovered satellite.
     */
    updateSatelliteLabel() {
        if (!this.labelsEnabled) {
            this.removeSatelliteLabel();
            return;
        }

        const camDist = this.camera.position.length();
        // Only show labels when zoomed in reasonably (default camera ~37 units)
        if (camDist > 50) {
            this.removeSatelliteLabel();
            return;
        }

        const target = this.selected || this.hovered;
        if (!target) {
            this.removeSatelliteLabel();
            return;
        }

        const pos = this.getSatelliteWorldPosition(target.layer, target.index);
        if (!pos || pos.lengthSq() === 0) {
            this.removeSatelliteLabel();
            return;
        }

        const layerData = this.layerData[target.layer];
        const name = layerData ? layerData.satNames[target.index] || 'Unknown' : 'Unknown';

        if (!this._satLabel) {
            const div = document.createElement('div');
            div.style.cssText =
                'color:white; background:rgba(0,0,0,0.8); padding:4px 8px; border-radius:4px; font-size:11px; font-family:system-ui,sans-serif; white-space:nowrap; pointer-events:none; transform:translateY(-20px);';
            this._satLabel = new CSS2DObject(div);
            this.scene.add(this._satLabel);
        }
        this._satLabel.element.textContent = name;
        this._satLabel.position.copy(pos);
        this._satLabel.visible = true;
    }

    /**
     * Removes the CSS2D satellite label from the scene.
     */
    removeSatelliteLabel() {
        if (this._satLabel) {
            this._satLabel.visible = false;
        }
    }

    /**
     * Toggles satellite label visibility.
     */
    toggleLabels() {
        this.labelsEnabled = !this.labelsEnabled;
        const btn = document.getElementById('btn-labels');
        if (btn) btn.classList.toggle('active', this.labelsEnabled);
        saveLabelsPreference(this.labelsEnabled);
    }

    // ========================================================================
    // ASTRONOMICAL CALCULATIONS
    // ========================================================================

    /**
     * Calculates the Sun's position and updates shaders.
     * @param {Date} date - The date/time
     */
    calculateSunPosition(date) {
        try {
            const sunDir = calculateSunDirection(date, satellite.gstime);
            const sunVec = new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z);
            this.sunPosition.copy(sunVec);

            if (this.earthMat && this.earthMat.uniforms) {
                this.earthMat.uniforms.sunDirection.value.copy(sunVec);
            }
            if (this.atmoMat && this.atmoMat.uniforms) {
                this.atmoMat.uniforms.sunDirection.value.copy(sunVec);
            }
            if (this.sunLight) this.sunLight.position.copy(sunVec).multiplyScalar(100);

            this.ui.time.innerText = date.toISOString().split('T')[1].split('.')[0] + ' UTC';

            if (this.ui.localTime) {
                this.ui.localTime.innerText = date.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                });
            }
        } catch (error) {
            handleError('Sun position calculation', error);
        }
    }

    // ========================================================================
    // DATA LOADING
    // ========================================================================

    /**
     * Loads TLE data for all constellation layers.
     */
    async loadData() {
        this.updateStatus('Acquiring orbital data...', 'status-warn');
        let completed = 0;
        await Promise.allSettled(
            this.layerOrder.map(async (key) => {
                try {
                    const result = await this.dataStore.load(
                        key,
                        this.config.urls.orbitalData[key],
                        {
                            online: navigator.onLine
                        }
                    );
                    if (this.isDisposed) return;
                    if (result) this.applyOrbitalLayer(key, result);
                    else this.useSimulation(key);
                } catch (error) {
                    if (this.isDisposed) return;
                    handleError(`Load ${key}`, error);
                    this.useSimulation(key);
                }
                this.ui.progress.style.width = `${10 + (++completed / this.layerOrder.length) * 70}%`;
            })
        );
        if (this.isDisposed) return;
        await this.initTimeSync();
        if (this.isDisposed) return;
        this.createLayerMeshes();
        this._postWorkerInit();
        this.rebuildSearchIndex();
        this.restoreFromURL();
        this.updateDataHealth();
        this.updateStatus('Tracking ready', 'status-ok');
        this.ui.progress.style.width = '100%';
        this.ui.loader.classList.add('hidden');
    }

    applyOrbitalLayer(key, result) {
        this.layerData[key] = result;
        this.updateBadge(key, result.source);
    }

    useSimulation(key) {
        this.generateSimulationLayer(key);
        this.layerData[key].source = 'sim';
        this.updateBadge(key, 'sim');
    }

    updateBadge(key, source) {
        this.layers[key].source = source;
        const badge = this.ui.badges[key];
        if (!badge) return;
        const data = this.layerData[key];
        badge.className = `source-badge ${source}`;
        badge.textContent =
            source === 'live'
                ? data?.rejected
                    ? 'LIVE · PARTIAL'
                    : 'LIVE'
                : source === 'cached'
                  ? 'SAVED'
                  : 'SIM';
        badge.title =
            source === 'sim'
                ? 'Illustrative orbits; not actual satellites'
                : `${data?.fetchedAt ? 'Downloaded ' + new Date(data.fetchedAt).toLocaleString() : 'Download time unknown'}. ${data?.warning || ''}`;
    }

    /** Quiet, once-per-second telemetry; orbital age is relative to the view clock. */
    updateDataHealth() {
        if (this.ui.clockStatus) {
            const mode = this.clock.paused
                ? 'PAUSED'
                : this.clock.mode === 'shared'
                  ? 'SHARED TIME'
                  : this.clock.mode === 'live'
                    ? 'NOW'
                    : `${this.clock.speed}× TIME`;
            this.ui.clockStatus.textContent = `${mode} · ${this.clock.source}`;
        }
        const counts = { live: 0, cached: 0, sim: 0 };
        for (const key of this.layerOrder) {
            const data = this.layerData[key];
            if (data?.source in counts) counts[data.source]++;
        }
        if (this.ui.dataHealth)
            this.ui.dataHealth.textContent = `${counts.live} live · ${counts.cached} saved · ${counts.sim} simulated layers`;
        if (this.ui.selectedEpoch) {
            const sat =
                this.selected && this.layerData[this.selected.layer]?.satData[this.selected.index];
            this.ui.selectedEpoch.textContent = sat
                ? describeEpoch(sat.epochMs, this.clock.now())
                : 'Select a satellite to inspect its orbital epoch';
            this.ui.selectedEpoch.classList.toggle(
                'epoch-stale',
                !!sat?.epochMs && Math.abs(this.clock.now() - sat.epochMs) > 72 * 3600000
            );
            this.ui.selectedEpoch.title = sat?.epochMs
                ? `Orbital epoch: ${new Date(sat.epochMs).toISOString()}. Larger time gaps can reduce position accuracy.`
                : '';
        }
    }

    /**
     * Generates simulated satellite data for a layer.
     * @param {string} layerKey - Layer identifier
     */
    generateSimulationLayer(layerKey) {
        const shells = CONSTANTS.SIM_SHELLS[layerKey] || [];
        const satData = [];
        const satNames = [];
        let id = 0;

        shells.forEach((shell) => {
            const planes = Math.max(1, Math.round(Math.sqrt(shell.count)));
            const perPlane = Math.ceil(shell.count / planes);
            for (let p = 0; p < planes; p++) {
                const raan = (p / planes) * 360;
                for (let s = 0; s < perPlane; s++) {
                    if (satData.length >= shell.count) break;
                    const anomaly = (s / perPlane) * 360 + (p % 2) * 5;
                    satData.push(new SimulatedOrbit(shell.alt, shell.inc, raan, anomaly));
                    satNames.push(`${this.layers[layerKey].label.toUpperCase()}-SIM-${++id}`);
                }
            }
        });

        this.layerData[layerKey] = { satData, satNames };
        this.updateStatus(`${this.layers[layerKey].label}: Simulated`, 'status-warn');
    }

    /**
     * Initializes time synchronization.
     */
    async initTimeSync() {
        await this.clock.synchronize({ signal: this._lifetime.signal });
    }

    /**
     * Updates the status indicator in the UI.
     * @param {string} msg - Status message
     * @param {string} cssClass - CSS class for indicator color
     */
    updateStatus(msg, cssClass) {
        this.ui.statusText.innerText = msg;
        this.ui.statusDot.className = `status-indicator ${cssClass}`;
    }

    /**
     * Refreshes all TLE data from remote sources.
     */
    async refreshData() {
        if (this._refreshing || this.isDisposed) return;
        this._refreshing = true;
        this.updateStatus('Refreshing orbital data...', 'status-warn');
        try {
            const results = await Promise.allSettled(
                this.layerOrder.map((key) =>
                    this.dataStore.load(key, this.config.urls.orbitalData[key], {
                        force: true,
                        online: navigator.onLine
                    })
                )
            );
            if (this.isDisposed) return;
            const previous = this.selected;
            const wasFollowing = this.followMode;
            const selectedId =
                previous && this.layerData[previous.layer]?.satData[previous.index]?.catalogId;
            this._generation++;
            this.resetSelection();
            this.hovered = null;
            let fresh = 0;
            results.forEach((result, index) => {
                if (result.status !== 'fulfilled' || !result.value) return;
                const data = result.value;
                const key = this.layerOrder[index];
                // A failed refresh must not replace newer in-memory data with an older cache.
                if (
                    data.source === 'live' ||
                    !this.layerData[key]?.fetchedAt ||
                    data.fetchedAt >= this.layerData[key].fetchedAt
                )
                    this.applyOrbitalLayer(key, data);
                if (data.source === 'live' && !data.rejected) fresh++;
            });
            this.createLayerMeshes();
            this._postWorkerInit();
            this.rebuildSearchIndex();
            if (selectedId) {
                const index = this.layerData[previous.layer].satData.findIndex(
                    (sat) => sat.catalogId === selectedId
                );
                if (index >= 0) {
                    this.selectSatellite(previous.layer, index);
                    this.followMode = wasFollowing;
                    document.getElementById('btn-follow')?.classList.toggle('active', wasFollowing);
                }
            }
            this.updateDataHealth();
            this.updateStatus(
                fresh === this.layerOrder.length
                    ? 'All layers refreshed'
                    : fresh
                      ? `Partial refresh · ${fresh}/${this.layerOrder.length} layers updated`
                      : 'Refresh unavailable · previous data retained',
                fresh === this.layerOrder.length ? 'status-ok' : 'status-warn'
            );
        } finally {
            this._refreshing = false;
        }
    }

    async handleRefresh() {
        const btn = document.getElementById('btn-refresh');
        if (btn) btn.disabled = true;
        try {
            await this.refreshData();
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ========================================================================
    // MESH MANAGEMENT
    // ========================================================================

    /**
     * Creates Three.js point meshes for all satellite layers.
     */
    createLayerMeshes() {
        Object.keys(this.layerMeshes).forEach((key) => {
            const m = this.layerMeshes[key];
            if (!m) return;
            this.scene.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (m.material) m.material.dispose();
        });
        this.layerMeshes = {};
        this.layerFade = {};

        this.layerOrder.forEach((layerKey) => {
            const layer = this.layerData[layerKey];
            if (!layer) {
                this.layerData[layerKey] = { satData: [], satNames: [] };
                return;
            }

            const count = layer.satData.length;
            const geometry = new THREE.BufferGeometry();
            const pos = new Float32Array(count * 3);
            const color = new Float32Array(count * 3);

            for (let i = 0; i < pos.length; i++) {
                pos[i] = 0;
                color[i] = 1;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
            const sizes = new Float32Array(count);
            sizes.fill(1.0);
            geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uBaseSize: { value: this.pointSize },
                    opacity: { value: 1.0 }
                },
                vertexShader: `
                    attribute float aSize;
                    varying vec3 vColor;
                    uniform float uBaseSize;
                    void main() {
                        vColor = color;
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_PointSize = uBaseSize * aSize;
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform float opacity;
                    varying vec3 vColor;
                    void main() {
                        float dist = length(gl_PointCoord - vec2(0.5));
                        if (dist > 0.5) discard;
                        gl_FragColor = vec4(vColor, opacity);
                    }
                `,
                vertexColors: true,
                transparent: true,
                depthWrite: false
            });

            const points = new THREE.Points(geometry, material);
            points.frustumCulled = false;
            const startEnabled = !!this.layers[layerKey].enabled;
            points.visible = startEnabled;
            points.userData.layerKey = layerKey;

            this.layerFade[layerKey] = {
                alpha: startEnabled ? 1.0 : 0.0,
                target: startEnabled ? 1.0 : 0.0
            };
            material.uniforms.opacity.value = this.layerFade[layerKey].alpha;

            this.layerMeshes[layerKey] = points;
            this.scene.add(points);
        });
    }

    /**
     * Rebuilds the search index from all satellite layers.
     */
    rebuildSearchIndex() {
        this.allSatIndex = [];
        this.layerOrder.forEach((layerKey) => {
            const names = (this.layerData[layerKey] && this.layerData[layerKey].satNames) || [];
            for (let i = 0; i < names.length; i++) {
                this.allSatIndex.push({ name: names[i], layer: layerKey, index: i });
            }
        });
    }

    // ========================================================================
    // PHYSICS & RENDERING UPDATE
    // ========================================================================

    /**
     * Dispatches physics work to the Web Worker, or falls back to synchronous update.
     */
    updatePhysics() {
        if (!this.isInitialized) return;
        if (this.paused) return;

        const now = performance.now();
        const rate = 1000 / this.effectivePhysicsHz;
        if (now - this.lastPhysicsUpdate < rate) return;
        this.lastPhysicsUpdate = now;

        try {
            const simDate = new Date(this.clock.now());
            this.currentSimDate = simDate;

            // Sun position update always stays on main thread (drives shaders + UI)
            this.calculateSunPosition(simDate);

            // Visible count update (throttled internally)
            this._updateVisibleCount(simDate);

            // Orbit path for selected satellite stays on main thread (Three.js geometry)
            if (this.selected && this.ui.checkOrbit.checked) {
                this.updateOrbitPath(this.selected.layer, this.selected.index, simDate);
            } else {
                this.orbitPathLine.visible = false;
            }

            if (this.workerAvailable && !this.workerBusy) {
                this.workerBusy = true;
                const layerActive = {};
                for (const key of this.layerOrder) {
                    layerActive[key] =
                        !!this.layers[key].enabled &&
                        (!this.ui.layers[key] || this.ui.layers[key].checked);
                }
                this.worker.postMessage({
                    type: 'update',
                    generation: this._generation,
                    simDateMs: simDate.getTime(),
                    selected: this.selected
                        ? { layer: this.selected.layer, index: this.selected.index }
                        : null,
                    hovered: this.hovered
                        ? { layer: this.hovered.layer, index: this.hovered.index }
                        : null,
                    layerActive,
                    starlinkActiveCount: this._getStarlinkActiveCount(),
                    observer: this.observerLocation
                        ? {
                              lat: this.observerLocation.lat * (Math.PI / 180),
                              lon: this.observerLocation.lon * (Math.PI / 180),
                              alt: 0
                          }
                        : null,
                    highlightVisible: this.highlightVisible,
                    minElevation: this.ui.minElSlider
                        ? parseFloat(this.ui.minElSlider.value)
                        : CONSTANTS.PASS_MIN_ELEVATION_DEG
                });
            } else if (!this.workerAvailable) {
                this._updatePhysicsSync(simDate);
            }
        } catch (error) {
            handleError('Physics update', error);
        }
    }

    /**
     * Synchronous fallback: updates satellite positions and visual states on the main thread.
     * Used when the Web Worker is unavailable.
     */
    _updatePhysicsSync(simDate) {
        try {
            const gmst = satellite.gstime(simDate);
            const sunVec = this.sunPosition;

            let totalActive = 0;
            let lit = 0,
                dark = 0;
            let issPosition = null;
            let issShadow = 0;

            // Visibility highlight setup
            const syncHighlight = this.highlightVisible && !!this.observerLocation;
            const syncMinEl = this.ui.minElSlider
                ? parseFloat(this.ui.minElSlider.value)
                : CONSTANTS.PASS_MIN_ELEVATION_DEG;
            const syncObserver = syncHighlight
                ? {
                      lat: this.observerLocation.lat * (Math.PI / 180),
                      lon: this.observerLocation.lon * (Math.PI / 180),
                      alt: 0
                  }
                : null;

            for (const layerKey of this.layerOrder) {
                const mesh = this.layerMeshes[layerKey];
                const layer = this.layerData[layerKey];
                if (!mesh || !layer) continue;

                const enabled =
                    !!this.layers[layerKey].enabled &&
                    (!this.ui.layers[layerKey] || this.ui.layers[layerKey].checked);
                mesh.visible = enabled;
                if (!enabled) continue;

                const positions = mesh.geometry.attributes.position;
                const colors = mesh.geometry.attributes.color;

                const totalCount = layer.satData.length;
                let activeCount = totalCount;

                if (layerKey === 'starlink') {
                    activeCount = Math.floor(totalCount * (this.ui.slider.value / 100));
                }

                const baseC = this.layers[layerKey].color;
                const darkC = {
                    r: baseC.r * CONSTANTS.ECLIPSE_DIM_FACTOR,
                    g: baseC.g * CONSTANTS.ECLIPSE_DIM_FACTOR,
                    b: baseC.b * CONSTANTS.ECLIPSE_DIM_FACTOR
                };

                for (let i = 0; i < activeCount; i++) {
                    const sat = layer.satData[i];
                    let x, y, z, vX, vY, vZ;
                    let eciPos = null;

                    if (sat.isSimulated) {
                        const pos = sat.getPos(simDate);
                        x = pos.x;
                        y = pos.y;
                        z = pos.z;
                    } else {
                        try {
                            const pv = satellite.propagate(sat, simDate);
                            if (validPV(pv)) {
                                eciPos = pv.position;
                                vX = pv.velocity.x;
                                vY = pv.velocity.y;
                                vZ = pv.velocity.z;
                                const gd = satellite.eciToGeodetic(pv.position, gmst);
                                const alt =
                                    (CONSTANTS.EARTH_RADIUS_KM + gd.height) *
                                    CONSTANTS.RENDER_SCALE;
                                const phi = gd.latitude;
                                const theta = gd.longitude;
                                x = alt * Math.cos(phi) * Math.sin(theta);
                                y = alt * Math.sin(phi);
                                z = alt * Math.cos(phi) * Math.cos(theta);
                            } else {
                                positions.setXYZ(i, 0, 0, 0);
                                continue;
                            }
                        } catch (e) {
                            positions.setXYZ(i, 0, 0, 0);
                            continue;
                        }
                    }

                    positions.setXYZ(i, x, y, z);
                    totalActive++;

                    const xKm = x / CONSTANTS.RENDER_SCALE;
                    const yKm = y / CONSTANTS.RENDER_SCALE;
                    const zKm = z / CONSTANTS.RENDER_SCALE;
                    const shadow = computeShadowFactorKm(xKm, yKm, zKm, sunVec);

                    if (shadow > CONSTANTS.UMBRA_THRESHOLD) dark++;
                    else lit++;

                    const isISS =
                        layerKey === 'iss' && (sat.catalogId === '25544' || sat.isSimulated);

                    if (isISS) {
                        issPosition = { x, y, z };
                        issShadow = shadow;
                    }

                    const isSelected =
                        this.selected &&
                        this.selected.layer === layerKey &&
                        this.selected.index === i;
                    const isHovered =
                        this.hovered && this.hovered.layer === layerKey && this.hovered.index === i;

                    if (isSelected) {
                        colors.setXYZ(i, 0, 1, 0);
                        this.updateTooltip(
                            layerKey,
                            i,
                            Math.sqrt(xKm * xKm + yKm * yKm + zKm * zKm),
                            vX !== undefined ? Math.sqrt(vX * vX + vY * vY + vZ * vZ) : 0,
                            shadow,
                            true
                        );
                    } else if (isHovered) {
                        colors.setXYZ(i, 0, 1, 1);
                        this.updateTooltip(
                            layerKey,
                            i,
                            Math.sqrt(xKm * xKm + yKm * yKm + zKm * zKm),
                            vX !== undefined ? Math.sqrt(vX * vX + vY * vY + vZ * vZ) : 0,
                            shadow,
                            false
                        );
                    } else {
                        const t = Math.pow(shadow, CONSTANTS.SHADOW_COLOR_EXPONENT);
                        let r = baseC.r * (1 - t) + darkC.r * t;
                        let g = baseC.g * (1 - t) + darkC.g * t;
                        let b = baseC.b * (1 - t) + darkC.b * t;

                        // Visibility highlight: force visible sats to a vivid green and dim
                        // the rest. This mirrors the worker path (propagator.worker.js
                        // handleUpdate) so the appearance is identical whether propagation
                        // runs on the worker or here in the sync fallback. Point sizes are
                        // intentionally left untouched (aSize stays 1.0) to match the worker.
                        if (syncHighlight && syncObserver && eciPos) {
                            const elev = calculateElevation(syncObserver, eciPos, gmst);
                            if (elev >= syncMinEl) {
                                const hc = CONSTANTS.VIS_HIGHLIGHT_COLOR;
                                r = hc.r;
                                g = hc.g;
                                b = hc.b;
                            } else {
                                r *= CONSTANTS.VIS_DIM_FACTOR;
                                g *= CONSTANTS.VIS_DIM_FACTOR;
                                b *= CONSTANTS.VIS_DIM_FACTOR;
                            }
                        }

                        colors.setXYZ(i, r, g, b);
                    }
                }

                if (activeCount < totalCount) {
                    for (let j = activeCount; j < totalCount; j++) {
                        positions.setXYZ(j, 0, 0, 0);
                    }
                }

                mesh.geometry.setDrawRange(0, activeCount);
                mesh.geometry.boundingSphere = null;
                positions.needsUpdate = true;
                colors.needsUpdate = true;
            }

            // Update ISS sprite
            if (this.issSprite && issPosition && this.layers.iss.enabled) {
                this.issSprite.position.set(issPosition.x, issPosition.y, issPosition.z);
                this.issSprite.visible = true;
                this.issSprite.material.opacity = 1 - issShadow * 0.7;
            } else if (this.issSprite) {
                this.issSprite.visible = false;
            }

            // Update ground station marker
            if (this.groundStationMarker && this.observerLocation) {
                this.updateGroundStationMarker();
            }

            this.ui.count.innerText = totalActive;
            this.ui.lit.innerText = lit;
            this.ui.dark.innerText = dark;
        } catch (error) {
            handleError('Physics update', error);
        }
    }

    /**
     * Updates the orbit path visualization for a selected satellite.
     * @param {string} layerKey - Layer identifier
     * @param {number} index - Satellite index
     * @param {Date} startDate - Current simulation time
     */
    updateOrbitPath(layerKey, index, startDate) {
        const layer = this.layerData[layerKey];
        if (!layer) return;
        const sat = layer.satData[index];
        if (!sat) return;

        try {
            this.orbitPathLine.visible = true;
            const posArr = this.orbitPathLine.geometry.attributes.position.array;
            const steps = this.effectiveOrbitPoints;
            const durationMins = CONSTANTS.ORBIT_DURATION_MINS;
            let validPts = 0;

            for (let i = 0; i < steps; i++) {
                const future = new Date(startDate.getTime() + i * (durationMins / steps) * 60000);
                let x, y, z;

                try {
                    if (sat.isSimulated) {
                        const p = sat.getPos(future);
                        x = p.x;
                        y = p.y;
                        z = p.z;
                    } else {
                        const pv = satellite.propagate(sat, future);
                        if (validPV(pv)) {
                            const gmst = satellite.gstime(future);
                            const gd = satellite.eciToGeodetic(pv.position, gmst);
                            const alt =
                                (CONSTANTS.EARTH_RADIUS_KM + gd.height) * CONSTANTS.RENDER_SCALE;
                            x = alt * Math.cos(gd.latitude) * Math.sin(gd.longitude);
                            y = alt * Math.sin(gd.latitude);
                            z = alt * Math.cos(gd.latitude) * Math.cos(gd.longitude);
                        }
                    }
                } catch (e) {
                    /* skip point */
                }

                if (x !== undefined && !isNaN(x)) {
                    posArr[validPts * 3] = x;
                    posArr[validPts * 3 + 1] = y;
                    posArr[validPts * 3 + 2] = z;
                    validPts++;
                }
            }

            this.orbitPathLine.geometry.setDrawRange(0, validPts);
            this.orbitPathLine.geometry.attributes.position.needsUpdate = true;
        } catch (error) {
            handleError('Orbit path update', error);
            this.orbitPathLine.visible = false;
        }
    }

    /**
     * Updates tooltip with satellite information.
     * @param {string} layerKey - Layer identifier
     * @param {number} idx - Satellite index
     * @param {number} distKm - Distance from Earth center in km
     * @param {number} vel - Velocity in km/s
     * @param {number} shadow - Shadow factor (0-1)
     * @param {boolean} isLocked - Whether satellite is selected
     */
    updateTooltip(layerKey, idx, distKm, vel, shadow, isLocked) {
        const rawName = this.layerData[layerKey].satNames[idx] || 'Unknown Object';
        const alt = distKm - CONSTANTS.EARTH_RADIUS_KM;
        const velFmt = vel > 0 ? vel.toFixed(2) + ' km/s' : 'N/A';

        let eclipseStr = 'Sunlit';
        if (shadow > CONSTANTS.UMBRA_THRESHOLD) eclipseStr = 'Umbra';
        else if (shadow > CONSTANTS.PENUMBRA_MIN_THRESHOLD) eclipseStr = 'Penumbra';

        this.ui.tooltip.style.display = 'block';
        const els = this.ui.tooltipElements;
        els.name.textContent = rawName;
        els.layer.textContent = `Layer: ${this.layers[layerKey].label}`;
        const sat = this.layerData[layerKey].satData[idx];
        els.id.textContent = sat.catalogId ? `NORAD: ${sat.catalogId}` : 'Illustrative satellite';
        els.alt.textContent = `Alt: ${alt.toFixed(1)} km`;
        els.vel.textContent = `Vel: ${velFmt}`;
        els.light.textContent = `Light: ${eclipseStr}`;
        els.locked.style.display = isLocked ? 'block' : 'none';
    }

    // ========================================================================
    // ANIMATION LOOP
    // ========================================================================

    /**
     * Smoothly animates constellation layer opacity when toggled on or off.
     */
    updateLayerFades() {
        for (const key of this.layerOrder) {
            const fade = this.layerFade?.[key];
            const mesh = this.layerMeshes[key];
            if (!fade || !mesh) continue;
            const diff = fade.target - fade.alpha;
            if (Math.abs(diff) > 0.005) {
                fade.alpha += diff * 0.12;
            } else {
                fade.alpha = fade.target;
                if (fade.target === 0) mesh.visible = false;
            }
            if (mesh.material.uniforms) {
                mesh.material.uniforms.opacity.value = fade.alpha;
            } else {
                mesh.material.opacity = fade.alpha;
            }
        }
    }

    /**
     * Main animation loop.
     */
    animate() {
        if (this.isDisposed) return;
        requestAnimationFrame(() => this.animate());
        try {
            // Scale control sensitivity to camera distance so close-up movement stays controllable.
            const now = performance.now();
            const camDist = this.camera.position.length();
            this._updateEarthLOD(camDist, now);
            const factor = Math.max(0.05, Math.min(3, (camDist * camDist) / 200));
            this.controls.rotateSpeed = 0.5 * factor;
            this.controls.panSpeed = 0.4 * factor;
            this.controls.zoomSpeed = 0.6 * factor;
            // Scale satellite point size inversely with camera distance so they
            // remain visible when zoomed in close to the globe surface.
            const refDist = CONSTANTS.CAMERA_INITIAL_DISTANCE;
            const sizeScale = Math.max(1, (refDist / camDist) * (refDist / camDist));
            const renderSize = this.pointSize * sizeScale;
            Object.values(this.layerMeshes).forEach((mesh) => {
                if (mesh && mesh.material && mesh.material.uniforms) {
                    mesh.material.uniforms.uBaseSize.value = renderSize;
                }
            });
            // Scale ground station marker with camera distance
            if (this.groundStationMarker) {
                const pinScale = camDist / refDist;
                this.groundStationMarker.scale.setScalar(pinScale);
            }
            this.updateCameraAnimation();
            this.updateFollowMode();
            this.controls.update();
            // Frame-rate independent decorative cloud drift (desktop-only mesh).
            if (this.cloudMesh) {
                const last = this._lastAnimTime || now;
                const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
                this.cloudMesh.rotation.y =
                    (this.cloudMesh.rotation.y + CONSTANTS.EARTH_CLOUD_DRIFT_RAD_PER_SEC * dt) %
                    (Math.PI * 2);
            }
            this._lastAnimTime = now;
            this.updatePhysics();
            if (now - this._lastFreshnessUpdate > 1000) {
                this._lastFreshnessUpdate = now;
                this.updateDataHealth();
            }
            this.checkRaycast();
            this.updateLayerFades();
            this.updateSatelliteLabel();
            this.renderer.render(this.scene, this.camera);
            this.css2dRenderer.render(this.scene, this.camera);
        } catch (error) {
            handleError('Animation frame', error);
        }
    }

    /**
     * Checks for satellite hover interactions via raycasting.
     */
    checkRaycast() {
        if (!this.mouseMoved || !this.isInitialized) return;

        const now = performance.now();
        if (now - this.lastRaycastUpdate < 1000 / this.effectiveRaycastHz) return;
        this.lastRaycastUpdate = now;
        this.mouseMoved = false;

        try {
            const objs = this.layerOrder
                .map((k) => this.layerMeshes[k])
                .filter((m) => m && m.visible);

            if (this.issSprite && this.issSprite.visible) {
                objs.push(this.issSprite);
            }
            if (objs.length === 0) return;

            this.raycaster.setFromCamera(this.mouse, this.camera);

            // Scale the pick threshold to match the rendered pixel size of the dots.
            // sizeAttenuation:false means dots are drawn at a fixed number of screen
            // pixels regardless of depth, so a fixed world-space threshold produces a
            // wildly different screen-space hit area at different zoom levels.
            // Formula: worldUnitsPerPixel = 2 * tan(fovY/2) * camDist / viewportHeight
            const camDist = this.camera.position.length();
            const fovY = THREE.MathUtils.degToRad(this.camera.fov);
            const vh = this.renderer.domElement.clientHeight || window.innerHeight;
            const worldPerPx = (2 * Math.tan(fovY / 2) * camDist) / vh;
            // Match the distance-based size scaling applied to uBaseSize in animate()
            // so the pick threshold tracks the dots' actual on-screen size at every
            // zoom level. (aSize is always 1.0, so the effective size is just this.)
            // Because sizeScale grows as the camera approaches, this also covers the
            // close-range case that previously needed a separate closeBoost hack.
            const refDist = CONSTANTS.CAMERA_INITIAL_DISTANCE;
            const sizeScale = Math.max(1, (refDist / camDist) * (refDist / camDist));
            const effectiveSize = this.pointSize * sizeScale;
            // Allow a small extra-pixel buffer so the cursor doesn't have to be
            // perfectly centred on the dot.
            this.raycaster.params.Points.threshold =
                (effectiveSize + CONSTANTS.PICK_THRESHOLD_PX_BUFFER) * worldPerPx;

            const hits = this.raycaster.intersectObjects(objs);

            // Three.js sorts hits by camera distance; sort by distanceToRay instead
            // so the dot geometrically closest to the cursor wins.
            if (hits.length > 1) hits.sort((a, b) => a.distanceToRay - b.distanceToRay);

            if (hits.length > 0) {
                const h = hits[0];
                if (h.object.userData.isISS) {
                    if (!this.hovered || this.hovered.layer !== 'iss' || this.hovered.index !== 0) {
                        this.hovered = { layer: 'iss', index: 0 };
                        document.body.style.cursor = 'pointer';
                        this.ui.tooltip.style.display = 'block';
                    }
                } else {
                    const layerKey = h.object.userData.layerKey;
                    const idx = h.index;
                    if (
                        !this.hovered ||
                        this.hovered.layer !== layerKey ||
                        this.hovered.index !== idx
                    ) {
                        this.hovered = { layer: layerKey, index: idx };
                        document.body.style.cursor = 'pointer';
                        this.ui.tooltip.style.display = 'block';
                    }
                }
            } else if (this.hovered) {
                this.hovered = null;
                document.body.style.cursor = 'default';
                if (!this.selected) {
                    this.ui.tooltip.style.display = 'none';
                }
            }
        } catch (error) {
            handleError('Raycast', error);
        }
    }

    // ========================================================================
    // GROUND STATION / OBSERVER LOCATION
    // ========================================================================

    /**
     * Opens the Leaflet map picker modal for setting observer location.
     */
    requestGroundStation() {
        this._openLocationPicker();
    }

    /**
     * Opens the Leaflet map modal for picking a location.
     */
    _openLocationPicker() {
        // Re-entry guard: ignore repeat opens (e.g. pressing 'G' while open)
        // so we don't stack duplicate listeners or maps.
        if (this._locationPickerOpen) return;

        const modal = document.getElementById('map-modal');
        const mapDiv = document.getElementById('leaflet-map');
        const coordsDiv = document.getElementById('map-modal-coords');
        const confirmBtn = document.getElementById('map-modal-confirm');
        const cancelBtn = document.getElementById('map-modal-cancel');
        const closeBtn = document.getElementById('map-modal-close');
        if (!modal || !mapDiv) return;

        // Leaflet is loaded from a CDN; if it failed to load, fall back to the
        // manual coordinate form instead of opening an empty, dead modal.
        if (typeof L === 'undefined') {
            handleError('Map picker', new Error('Leaflet failed to load'), true);
            this.updateStatus('Map unavailable \u2014 enter coordinates manually', 'status-err');
            this._showManualLocationForm();
            return;
        }

        let pendingLat = null;
        let pendingLon = null;
        let marker = null;

        // Normalize longitude into [-180, 180]; Leaflet can return values
        // outside this range when the world is panned across copies.
        const normLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
        const fmtCoords = (lat, lon) =>
            `${Math.abs(lat).toFixed(4)}\u00b0${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}\u00b0${lon >= 0 ? 'E' : 'W'}`;

        // Record a pending selection and reflect it in the UI.
        const setPending = (lat, lon) => {
            pendingLat = lat;
            pendingLon = normLon(lon);
            coordsDiv.textContent = fmtCoords(pendingLat, pendingLon);
            confirmBtn.disabled = false;
        };

        // Create (or reuse) the draggable marker and keep `pending*` in sync.
        const placeMarker = (latlng) => {
            if (marker) {
                marker.setLatLng(latlng);
            } else {
                marker = L.marker(latlng, { draggable: true }).addTo(map);
                marker.on('dragend', () => {
                    const pos = marker.getLatLng();
                    setPending(pos.lat, pos.lng);
                });
            }
        };

        // Determine initial center
        const startLat = this.observerLocation ? this.observerLocation.lat : 20;
        const startLon = this.observerLocation ? this.observerLocation.lon : 0;
        const startZoom = this.observerLocation ? 6 : 2;

        // Lazy-init or re-create the map (Leaflet doesn't like being in display:none)
        if (this._leafletMap) {
            this._leafletMap.remove();
            this._leafletMap = null;
        }

        let map;
        try {
            map = L.map(mapDiv).setView([startLat, startLon], startZoom);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 18,
                attribution: '&copy; OpenStreetMap'
            }).addTo(map);
        } catch (error) {
            // Map init failed after showing nothing yet: clean up and fall back.
            if (map) map.remove();
            this._leafletMap = null;
            handleError('Map picker', error, true);
            this.updateStatus('Map unavailable \u2014 enter coordinates manually', 'status-err');
            this._showManualLocationForm();
            return;
        }

        // Only mark the picker open once the map is live and about to be shown.
        this._locationPickerOpen = true;
        this._leafletMap = map;
        modal.style.display = '';

        // Place initial marker if location exists
        if (this.observerLocation) {
            marker = L.marker([startLat, startLon], { draggable: true }).addTo(map);
            setPending(startLat, startLon);
            marker.on('dragend', () => {
                const pos = marker.getLatLng();
                setPending(pos.lat, pos.lng);
            });
        }

        // Try geolocation to center map (non-blocking, won't move marker)
        if (!this.observerLocation && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    if (this._leafletMap === map) {
                        map.setView([position.coords.latitude, position.coords.longitude], 6);
                    }
                },
                () => {
                    /* ignore errors */
                },
                { enableHighAccuracy: false, timeout: 5000 }
            );
        }

        // Click map to place/move marker
        map.on('click', (e) => {
            setPending(e.latlng.lat, e.latlng.lng);
            placeMarker(e.latlng);
        });

        const closeModal = () => {
            modal.style.display = 'none';
            this._locationPickerOpen = false;
            if (this._leafletMap) {
                this._leafletMap.remove();
                this._leafletMap = null;
            }
        };

        // Wire up buttons
        const onConfirm = () => {
            if (pendingLat !== null && pendingLon !== null) {
                this._applyObserverLocation(pendingLat, pendingLon);
            }
            closeModal();
            cleanup();
        };
        const onCancel = () => {
            closeModal();
            cleanup();
        };
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                // Stop the global keydown handler from also clearing the
                // current satellite selection on the same press.
                e.stopPropagation();
                closeModal();
                cleanup();
            }
        };
        const onBackdrop = (e) => {
            if (e.target === modal) {
                closeModal();
                cleanup();
            }
        };

        const cleanup = () => {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            closeBtn.removeEventListener('click', onCancel);
            window.removeEventListener('keydown', onKeyDown, true);
            modal.removeEventListener('click', onBackdrop);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        closeBtn.addEventListener('click', onCancel);
        // Capture phase so we see Escape before the window-level app handler.
        window.addEventListener('keydown', onKeyDown, true);
        modal.addEventListener('click', onBackdrop);

        // Force Leaflet to recalculate size after modal is visible.
        // Guard against the modal being closed (map removed) within the delay.
        setTimeout(() => {
            if (this._leafletMap === map) map.invalidateSize();
        }, 100);
    }

    /**
     * Sets observer location from manual lat/lon input after validation.
     * @param {number} lat - Latitude in degrees (-90 to 90)
     * @param {number} lon - Longitude in degrees (-180 to 180)
     */
    setManualLocation(lat, lon) {
        if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            showErrorToast('Invalid coordinates. Lat: -90 to 90, Lon: -180 to 180');
            return;
        }
        this._applyObserverLocation(lat, lon);
    }

    /**
     * Parses a DMS coordinate string (e.g. "32°03'17.22"S 115°52'28.60"E") into
     * decimal degrees. Returns { lat, lon } or null if the string cannot be parsed.
     * @param {string} str - DMS coordinate string
     * @returns {{ lat: number, lon: number }|null}
     */
    _parseDMS(str) {
        const s = str
            .trim()
            .replace(/[\u00b0\u02da]/g, '\u00b0')
            .replace(/[\u2032\u02b9']/g, "'")
            .replace(/[\u2033\u02ba"]/g, '"');

        const re =
            /(\d+(?:\.\d+)?)\u00b0\s*(?:(\d+(?:\.\d+)?)'?\s*)?(?:(\d+(?:\.\d+)?)"?\s*)?([NSns])\s+(\d+(?:\.\d+)?)\u00b0\s*(?:(\d+(?:\.\d+)?)'?\s*)?(?:(\d+(?:\.\d+)?)"?\s*)?([EWew])/;
        const m = s.match(re);
        if (!m) return null;

        const toDec = (d, min, sec) =>
            parseFloat(d) + parseFloat(min || 0) / 60 + parseFloat(sec || 0) / 3600;

        const lat = toDec(m[1], m[2], m[3]) * (/[Ss]/.test(m[4]) ? -1 : 1);
        const lon = toDec(m[5], m[6], m[7]) * (/[Ww]/.test(m[8]) ? -1 : 1);

        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
        return { lat, lon };
    }

    /**
     * Applies an observer location: stores it, places marker, saves to localStorage,
     * shows the location panel, and re-triggers pass prediction if a sat is selected.
     * @param {number} lat - Latitude in degrees
     * @param {number} lon - Longitude in degrees
     */
    _applyObserverLocation(lat, lon) {
        this.observerLocation = { lat, lon };
        this.setupGroundStationMarker();
        this.updateGroundStationMarker(); // position immediately, don't wait for physics tick
        saveObserverLocation({ lat, lon });
        this.updateStatus(
            `Observer: ${lat.toFixed(2)}\u00b0, ${lon.toFixed(2)}\u00b0`,
            'status-ok'
        );
        showErrorToast(
            `\u{1F4CD} Location set: ${Math.abs(lat).toFixed(4)}\u00b0${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}\u00b0${lon >= 0 ? 'E' : 'W'}`
        );
        this._panCameraToMarker(lat, lon);
        if (this.ui.locationPanel) this.ui.locationPanel.style.display = '';
        if (this.selected) {
            this.predictPasses(this.selected.layer, this.selected.index);
        }
    }

    /** Rotates the camera so the placed marker faces the viewer. */
    _panCameraToMarker(lat, lon) {
        const lat_r = lat * (Math.PI / 180);
        const lon_r = lon * (Math.PI / 180);
        // Unit vector toward the marker in scene space
        const dir = new THREE.Vector3(
            Math.cos(lat_r) * Math.sin(lon_r),
            Math.sin(lat_r),
            Math.cos(lat_r) * Math.cos(lon_r)
        );
        const dist = this.camera.position.length();
        this.camera.position.copy(dir.multiplyScalar(dist));
        this.controls.update();
    }

    /**
     * Shows the manual location input form.
     */
    _showManualLocationForm() {
        if (this.ui.manualLocationForm) {
            this.ui.manualLocationForm.style.display = '';
        }
    }

    /**
     * Creates a 3D marker for the ground station on Earth's surface.
     */
    setupGroundStationMarker() {
        if (this.groundStationMarker) {
            this.scene.remove(this.groundStationMarker);
            if (this.groundStationMarker.geometry) this.groundStationMarker.geometry.dispose();
            if (this.groundStationMarker.material) this.groundStationMarker.material.dispose();
        }

        const geo = new THREE.SphereGeometry(0.12, 8, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
        this.groundStationMarker = new THREE.Mesh(geo, mat);
        this.scene.add(this.groundStationMarker);
        this._disposables.push(geo);
        this._disposables.push(mat);

        // Also add a vertical line/spike for visibility
        const lineGeo = new THREE.BufferGeometry();
        const linePos = new Float32Array(6); // 2 points
        lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
        const lineMat = new THREE.LineBasicMaterial({
            color: 0xff4444,
            opacity: 0.8,
            transparent: true
        });
        this.groundStationLine = new THREE.Line(lineGeo, lineMat);
        this.scene.add(this.groundStationLine);
        this._disposables.push(lineGeo);
        this._disposables.push(lineMat);
    }

    /**
     * Updates ground station marker position on Earth's surface.
     * The scene uses Earth-fixed (ECEF) coordinates — no GMST offset needed.
     */
    updateGroundStationMarker() {
        if (!this.observerLocation || !this.groundStationMarker) return;

        const lat = this.observerLocation.lat * (Math.PI / 180);
        const lon = this.observerLocation.lon * (Math.PI / 180);
        const alt = CONSTANTS.EARTH_RADIUS_KM * CONSTANTS.RENDER_SCALE * 1.02;

        const x = alt * Math.cos(lat) * Math.sin(lon);
        const y = alt * Math.sin(lat);
        const z = alt * Math.cos(lat) * Math.cos(lon);

        this.groundStationMarker.position.set(x, y, z);

        if (this.groundStationLine) {
            const spike = 1.08;
            const posArr = this.groundStationLine.geometry.attributes.position.array;
            posArr[0] = x;
            posArr[1] = y;
            posArr[2] = z;
            posArr[3] = x * spike;
            posArr[4] = y * spike;
            posArr[5] = z * spike;
            this.groundStationLine.geometry.attributes.position.needsUpdate = true;
        }
    }

    // ========================================================================
    // VIEWING CONE
    // ========================================================================

    // ========================================================================
    // PASS PREDICTION
    // ========================================================================

    /**
     * Predicts up to PASS_MAX_COUNT visible passes for a selected satellite and renders
     * results in the location panel pass table.
     * @param {string} layerKey - Layer identifier
     * @param {number} index - Satellite index
     * TODO: twilight filter (requires per-step sun elevation — deferred)
     */
    predictPasses(layerKey, index) {
        if (!this.observerLocation) return;

        const layer = this.layerData[layerKey];
        if (!layer) return;
        const sat = layer.satData[index];

        if (!sat || sat.isSimulated) {
            if (this.ui.passTableContainer) {
                this.ui.passTableContainer.innerHTML =
                    '<div style="font-size:11px; color:var(--ui-subtext); padding:6px 0;">Pass prediction unavailable for simulated satellites.</div>';
            }
            if (this.ui.selectedPassPanel) this.ui.selectedPassPanel.style.display = '';
            return;
        }

        try {
            const obsLat = this.observerLocation.lat * (Math.PI / 180);
            const obsLon = this.observerLocation.lon * (Math.PI / 180);
            const observer = { lat: obsLat, lon: obsLon, alt: 0 };
            const minEl = this.ui.minElSlider
                ? parseFloat(this.ui.minElSlider.value)
                : CONSTANTS.PASS_MIN_ELEVATION_DEG;

            const now = this.currentSimDate || new Date();
            const endTime = new Date(now.getTime() + CONSTANTS.PASS_PREDICTION_HOURS * 3600000);
            const stepMs = CONSTANTS.PASS_TIME_STEP_SEC * 1000;

            const passes = [];
            let inPass = false;
            let passStart = null;
            let aosAz = 0;
            let maxEl = 0;
            let maxElAz = 0;

            for (let t = now.getTime(); t < endTime.getTime(); t += stepMs) {
                const date = new Date(t);
                try {
                    const pv = satellite.propagate(sat, date);
                    if (!validPV(pv)) continue;
                    const gmst = satellite.gstime(date);
                    const el = calculateElevation(observer, pv.position, gmst);
                    const az = calculateAzimuth(observer, pv.position, gmst);

                    if (el >= minEl) {
                        if (!inPass) {
                            inPass = true;
                            passStart = date;
                            aosAz = az;
                            maxEl = el;
                            maxElAz = az;
                        }
                        if (el > maxEl) {
                            maxEl = el;
                            maxElAz = az;
                        }
                    } else if (inPass) {
                        passes.push({
                            aos: passStart,
                            los: date,
                            durationSec: Math.round((date.getTime() - passStart.getTime()) / 1000),
                            maxEl,
                            maxElAz,
                            maxElAzCard: azimuthToCardinal(maxElAz),
                            aosAz,
                            aosAzCard: azimuthToCardinal(aosAz)
                        });
                        inPass = false;
                        if (passes.length >= CONSTANTS.PASS_MAX_COUNT) break;
                    }
                } catch (e) {
                    /* skip step */
                }
            }
            // capture pass still in progress at loop end
            if (inPass && passes.length < CONSTANTS.PASS_MAX_COUNT) {
                passes.push({
                    aos: passStart,
                    los: new Date(endTime),
                    durationSec: Math.round((endTime.getTime() - passStart.getTime()) / 1000),
                    maxEl,
                    maxElAz,
                    maxElAzCard: azimuthToCardinal(maxElAz),
                    aosAz,
                    aosAzCard: azimuthToCardinal(aosAz)
                });
            }

            this._renderPassTable(passes, now);
        } catch (error) {
            handleError('Pass prediction', error);
            if (this.ui.passTableContainer) {
                this.ui.passTableContainer.innerHTML =
                    '<div style="font-size:11px; color:var(--bad);">Pass prediction error.</div>';
            }
        }
        if (this.ui.selectedPassPanel) this.ui.selectedPassPanel.style.display = '';
    }

    /**
     * Renders the pass table HTML into the pass-table-container element.
     * @param {Array} passes - Array of pass objects
     * @param {Date} now - Current sim date (for date prefix logic)
     */
    _renderPassTable(passes, now) {
        if (!this.ui.passTableContainer) return;
        if (passes.length === 0) {
            this.ui.passTableContainer.innerHTML = `<div style="font-size:11px; color:var(--ui-subtext); padding:6px 0;">No passes in next ${CONSTANTS.PASS_PREDICTION_HOURS}h.</div>`;
            return;
        }
        const todayStr = now.toISOString().slice(0, 10);
        const rows = passes
            .map((p) => {
                const aosStr = p.aos.toISOString();
                const aosDate = aosStr.slice(0, 10);
                const aosTime = aosStr.slice(11, 19);
                const timeLabel = aosDate !== todayStr ? `${aosDate.slice(5)} ${aosTime}` : aosTime;
                const mins = Math.floor(p.durationSec / 60);
                const secs = p.durationSec % 60;
                const dur = `${mins}m ${secs}s`;
                return `<tr>
                <td>${timeLabel} UTC</td>
                <td>${dur}</td>
                <td>${p.maxEl.toFixed(1)}&deg;</td>
                <td>${p.maxElAz.toFixed(0)}&deg; ${p.maxElAzCard}</td>
                <td>${p.aosAzCard}</td>
            </tr>`;
            })
            .join('');
        this.ui.passTableContainer.innerHTML = `
            <table>
                <thead><tr>
                    <th>AOS (UTC)</th><th>Duration</th><th>Max El</th>
                    <th>Dir at Max</th><th>AOS Dir</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    /**
     * Updates the "currently visible" satellite count banner.
     * Throttled to VISIBLE_COUNT_THROTTLE_MS.
     * @param {Date} simDate - Current simulation date
     */
    _updateVisibleCount(simDate) {
        if (!this.observerLocation || !this.ui.visibleCountText) return;
        const nowMs = performance.now();
        if (nowMs - this._lastVisibleCountMs < CONSTANTS.VISIBLE_COUNT_THROTTLE_MS) return;
        this._lastVisibleCountMs = nowMs;

        const minEl = this.ui.minElSlider
            ? parseFloat(this.ui.minElSlider.value)
            : CONSTANTS.PASS_MIN_ELEVATION_DEG;
        const gmst = satellite.gstime(simDate);
        const obsLat = this.observerLocation.lat * (Math.PI / 180);
        const obsLon = this.observerLocation.lon * (Math.PI / 180);
        const observer = { lat: obsLat, lon: obsLon, alt: 0 };

        let count = 0;
        const scopeKeys =
            this._visibleCountScope === 'starlink'
                ? ['starlink']
                : this.layerOrder.filter(
                      (k) =>
                          this.layers[k]?.enabled &&
                          (!this.ui.layers[k] || this.ui.layers[k].checked)
                  );

        for (const layerKey of scopeKeys) {
            const layer = this.layerData[layerKey];
            if (!layer) continue;
            for (const sat of layer.satData) {
                if (sat.isSimulated) continue;
                try {
                    const pv = satellite.propagate(sat, simDate);
                    if (!validPV(pv)) continue;
                    if (calculateElevation(observer, pv.position, gmst) >= minEl) count++;
                } catch (e) {
                    /* skip */
                }
            }
        }

        const scopeLabel = this._visibleCountScope === 'starlink' ? 'Starlink' : '';
        const label = scopeLabel ? `${count} ${scopeLabel} visible now` : `${count} visible now`;
        this.ui.visibleCountText.textContent = label;
        this.ui.visibleCountText.style.color = count > 0 ? 'var(--good)' : 'var(--ui-subtext)';
    }

    /**
     * Syncs highlight state from the checkbox and forces a visible-count refresh.
     * Called when the "Highlight visible sats" checkbox changes.
     */
    updateStarlinkVisibilityHighlights() {
        this.highlightVisible = !!this.ui.toggleVisHighlight?.checked;
        this._lastVisibleCountMs = 0;
    }

    // ========================================================================
    // EXPORT / SHARE
    // ========================================================================

    /**
     * Exports the current view as a PNG screenshot.
     */
    exportScreenshot() {
        try {
            this.renderer.render(this.scene, this.camera);
            const dataUrl = this.renderer.domElement.toDataURL('image/png');
            const link = document.createElement('a');
            link.download = `sat-track-${new Date().toISOString().slice(0, 19)}.png`;
            link.href = dataUrl;
            link.click();
        } catch (error) {
            handleError('Export screenshot', error, true);
        }
    }

    // ========================================================================
    // THEME
    // ========================================================================

    /**
     * Toggles between dark and light theme.
     */
    toggleTheme() {
        this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme(this.currentTheme);
        saveThemePreference(this.currentTheme);
    }

    /**
     * Applies the specified theme.
     * @param {string} theme - 'dark' or 'light'
     */
    applyTheme(theme) {
        if (theme === 'light') {
            document.body.classList.add('light-theme');
        } else {
            document.body.classList.remove('light-theme');
        }
    }

    // ========================================================================
    // POINT SIZE
    // ========================================================================

    /**
     * Updates the satellite point size across all layer materials and persists
     * the preference to localStorage.
     * @param {number} size - New point size in screen pixels
     */
    setPointSize(size) {
        this.pointSize = clampPointSize(size, CONSTANTS.POINT_SIZE_MIN, CONSTANTS.POINT_SIZE_MAX);
        // No need to write uBaseSize here: animate() rewrites it every frame as
        // this.pointSize * sizeScale. Writing the raw size now would be overwritten
        // next frame and could cause a one-frame pop when the camera isn't at the
        // reference distance.
        if (this.ui.pixelSizeDisplay) this.ui.pixelSizeDisplay.textContent = this.pointSize;
        savePointSizePreference(this.pointSize);
    }

    // ========================================================================
    // PAUSE / RESUME
    // ========================================================================

    /**
     * Toggles the monotonic clock without changing the current simulation instant.
     */
    togglePause() {
        this.clock.togglePause();
        this._generation++;
        this.paused = this.clock.paused;
        if (this.ui.pauseIndicator)
            this.ui.pauseIndicator.style.display = this.paused ? 'block' : 'none';
        this.updateDataHealth();
    }

    /** Return to device time with continuous 1x tracking. */
    resetToNow() {
        this.clock.reset();
        this._generation++;
        this.currentSimDate = new Date(this.clock.now());
        this.paused = false;
        if (this.ui.pauseIndicator) this.ui.pauseIndicator.style.display = 'none';
        this.ui.speedSlider.value = 1;
        this.ui.speedDisplay.textContent = '1';
        this.updateDataHealth();
    }

    // ========================================================================
    // SHAREABLE URL
    // ========================================================================

    /**
     * Returns a URL encoding the current simulation state: selected satellite,
     * camera position, and simulation time.
     * @returns {string} Shareable URL
     */
    getShareableURL() {
        const params = new URLSearchParams();

        if (this.selected) {
            const sat = this.layerData[this.selected.layer]?.satData[this.selected.index];
            if (sat?.catalogId) params.set('norad', `${this.selected.layer}:${sat.catalogId}`);
            else params.set('sat', `${this.selected.layer}:${this.selected.index}`);
        }

        if (this.camera) {
            const p = this.camera.position;
            params.set('cam', `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`);
        }

        if (this.currentSimDate) {
            params.set('t', this.currentSimDate.toISOString());
        }

        const base = `${window.location.origin}${window.location.pathname}`;
        return `${base}?${params}`;
    }

    /**
     * Copies the shareable URL for the current view to the clipboard and
     * shows a confirmation toast.
     */
    copyShareableURL() {
        const url = this.getShareableURL();
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => {
                showErrorToast('Link copied to clipboard!');
            });
        } else {
            // Fallback: prompt so the user can copy manually
            window.prompt('Copy this shareable link:', url);
        }
    }

    /**
     * Restores camera position, simulation time, and satellite selection from
     * URL query parameters (written by getShareableURL). Must be called after
     * satellite data and meshes are ready.
     */
    restoreFromURL() {
        const params = new URLSearchParams(window.location.search);

        if (params.has('cam') && this.camera) {
            const parts = params.get('cam').split(',').map(Number);
            if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
                this.camera.position.set(parts[0], parts[1], parts[2]);
                if (this.controls) this.controls.update();
            }
        }

        if (params.has('t')) {
            if (this.clock.restore(params.get('t'))) {
                this._generation++;
                this.currentSimDate = new Date(this.clock.now());
            }
        }

        if (params.has('norad')) {
            const [layer, id] = params.get('norad').split(':');
            const index = this.layerData[layer]?.satData.findIndex((sat) => sat.catalogId === id);
            if (index >= 0) this.selectSatellite(layer, index);
        } else if (params.has('sat')) {
            const [layer, idxStr] = params.get('sat').split(':');
            const index = parseInt(idxStr, 10);
            if (layer && !isNaN(index) && this.layerData[layer]) {
                this.selectSatellite(layer, index);
            }
        }
    }

    // ========================================================================
    // CAMERA RESET
    // ========================================================================

    /**
     * Resets the camera to its default position and orientation.
     */
    resetCamera() {
        this.camera.position.set(
            CONSTANTS.CAMERA_INITIAL_DISTANCE,
            CONSTANTS.CAMERA_INITIAL_DISTANCE * 0.48,
            CONSTANTS.CAMERA_INITIAL_DISTANCE
        );
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    // ========================================================================
    // CONSTELLATION CYCLE
    // ========================================================================

    /**
     * Cycles the selection to the first satellite of the next enabled
     * constellation layer.
     */
    cycleConstellationLayer() {
        const enabledLayers = this.layerOrder.filter(
            (k) =>
                this.layers[k].enabled && this.layerData[k] && this.layerData[k].satData.length > 0
        );
        if (enabledLayers.length === 0) return;
        this.cycleLayerIndex = (this.cycleLayerIndex + 1) % enabledLayers.length;
        const layerKey = enabledLayers[this.cycleLayerIndex];
        this.selectSatellite(layerKey, 0);
    }

    // ========================================================================
    // KEYBOARD OVERLAY
    // ========================================================================

    /**
     * Toggles the keyboard shortcuts help overlay.
     */
    toggleKeyboardOverlay() {
        if (!this.ui.keyboardOverlay) return;
        this.ui.keyboardOverlay.classList.toggle('visible');
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    /**
     * Disposes of all Three.js resources and removes event listeners.
     */
    dispose() {
        this.isDisposed = true;
        this._lifetime.abort();
        this.dataStore.dispose();
        this._generation++;
        // Prevent late texture onLoad callbacks from revealing/configuring torn-down meshes.
        this.cloudMesh = null;

        if (this._earthLodCache) {
            this._earthLodCache.dispose();
            this._earthLodCache = null;
        }

        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.workerAvailable = false;

        // Window listeners
        const windowEvents = ['resize', 'mouseMove', 'windowClick', 'keyDown', 'online', 'offline'];
        const windowEventMap = {
            resize: 'resize',
            mouseMove: 'mousemove',
            windowClick: 'click',
            keyDown: 'keydown',
            online: 'online',
            offline: 'offline'
        };
        windowEvents.forEach((key) => {
            if (this._boundHandlers[key]) {
                window.removeEventListener(windowEventMap[key], this._boundHandlers[key]);
            }
        });

        // UI listeners
        if (this._boundHandlers.toggleClick && this.ui.toggleBtn) {
            this.ui.toggleBtn.removeEventListener('click', this._boundHandlers.toggleClick);
        }
        if (this._boundHandlers.searchClick && this.ui.searchResults) {
            this.ui.searchResults.removeEventListener('click', this._boundHandlers.searchClick);
        }
        if (this._boundHandlers.searchInput && this.ui.searchBox) {
            this.ui.searchBox.removeEventListener('input', this._boundHandlers.searchInput);
        }
        if (this._boundHandlers.searchKeyDown && this.ui.searchBox) {
            this.ui.searchBox.removeEventListener('keydown', this._boundHandlers.searchKeyDown);
        }
        if (this._boundHandlers.speedInput && this.ui.speedSlider) {
            this.ui.speedSlider.removeEventListener('input', this._boundHandlers.speedInput);
        }
        if (this._boundHandlers.pixelSizeInput && this.ui.pixelSizeSlider) {
            this.ui.pixelSizeSlider.removeEventListener(
                'input',
                this._boundHandlers.pixelSizeInput
            );
        }
        if (this._boundHandlers.dmsInput && this.ui.inputDms) {
            this.ui.inputDms.removeEventListener('input', this._boundHandlers.dmsInput);
        }
        if (this._boundHandlers.minElInput && this.ui.minElSlider) {
            this.ui.minElSlider.removeEventListener('input', this._boundHandlers.minElInput);
        }
        if (this._boundHandlers.visHighlightChange && this.ui.toggleVisHighlight) {
            this.ui.toggleVisHighlight.removeEventListener(
                'change',
                this._boundHandlers.visHighlightChange
            );
        }

        // Action buttons
        if (this._actionButtons) {
            this._actionButtons.forEach(({ el, handler }) => {
                el.removeEventListener('click', handler);
            });
            this._actionButtons = [];
        }

        // Layer toggles
        this.layerOrder.forEach((key) => {
            const handler = this._boundHandlers[`layer_${key}`];
            const el = this.ui.layers[key];
            if (handler && el) el.removeEventListener('change', handler);
        });

        // Three.js objects
        Object.values(this.layerMeshes).forEach((mesh) => {
            if (mesh) {
                this.scene.remove(mesh);
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) mesh.material.dispose();
            }
        });

        this._disposables.forEach((obj) => {
            if (obj && typeof obj.dispose === 'function') obj.dispose();
        });

        if (this.issSprite) {
            this.scene.remove(this.issSprite);
            if (this.issSprite.material) this.issSprite.material.dispose();
        }

        if (this.groundStationMarker) {
            this.scene.remove(this.groundStationMarker);
        }
        if (this.groundStationLine) {
            this.scene.remove(this.groundStationLine);
        }
        if (this._satLabel) {
            this.scene.remove(this._satLabel);
            this._satLabel = null;
        }

        if (this.css2dRenderer) {
            if (this.css2dRenderer.domElement && this.css2dRenderer.domElement.parentNode) {
                this.css2dRenderer.domElement.parentNode.removeChild(this.css2dRenderer.domElement);
            }
        }

        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }

        this.layerMeshes = {};
        this.layerFade = {};
        this.layerData = {};
        this.allSatIndex = [];
        this._boundHandlers = {};
        this._disposables = [];
    }
}
