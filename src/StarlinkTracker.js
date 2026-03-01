/**
 * Main satellite tracker application class.
 * @module StarlinkTracker
 */

import { CONSTANTS } from './constants.js';
import {
    computeShadowFactorKm,
    calculateSunDirection,
    SimulatedOrbit,
    calculateElevation,
    isMobileDevice,
    validateTLE,
    clampPointSize
} from './core.js';
import {
    handleError,
    showErrorToast,
    retryWithBackoff,
    createISSIcon,
    saveThemePreference,
    loadThemePreference,
    savePointSizePreference,
    loadPointSizePreference
} from './helpers.js';

/* global THREE, satellite */

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
                tle: CONSTANTS.TLE_URLS,
                tleJson: CONSTANTS.TLE_JSON_URLS
            }
        };

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
                color: new THREE.Color(1, 1, 1),
                enabled: true,
                source: 'loading'
            },
            iss: {
                label: 'ISS',
                color: new THREE.Color(1.0, 0.82, 0.4),
                enabled: true,
                source: 'loading'
            },
            gps: {
                label: 'GPS',
                color: new THREE.Color(0.15, 0.95, 0.65),
                enabled: true,
                source: 'loading'
            },
            galileo: {
                label: 'Galileo',
                color: new THREE.Color(0.55, 0.6, 0.7),
                enabled: true,
                source: 'loading'
            },
            oneweb: {
                label: 'OneWeb',
                color: new THREE.Color(0.93, 0.28, 0.44),
                enabled: true,
                source: 'loading'
            },
            iridium: {
                label: 'Iridium',
                color: new THREE.Color(0.6, 0.4, 1.0),
                enabled: true,
                source: 'loading'
            },
            glonass: {
                label: 'GLONASS',
                color: new THREE.Color(1.0, 0.5, 0.2),
                enabled: true,
                source: 'loading'
            },
            beidou: {
                label: 'BeiDou',
                color: new THREE.Color(0.9, 0.85, 0.2),
                enabled: true,
                source: 'loading'
            }
        };

        // === State Variables ===
        this.referenceTime = null;
        this.primarySatrec = null;
        this.simStartTime = performance.now();
        this.lastPhysicsUpdate = 0;
        this.lastRaycastUpdate = 0;
        this.sunPosition = new THREE.Vector3();
        this.currentSimDate = null;
        this.mouseMoved = false;
        this.isInitialized = false;
        this.isDisposed = false;

        // === Pause State ===
        this.paused = false;
        this.pauseWallTime = 0;

        // === Point Size ===
        this.pointSize = clampPointSize(
            loadPointSizePreference(CONSTANTS.POINT_SIZE_DEFAULT),
            CONSTANTS.POINT_SIZE_MIN,
            CONSTANTS.POINT_SIZE_MAX
        );

        // === Constellation Cycle State ===
        this.cycleLayerIndex = -1;

        // === Observer / Ground Station ===
        this.observerLocation = null; // { lat, lon } in degrees
        this.groundStationMarker = null;

        // === Theme ===
        this.currentTheme = loadThemePreference();

        // === Data Storage ===
        this.layerData = {};
        this.layerMeshes = {};
        this.allSatIndex = [];

        // === Selection State ===
        this.hovered = null;
        this.selected = null;

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

        // Apply initial theme
        this.applyTheme(this.currentTheme);

        this.init();
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
        document.body.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = CONSTANTS.DAMPING_FACTOR;
        this.controls.minDistance = CONSTANTS.CAMERA_MIN_DISTANCE;
        this.controls.maxDistance = CONSTANTS.CAMERA_MAX_DISTANCE;
        this.controls.autoRotate = true;
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

        const initialUniforms = {
            dayTexture: { value: loader.load(this.config.urls.earthDay) },
            nightTexture: { value: loader.load(this.config.urls.earthNight) },
            sunDirection: { value: new THREE.Vector3(1, 0, 0) }
        };

        this._disposables.push(initialUniforms.dayTexture.value);
        this._disposables.push(initialUniforms.nightTexture.value);

        this.earthMat = new THREE.ShaderMaterial({
            uniforms: initialUniforms,
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vWorldNormal;
                void main() {
                    vUv = uv;
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision mediump float;
                uniform sampler2D dayTexture;
                uniform sampler2D nightTexture;
                uniform vec3 sunDirection;
                varying vec2 vUv;
                varying vec3 vWorldNormal;
                void main() {
                    vec3 day = texture2D(dayTexture, vUv).rgb;
                    vec3 night = texture2D(nightTexture, vUv).rgb;
                    float sunDot = dot(vWorldNormal, sunDirection);
                    float mixVal = smoothstep(-0.10, 0.10, sunDot);
                    vec3 atmosphere = vec3(1.0, 0.6, 0.3);
                    float scatter = smoothstep(0.20, 0.0, abs(sunDot));
                    vec3 final = mix(night * 2.5, day, mixVal);
                    final += atmosphere * scatter * 0.5 * (1.0 - mixVal);
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
                sunDirection: { value: new THREE.Vector3(1, 0, 0) }
            },
            vertexShader: `
                varying vec3 vWorldNormal;
                varying vec3 vViewPosition;
                void main() {
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewPosition = -mvPosition.xyz;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                precision mediump float;
                uniform vec3 sunDirection;
                varying vec3 vWorldNormal;
                varying vec3 vViewPosition;
                void main() {
                    vec3 viewDir = normalize(vViewPosition);
                    float fresnel = pow(0.7 - dot(vWorldNormal, viewDir), 3.0);
                    float sunOrientation = dot(vWorldNormal, sunDirection);
                    float daySide = smoothstep(-0.30, 0.30, sunOrientation);
                    gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * fresnel * daySide * 1.5;
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
    }

    /**
     * Sets up scene lighting.
     */
    setupLighting() {
        this.scene.add(new THREE.AmbientLight(0x111111));
        this.sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
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
        };
        window.addEventListener('resize', this._boundHandlers.resize);

        // Mouse move
        this._boundHandlers.mouseMove = (e) => {
            this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            this.mouseMoved = true;
            const tip = this.ui.tooltip;
            if (tip.style.display === 'block') {
                tip.style.left = e.clientX + 20 + 'px';
                tip.style.top = e.clientY + 20 + 'px';
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
                if (this.layerMeshes[key]) this.layerMeshes[key].visible = el.checked;
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
            const items = Array.from(
                this.ui.searchResults.querySelectorAll('.search-item')
            );
            if (!items.length) return;

            const current = this.ui.searchResults.querySelector(
                '.search-item.keyboard-selected'
            );
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

        // Window click for selection
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
            if (key === 'n' || code === 'KeyN') this.resetToNow();
            if (key === 'r' || code === 'KeyR') this.resetCamera();
            if (key === 'c' || code === 'KeyC') this.cycleConstellationLayer();
        };
        window.addEventListener('keydown', this._boundHandlers.keyDown);

        // Speed slider
        this._boundHandlers.speedInput = (e) => {
            this.ui.speedDisplay.textContent = e.target.value;
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
        bindBtn('btn-theme', () => this.toggleTheme());
        bindBtn('btn-keyboard', () => this.toggleKeyboardOverlay());
        bindBtn('btn-reset-time', () => this.resetToNow());
        bindBtn('btn-share', () => this.copyShareableURL());
        bindBtn('keyboard-overlay-close', () => {
            this.ui.keyboardOverlay.classList.remove('visible');
        });
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
                div.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
                div.dataset.layer = m.layer;
                div.dataset.index = m.index;

                // Name with matched text highlighted
                const nameSpan = document.createElement('span');
                nameSpan.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                const name = m.name;
                const matchIdx = name.toLowerCase().indexOf(val);
                if (matchIdx !== -1) {
                    nameSpan.appendChild(document.createTextNode(name.slice(0, matchIdx)));
                    const mark = document.createElement('mark');
                    mark.style.cssText =
                        'background:rgba(51,170,255,0.35); color:inherit; border-radius:2px; padding:0 1px;';
                    mark.textContent = name.slice(matchIdx, matchIdx + val.length);
                    nameSpan.appendChild(mark);
                    nameSpan.appendChild(document.createTextNode(name.slice(matchIdx + val.length)));
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
            this.ui.tooltip.style.display = 'none';
            this.controls.autoRotate = true;
            this.orbitPathLine.visible = false;
            this.ui.searchBox.value = '';
            if (this.ui.passInfo) this.ui.passInfo.textContent = '';
        } catch (error) {
            handleError('Reset selection', error);
        }
    }

    /**
     * Selects a satellite by layer and index.
     * @param {string} layerKey - Layer identifier
     * @param {number} index - Satellite index
     */
    selectSatellite(layerKey, index) {
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
                this.predictNextPass(layerKey, index);
            }
        } catch (error) {
            handleError('Select satellite', error);
        }
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
        this.updateStatus('Downloading orbital data...', 'status-warn');
        this.ui.progress.style.width = '10%';

        let completed = 0;
        for (const key of this.layerOrder) {
            const tleUrl = this.config.urls.tle[key];
            this.ui.loaderText.textContent = `Loading ${this.layers[key].label}...`;
            this.updateStatus(`Loading ${this.layers[key].label}...`, 'status-warn');

            try {
                const res = await this.fetchTLEWithCache(tleUrl, key, key);
                if (res && res.text) {
                    this.processTLEForLayer(res.text, key, res.source);
                    this.updateBadge(key, res.source, res.cacheAge);
                } else {
                    this.generateSimulationLayer(key);
                    this.updateBadge(key, 'sim');
                }
            } catch (error) {
                handleError(`Load ${key} data`, error);
                this.generateSimulationLayer(key);
                this.updateBadge(key, 'sim');
            }

            completed++;
            const pct = 10 + Math.round((completed / this.layerOrder.length) * 70);
            this.ui.progress.style.width = `${pct}%`;
        }

        await this.initTimeSync();
        this.createLayerMeshes();
        this.rebuildSearchIndex();
        this.restoreFromURL();

        this.ui.progress.style.width = '100%';
        if (!this.ui.statusText.innerText.includes('Synced')) {
            this.updateStatus('Ready', 'status-ok');
        }
        this.ui.loader.classList.add('hidden');
    }

    /**
     * Fetches TLE data with caching support and age tracking.
     * @param {string} tleUrl - URL to fetch TLE from
     * @param {string} key - Cache key identifier
     * @param {string} layerKey - Layer identifier
     * @returns {Promise<{ text: string, source: string, cacheAge?: number } | null>}
     */
    async fetchTLEWithCache(tleUrl, key, layerKey) {
        const cacheKey = `tle_cache_${key}`;

        // Check cache
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                const age = Date.now() - timestamp;
                if (age < CONSTANTS.CACHE_TTL_MS) {
                    return { text: data, source: 'cached', cacheAge: age };
                }
            }
        } catch (e) {
            handleError('Cache read', e);
        }

        // Offline fallback: use stale cache
        if (!navigator.onLine) {
            try {
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    const { data, timestamp } = JSON.parse(cached);
                    const age = Date.now() - timestamp;
                    return { text: data, source: 'cached', cacheAge: age };
                }
            } catch (e) {
                handleError('Offline cache read', e);
            }
            return null;
        }

        // Fetch fresh with retry
        const result = await this.fetchWithFallback(tleUrl, layerKey);

        if (result && result.text) {
            try {
                localStorage.setItem(
                    cacheKey,
                    JSON.stringify({
                        data: result.text,
                        timestamp: Date.now()
                    })
                );
            } catch (e) {
                handleError('Cache write', e);
            }
        }

        return result;
    }

    /**
     * Fetches TLE data with multiple fallback methods and retry logic.
     * @param {string} tleUrl - Primary URL
     * @param {string} layerKey - Layer identifier
     * @returns {Promise<{ text: string, source: string } | null>}
     */
    async fetchWithFallback(tleUrl, layerKey) {
        const attemptFetch = async (url, timeout = CONSTANTS.FETCH_TIMEOUT_PROXY) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            try {
                const res = await fetch(url, { signal: controller.signal, mode: 'cors' });
                if (!res.ok) throw new Error(res.statusText);
                return await res.text();
            } finally {
                clearTimeout(timeoutId);
            }
        };

        const jsonToTLE = (jsonData) => {
            const lines = [];
            for (const sat of jsonData) {
                if (sat.TLE_LINE1 && sat.TLE_LINE2) {
                    lines.push(sat.OBJECT_NAME || 'UNKNOWN');
                    lines.push(sat.TLE_LINE1);
                    lines.push(sat.TLE_LINE2);
                }
            }
            return lines.join('\n');
        };

        // 1. Direct fetch with retry
        try {
            const text = await retryWithBackoff(
                () => attemptFetch(tleUrl, CONSTANTS.FETCH_TIMEOUT_DIRECT),
                { maxAttempts: 2, baseDelay: 500 }
            );
            if (text && text.includes('1 ')) {
                return { text, source: 'live' };
            }
        } catch (e) {
            console.log(`[${layerKey}] Direct fetch failed: ${e.message}`);
        }

        // 2. JSON format with retry
        try {
            const jsonUrl = this.config.urls.tleJson[layerKey];
            if (jsonUrl) {
                const jsonText = await retryWithBackoff(
                    () => attemptFetch(jsonUrl, CONSTANTS.FETCH_TIMEOUT_DIRECT),
                    { maxAttempts: 2, baseDelay: 500 }
                );
                const jsonData = JSON.parse(jsonText);
                if (Array.isArray(jsonData) && jsonData.length > 0) {
                    const tleText = jsonToTLE(jsonData);
                    if (tleText && tleText.includes('1 ')) {
                        return { text: tleText, source: 'live' };
                    }
                }
            }
        } catch (e) {
            console.log(`[${layerKey}] JSON format failed: ${e.message}`);
        }

        // 3. CORS proxies with retry
        for (const proxy of CONSTANTS.CORS_PROXIES) {
            try {
                const proxyUrl = proxy.template.replace('{url}', encodeURIComponent(tleUrl));
                const text = await retryWithBackoff(
                    () => attemptFetch(proxyUrl, CONSTANTS.FETCH_TIMEOUT_PROXY),
                    { maxAttempts: 2, baseDelay: 500 }
                );

                let tleData = text;
                if (proxy.parseJson) {
                    const json = JSON.parse(text);
                    tleData = json[proxy.field] || json.body || json.data;
                }

                if (tleData && tleData.includes('1 ')) {
                    return { text: tleData, source: 'live' };
                }
            } catch (e) {
                console.log(`[${layerKey}] ${proxy.name} failed: ${e.message}`);
                continue;
            }
        }

        console.error(`[${layerKey}] All fetch methods failed`);
        return null;
    }

    /**
     * Updates the data source badge for a layer.
     * @param {string} key - Layer identifier
     * @param {string} source - Data source ('live', 'cached', 'sim')
     * @param {number} [cacheAge] - Cache age in milliseconds
     */
    updateBadge(key, source, cacheAge) {
        const badge = this.ui.badges[key];
        if (!badge) return;

        badge.className = 'source-badge';
        if (source === 'live') {
            badge.classList.add('live');
            badge.textContent = 'LIVE';
        } else if (source === 'cached') {
            badge.classList.add('cached');
            if (cacheAge && cacheAge > CONSTANTS.CACHE_STALE_WARNING_MS) {
                const mins = Math.round(cacheAge / 60000);
                badge.textContent = `CACHED ${mins}m`;
                badge.title = `Data is ${mins} minutes old`;
            } else {
                badge.textContent = 'CACHED';
            }
        } else {
            badge.classList.add('sim');
            badge.textContent = 'SIM';
        }
        this.layers[key].source = source;
    }

    /**
     * Processes TLE data with validation and creates satellite records.
     * @param {string} data - Raw TLE text
     * @param {string} layerKey - Layer identifier
     * @param {string} sourceLabel - Source label
     */
    processTLEForLayer(data, layerKey, sourceLabel) {
        try {
            const lines = data
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l.length > 0);
            const satData = [];
            const satNames = [];
            let skippedCount = 0;

            for (let i = 0; i < lines.length - 2; i++) {
                const l0 = lines[i];
                const l1 = lines[i + 1];
                const l2 = lines[i + 2];

                if (l1.startsWith('1 ') && l2.startsWith('2 ')) {
                    try {
                        // ISS layer filter
                        if (layerKey === 'iss') {
                            const name = (l0 || '').toUpperCase();
                            if (!name.includes('ISS')) continue;
                        }

                        // Validate TLE format
                        const validation = validateTLE(l0, l1, l2);
                        if (!validation.valid) {
                            skippedCount++;
                            continue;
                        }

                        const rec = satellite.twoline2satrec(l1, l2);
                        if (!rec.error) {
                            rec.isSimulated = false;
                            rec.epochyr = parseInt(l1.substring(18, 20), 10);
                            rec.epochdays = parseFloat(l1.substring(20, 32));
                            satData.push(rec);
                            satNames.push(l0);
                            if (!this.primarySatrec) this.primarySatrec = rec;
                            i += 2;
                        } else {
                            skippedCount++;
                        }
                    } catch (err) {
                        skippedCount++;
                    }
                }
            }

            if (skippedCount > 0) {
                console.warn(`[${layerKey}] Skipped ${skippedCount} invalid TLE entries`);
            }

            // Fallback for ISS
            if (layerKey === 'iss' && satData.length === 0) {
                this.generateSimulationLayer(layerKey);
                return;
            }

            // Mobile: cap satellite count
            if (
                this.isMobile &&
                layerKey === 'starlink' &&
                satData.length > CONSTANTS.MOBILE_MAX_SATELLITES
            ) {
                satData.length = CONSTANTS.MOBILE_MAX_SATELLITES;
                satNames.length = CONSTANTS.MOBILE_MAX_SATELLITES;
            }

            this.layerData[layerKey] = { satData, satNames };
            this.updateStatus(`${this.layers[layerKey].label}: ${sourceLabel}`, 'status-ok');
        } catch (error) {
            handleError(`Process TLE for ${layerKey}`, error);
            this.generateSimulationLayer(layerKey);
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONSTANTS.FETCH_TIMEOUT_TIME_API);

        try {
            const response = await fetch('https://worldtimeapi.org/api/timezone/Etc/UTC', {
                signal: controller.signal
            });
            const data = await response.json();
            this.referenceTime = new Date(data.utc_datetime).getTime();
            this.updateStatus('UTC Synced (Global API)', 'status-ok');
        } catch (e) {
            if (this.primarySatrec && !this.primarySatrec.isSimulated) {
                const sat = this.primarySatrec;
                const currentYear = new Date().getFullYear() % 100;
                const century = sat.epochyr > currentYear + 30 ? 1900 : 2000;
                const year = century + sat.epochyr;
                const jan1 = Date.UTC(year, 0, 1);
                const msOffset = (sat.epochdays - 1) * 24 * 60 * 60 * 1000;
                this.referenceTime = jan1 + msOffset;
                this.updateStatus('UTC Synced (TLE Epoch)', 'status-warn');
            } else {
                this.referenceTime = Date.now();
                this.updateStatus('System Clock (Fallback)', 'status-err');
            }
        } finally {
            clearTimeout(timeoutId);
        }
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
        this.layerOrder.forEach((key) => {
            try {
                localStorage.removeItem(`tle_cache_${key}`);
            } catch (e) {
                /* ignore */
            }
        });

        this.updateStatus('Refreshing data...', 'status-warn');

        for (const key of this.layerOrder) {
            try {
                const tleUrl = this.config.urls.tle[key];
                const res = await this.fetchTLEWithCache(tleUrl, key, key);
                if (res && res.text) {
                    this.processTLEForLayer(res.text, key, res.source);
                    this.updateBadge(key, res.source, res.cacheAge);
                }
            } catch (error) {
                handleError(`Refresh ${key}`, error);
            }
        }

        this.createLayerMeshes();
        this.rebuildSearchIndex();
        this.updateStatus('Data refreshed', 'status-ok');
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

            const material = new THREE.PointsMaterial({
                map: this.pointTex,
                size: this.pointSize,
                vertexColors: true,
                transparent: true,
                alphaTest: 0.5,
                sizeAttenuation: false
            });

            const points = new THREE.Points(geometry, material);
            points.frustumCulled = false;
            points.visible = !!this.layers[layerKey].enabled;
            points.userData.layerKey = layerKey;

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
     * Updates satellite positions and visual states.
     */
    updatePhysics() {
        if (!this.referenceTime || !this.isInitialized) return;
        if (this.paused) return;

        const now = performance.now();
        const rate = 1000 / this.effectivePhysicsHz;
        if (now - this.lastPhysicsUpdate < rate) return;
        this.lastPhysicsUpdate = now;

        try {
            const timeSpeed = parseFloat(this.ui.speedSlider.value);
            const elapsed = (now - this.simStartTime) * timeSpeed;
            const simDate = new Date(this.referenceTime + elapsed);
            this.currentSimDate = simDate;

            this.calculateSunPosition(simDate);

            const gmst = satellite.gstime(simDate);
            const sunVec = this.sunPosition;

            if (this.selected && this.ui.checkOrbit.checked) {
                this.updateOrbitPath(this.selected.layer, this.selected.index, simDate);
            } else {
                this.orbitPathLine.visible = false;
            }

            let totalActive = 0;
            let lit = 0,
                dark = 0;
            let issPosition = null;
            let issShadow = 0;

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

                totalActive += activeCount;
                const baseC = this.layers[layerKey].color;
                const darkC = CONSTANTS.DARK_COLOR;

                for (let i = 0; i < activeCount; i++) {
                    const sat = layer.satData[i];
                    let x, y, z, vX, vY, vZ;

                    if (sat.isSimulated) {
                        const pos = sat.getPos(simDate);
                        x = pos.x;
                        y = pos.y;
                        z = pos.z;
                    } else {
                        try {
                            const pv = satellite.propagate(sat, simDate);
                            if (pv.position && !isNaN(pv.position.x)) {
                                vX = pv.velocity.x;
                                vY = pv.velocity.y;
                                vZ = pv.velocity.z;
                                const gd = satellite.eciToGeodetic(pv.position, gmst);
                                const alt =
                                    (CONSTANTS.EARTH_RADIUS_KM + gd.height) *
                                    CONSTANTS.RENDER_SCALE;
                                const phi = gd.latitude;
                                const theta = gd.longitude;
                                x = alt * Math.cos(phi) * Math.cos(theta);
                                y = alt * Math.sin(phi);
                                z = -alt * Math.cos(phi) * Math.sin(theta);
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

                    const xKm = x / CONSTANTS.RENDER_SCALE;
                    const yKm = y / CONSTANTS.RENDER_SCALE;
                    const zKm = z / CONSTANTS.RENDER_SCALE;
                    const shadow = computeShadowFactorKm(xKm, yKm, zKm, sunVec);

                    if (shadow > CONSTANTS.UMBRA_THRESHOLD) dark++;
                    else lit++;

                    const satName = layer.satNames[i] || '';
                    const isISS =
                        layerKey === 'iss' &&
                        (satName.toUpperCase().includes('ISS (ZARYA)') ||
                            satName.toUpperCase() === 'ISS' ||
                            satName.toUpperCase().includes('ISS ('));

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
                        const r = baseC.r * (1 - t) + darkC.r * t;
                        const g = baseC.g * (1 - t) + darkC.g * t;
                        const b = baseC.b * (1 - t) + darkC.b * t;
                        colors.setXYZ(i, r, g, b);
                    }
                }

                if (activeCount < totalCount) {
                    for (let j = activeCount; j < totalCount; j++) {
                        positions.setXYZ(j, 0, 0, 0);
                    }
                }

                mesh.geometry.setDrawRange(0, activeCount);
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
                this.updateGroundStationMarker(simDate);
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
                        if (pv.position && !isNaN(pv.position.x)) {
                            const gmst = satellite.gstime(future);
                            const gd = satellite.eciToGeodetic(pv.position, gmst);
                            const alt =
                                (CONSTANTS.EARTH_RADIUS_KM + gd.height) * CONSTANTS.RENDER_SCALE;
                            x = alt * Math.cos(gd.latitude) * Math.cos(gd.longitude);
                            y = alt * Math.sin(gd.latitude);
                            z = -alt * Math.cos(gd.latitude) * Math.sin(gd.longitude);
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
        els.id.textContent = `ID: ${idx}`;
        els.alt.textContent = `Alt: ${alt.toFixed(1)} km`;
        els.vel.textContent = `Vel: ${velFmt}`;
        els.light.textContent = `Light: ${eclipseStr}`;
        els.locked.style.display = isLocked ? 'block' : 'none';
    }

    // ========================================================================
    // ANIMATION LOOP
    // ========================================================================

    /**
     * Main animation loop.
     */
    animate() {
        if (this.isDisposed) return;
        requestAnimationFrame(() => this.animate());
        try {
            this.controls.update();
            this.updatePhysics();
            this.checkRaycast();
            this.renderer.render(this.scene, this.camera);
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
            // Allow a small extra-pixel buffer so the cursor doesn't have to be
            // perfectly centred on the dot.
            this.raycaster.params.Points.threshold = (this.pointSize + 2) * worldPerPx;

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
     * Requests the user's location and places a ground station marker.
     */
    requestGroundStation() {
        if (!navigator.geolocation) {
            showErrorToast('Geolocation is not supported by your browser');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.observerLocation = {
                    lat: position.coords.latitude,
                    lon: position.coords.longitude
                };
                this.setupGroundStationMarker();
                this.updateStatus(
                    `Observer: ${this.observerLocation.lat.toFixed(2)}, ${this.observerLocation.lon.toFixed(2)}`,
                    'status-ok'
                );
            },
            (error) => {
                handleError('Geolocation', error, true);
            },
            { enableHighAccuracy: false, timeout: 10000 }
        );
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

        const geo = new THREE.SphereGeometry(0.08, 8, 8);
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
     * Updates ground station marker position accounting for Earth's rotation.
     * @param {Date} simDate - Current simulation date
     */
    updateGroundStationMarker(simDate) {
        if (!this.observerLocation || !this.groundStationMarker) return;

        const lat = this.observerLocation.lat * (Math.PI / 180);
        const lon = this.observerLocation.lon * (Math.PI / 180);
        const gmst = satellite.gstime(simDate);
        const gd = { latitude: lat, longitude: lon - gmst, height: 0 };
        const alt = CONSTANTS.EARTH_RADIUS_KM * CONSTANTS.RENDER_SCALE;

        const x = alt * Math.cos(gd.latitude) * Math.cos(gd.longitude);
        const y = alt * Math.sin(gd.latitude);
        const z = -alt * Math.cos(gd.latitude) * Math.sin(gd.longitude);

        this.groundStationMarker.position.set(x, y, z);

        if (this.groundStationLine) {
            const spike = 1.05;
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
    // PASS PREDICTION
    // ========================================================================

    /**
     * Predicts the next visible pass for a selected satellite.
     * @param {string} layerKey - Layer identifier
     * @param {number} index - Satellite index
     */
    predictNextPass(layerKey, index) {
        if (!this.observerLocation || !this.ui.passInfo) return;

        const layer = this.layerData[layerKey];
        if (!layer) return;
        const sat = layer.satData[index];
        if (!sat || sat.isSimulated) {
            this.ui.passInfo.textContent = 'Pass prediction unavailable for simulated satellites';
            return;
        }

        try {
            const obsLat = this.observerLocation.lat * (Math.PI / 180);
            const obsLon = this.observerLocation.lon * (Math.PI / 180);
            const observer = { lat: obsLat, lon: obsLon, alt: 0 };

            const now = this.currentSimDate || new Date();
            const endTime = new Date(now.getTime() + CONSTANTS.PASS_PREDICTION_HOURS * 3600000);
            const stepMs = CONSTANTS.PASS_TIME_STEP_SEC * 1000;

            let inPass = false;
            let passStart = null;
            let maxEl = 0;

            for (let t = now.getTime(); t < endTime.getTime(); t += stepMs) {
                const date = new Date(t);
                try {
                    const pv = satellite.propagate(sat, date);
                    if (!pv.position || isNaN(pv.position.x)) continue;

                    const gmst = satellite.gstime(date);
                    const el = calculateElevation(observer, pv.position, gmst);

                    if (el >= CONSTANTS.PASS_MIN_ELEVATION_DEG) {
                        if (!inPass) {
                            inPass = true;
                            passStart = date;
                            maxEl = el;
                        }
                        if (el > maxEl) maxEl = el;
                    } else if (inPass) {
                        // Pass ended — report it
                        const startStr = passStart.toISOString().split('T')[1].split('.')[0];
                        const endStr = date.toISOString().split('T')[1].split('.')[0];
                        this.ui.passInfo.textContent = `Next pass: ${startStr}-${endStr} UTC, max el: ${maxEl.toFixed(1)}`;
                        return;
                    }
                } catch (e) {
                    /* skip step */
                }
            }

            this.ui.passInfo.textContent = inPass
                ? `Pass in progress! Max el: ${maxEl.toFixed(1)}`
                : 'No passes in next 24h';
        } catch (error) {
            handleError('Pass prediction', error);
            this.ui.passInfo.textContent = 'Pass prediction error';
        }
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
        Object.values(this.layerMeshes).forEach((mesh) => {
            if (mesh && mesh.material) mesh.material.size = this.pointSize;
        });
        if (this.ui.pixelSizeDisplay) this.ui.pixelSizeDisplay.textContent = this.pointSize;
        savePointSizePreference(this.pointSize);
    }

    // ========================================================================
    // PAUSE / RESUME
    // ========================================================================

    /**
     * Toggles simulation pause state. When unpausing, shifts simStartTime so
     * the simulation continues from the exact moment it was frozen.
     */
    togglePause() {
        if (this.paused) {
            // Shift the start time forward by how long we were paused so elapsed
            // time continues seamlessly from the frozen moment.
            this.simStartTime += performance.now() - this.pauseWallTime;
            this.paused = false;
        } else {
            this.pauseWallTime = performance.now();
            this.paused = true;
        }
        if (this.ui.pauseIndicator) {
            this.ui.pauseIndicator.style.display = this.paused ? 'block' : 'none';
        }
    }

    /**
     * Snaps the simulation clock back to the actual current wall-clock time.
     * Unpauses if paused and resets speed to 1x.
     */
    resetToNow() {
        this.referenceTime = Date.now();
        this.simStartTime = performance.now();

        // Unpause if frozen
        if (this.paused) {
            this.paused = false;
            if (this.ui.pauseIndicator) this.ui.pauseIndicator.style.display = 'none';
        }

        // Restore speed to real-time
        if (this.ui.speedSlider) {
            this.ui.speedSlider.value = 1;
            this.ui.speedDisplay.textContent = '1';
        }
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
            params.set('sat', `${this.selected.layer}:${this.selected.index}`);
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
            const epoch = new Date(params.get('t')).getTime();
            if (!isNaN(epoch)) {
                this.referenceTime = epoch;
                this.simStartTime = performance.now();
            }
        }

        if (params.has('sat')) {
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

        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }

        this.layerMeshes = {};
        this.layerData = {};
        this.allSatIndex = [];
        this._boundHandlers = {};
        this._disposables = [];
    }
}
