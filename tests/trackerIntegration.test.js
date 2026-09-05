import { jest } from '@jest/globals';
import * as THREE from 'three';
import * as satellite from 'satellite.js';
import { StarlinkTracker } from '../src/StarlinkTracker.js';
import { parseOrbitalData } from '../src/orbitalData.js';
import { SimulatedOrbit, calculateSunDirection } from '../src/core.js';
import { sixDigit } from './fixtures/orbits.js';

globalThis.self = { postMessage: jest.fn() };
await import('../src/workers/propagator.worker.js');

function trackerFor(satData) {
    const tracker = Object.create(StarlinkTracker.prototype);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(satData.length * 3), 3)
    );
    geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(satData.length * 3), 3)
    );
    Object.assign(tracker, {
        _generation: 7,
        isDisposed: false,
        layerOrder: ['starlink'],
        layers: { starlink: { enabled: true, color: { r: 1, g: 0.5, b: 0.1 } } },
        layerData: { starlink: { satData, satNames: satData.map(() => 'TEST') } },
        layerMeshes: { starlink: { geometry } },
        ui: { layers: {}, slider: { value: 100 }, count: {}, lit: {}, dark: {} },
        updateTooltip: jest.fn()
    });
    return tracker;
}

test.each([false, true])(
    'worker and main thread agree on positions, colors and counts (highlight=%s)',
    (highlight) => {
        const rec = parseOrbitalData([sixDigit]).satData[0];
        const sim = new SimulatedOrbit(550, 53, 12, 33);
        sim.epoch = rec.epochMs / 1000;
        const tracker = trackerFor([rec, sim]);
        const date = new Date(rec.epochMs + 3600000);
        tracker.sunPosition = calculateSunDirection(date, satellite.gstime);
        tracker.highlightVisible = highlight;
        tracker.observerLocation = { lat: -31.95, lon: 115.86 };
        tracker.updateGroundStationMarker = jest.fn();
        self.onmessage({
            data: {
                type: 'init',
                layers: {
                    starlink: {
                        satData: structuredClone([rec, sim]),
                        satNames: ['TEST', 'SIM'],
                        color: tracker.layers.starlink.color,
                        simParams: [
                            null,
                            { alt: 550, incDeg: 53, raanDeg: 12, anomalyDeg: 33, epoch: sim.epoch }
                        ]
                    }
                }
            }
        });
        self.onmessage({
            data: {
                type: 'update',
                generation: 7,
                simDateMs: date.getTime(),
                layerActive: { starlink: true },
                starlinkActiveCount: 2,
                highlightVisible: highlight,
                observer: { lat: (-31.95 * Math.PI) / 180, lon: (115.86 * Math.PI) / 180, alt: 0 },
                minElevation: 10
            }
        });
        const result = self.postMessage.mock.calls.at(-1)[0];
        tracker._updatePhysicsSync(date);
        const attrs = tracker.layerMeshes.starlink.geometry.attributes;
        expect(Array.from(attrs.position.array)).toEqual(
            Array.from(result.layers.starlink.positions)
        );
        expect(Array.from(attrs.color.array)).toEqual(Array.from(result.layers.starlink.colors));
        expect(tracker.ui.count.innerText).toBe(result.stats.total);
        expect(tracker.ui.lit.innerText).toBe(result.stats.lit);
    }
);

test('obsolete worker result cannot alter meshes or clock after a reset/refresh', () => {
    const tracker = trackerFor([parseOrbitalData([sixDigit]).satData[0]]);
    tracker.currentSimDate = new Date('2026-09-05T00:00:00Z');
    tracker.workerBusy = true;
    tracker._handleWorkerResult({ generation: 6, simDateMs: 1, layers: null });
    expect(tracker.currentSimDate.toISOString()).toBe('2026-09-05T00:00:00.000Z');
    expect(tracker.workerBusy).toBe(false);
    expect(tracker.layerMeshes.starlink.geometry.attributes.position.array[0]).toBe(0);
});

test('reduced-density worker frame preserves buffer capacity for synchronous fallback', () => {
    const rec = parseOrbitalData([sixDigit]).satData[0];
    const tracker = trackerFor([rec, structuredClone(rec)]);
    tracker._handleWorkerResult({
        generation: 7,
        layers: {
            starlink: {
                positions: new Float32Array([1, 2, 3]),
                colors: new Float32Array([1, 1, 1]),
                activeCount: 1
            }
        }
    });
    expect(tracker.layerMeshes.starlink.geometry.attributes.position.count).toBe(2);
    const date = new Date(rec.epochMs);
    tracker.sunPosition = calculateSunDirection(date, satellite.gstime);
    tracker._updatePhysicsSync(date);
    expect(tracker.layerMeshes.starlink.geometry.attributes.position.array[3]).not.toBe(0);
});

test('out of bounds legacy selections are ignored', () => {
    const tracker = trackerFor([parseOrbitalData([sixDigit]).satData[0]]);
    tracker.selectSatellite('starlink', -1);
    tracker.selectSatellite('starlink', 42);
    tracker.selectSatellite('unknown', 0);
    expect(tracker.selected).toBeUndefined();
});
