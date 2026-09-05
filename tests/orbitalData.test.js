import { jest } from '@jest/globals';
import * as satellite from 'satellite.js';
import {
    parseOrbitalData,
    OrbitalDataStore,
    CACHE_TTL_MS,
    parseEpoch,
    validPV
} from '../src/orbitalData.js';
import {
    iss,
    sixDigit,
    tle,
    vanguard,
    referencePosition,
    referenceVelocity
} from './fixtures/orbits.js';

const response = (data) => ({ ok: true, text: async () => JSON.stringify(data) });
const memory = () => {
    const data = new Map();
    return {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value)
    };
};

describe('orbital ingestion', () => {
    test('keeps six-digit identity and propagates a structured-cloned record', () => {
        const rec = parseOrbitalData([sixDigit]).satData[0];
        expect(rec.catalogId).toBe('100001');
        expect(validPV(satellite.propagate(structuredClone(rec), new Date(rec.epochMs)))).toBe(
            true
        );
    });
    test('equivalent TLE and OMM positions agree to 1 metre over 24 hours', () => {
        const a = parseOrbitalData(tle, 'tle').satData[0];
        const b = parseOrbitalData([iss]).satData[0];
        for (const offset of [0, 3600000, 86400000]) {
            const date = new Date(b.epochMs + offset);
            const p = satellite.propagate(a, date).position;
            const q = satellite.propagate(b, date).position;
            // Same decimal elements and millisecond-aligned epoch; tolerance allows floating point drift.
            expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(0.001);
        }
    });
    test('matches independent Vallado TEME reference at epoch', () => {
        const rec = parseOrbitalData(vanguard, 'tle').satData[0];
        const pv = satellite.sgp4(rec, 0);
        // At exact minutes-from-epoch zero: 1 cm position and 0.01 mm/s velocity tolerance.
        ['x', 'y', 'z'].forEach((axis, i) => {
            expect(Math.abs(pv.position[axis] - referencePosition[i])).toBeLessThan(0.00001);
            expect(Math.abs(pv.velocity[axis] - referenceVelocity[i])).toBeLessThan(0.00000001);
        });
    });
    test('filters ISS by catalogue identity, not a misleading name', () => {
        const result = parseOrbitalData(
            [
                { ...sixDigit, OBJECT_NAME: 'ISS impostor' },
                { ...iss, OBJECT_NAME: 'Station' }
            ],
            'omm',
            'iss'
        );
        expect(result.satNames).toEqual(['Station']);
        expect(result.rejected).toBe(0);
    });
    test.each([
        {},
        { MEAN_MOTION: null },
        { ECCENTRICITY: 1 },
        { EPOCH: '2024-02-31T00:00:00' },
        { REF_FRAME: 'ITRF' },
        { BSTAR: '' },
        { NORAD_CAT_ID: '1e5' }
    ])('rejects malformed records: %j', (patch) => {
        const bad = Object.keys(patch).length ? { ...iss, ...patch } : {};
        expect(() => parseOrbitalData([bad])).toThrow();
        expect(parseOrbitalData([sixDigit, bad]).rejected).toBe(1);
    });
    test('rejects empty, duplicate-only layer mismatch and non-array payloads', () => {
        for (const data of [[], {}, [sixDigit]])
            expect(() => parseOrbitalData(data, 'omm', 'iss')).toThrow();
        expect(parseOrbitalData([iss, iss]).rejected).toBe(1);
    });
    test('interprets unsuffixed epochs in UTC', () => {
        expect(parseEpoch(iss.EPOCH)).toBe(Date.UTC(2024, 0, 1, 12));
    });
});

describe('cache and network recovery', () => {
    let storage;
    const now = Date.UTC(2024, 0, 2);
    beforeEach(() => {
        storage = memory();
    });
    test('reads legacy cache offline and writes versioned JSON after successful refresh', async () => {
        storage.setItem(
            'tle_cache_iss',
            JSON.stringify({ data: tle, timestamp: now - CACHE_TTL_MS * 2 })
        );
        const fetchFn = jest.fn(async () => response([iss]));
        const store = new OrbitalDataStore({ storage, fetchFn, now: () => now });
        expect((await store.load('iss', 'test', { online: false })).format).toBe('tle');
        expect(fetchFn).not.toHaveBeenCalled();
        const result = await store.load('iss', 'test', { force: true });
        expect(result.source).toBe('live');
        expect(JSON.parse(storage.getItem('orbit_cache_v2_iss')).version).toBe(2);
        expect((await store.load('iss', 'test')).source).toBe('cached');
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });
    test.each([[], [{ invalid: true }], 'not-json', [iss, {}]])(
        'never overwrites good cache with incomplete response %j',
        async (data) => {
            const fetchFn = jest.fn(async () => response([iss]));
            const store = new OrbitalDataStore({ storage, fetchFn, now: () => now });
            await store.load('iss', 'test');
            const original = storage.getItem('orbit_cache_v2_iss');
            fetchFn.mockImplementation(async () => response(data));
            const result = await store.load('iss', 'test', { force: true });
            expect(result.satData).toHaveLength(1);
            expect(storage.getItem('orbit_cache_v2_iss')).toBe(original);
        }
    );
    test('HTTP 403/429 stop retrying, preserve cache, and enforce service cooldown', async () => {
        storage.setItem(
            'tle_cache_iss',
            JSON.stringify({ data: tle, timestamp: now - CACHE_TTL_MS * 2 })
        );
        for (const status of [403, 429]) {
            const fetchFn = jest.fn(async () => ({
                ok: false,
                status,
                headers: new Headers({ 'retry-after': '14400' })
            }));
            const store = new OrbitalDataStore({ storage, fetchFn, now: () => now });
            expect((await store.load('iss', 'test', { force: true })).source).toBe('cached');
            await store.load('iss', 'test', { force: true });
            expect(fetchFn).toHaveBeenCalledTimes(1);
            expect(store.cooldown.get('iss')).toBe(now + 14400000);
        }
    });
    test('retries a transport failure once, then keeps the cache', async () => {
        storage.setItem(
            'tle_cache_iss',
            JSON.stringify({ data: tle, timestamp: now - CACHE_TTL_MS * 2 })
        );
        const fetchFn = jest.fn(async () => {
            throw new TypeError('network');
        });
        const result = await new OrbitalDataStore({ storage, fetchFn, now: () => now }).load(
            'iss',
            'test'
        );
        expect(result.source).toBe('cached');
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });
    test('corrupt caches and private storage do not prevent valid live data', async () => {
        storage.getItem = () => {
            throw new Error('denied');
        };
        storage.setItem = () => {
            throw new Error('quota');
        };
        expect(
            (
                await new OrbitalDataStore({ storage, fetchFn: async () => response([iss]) }).load(
                    'iss',
                    'test'
                )
            ).source
        ).toBe('live');
    });
    test('timeout aborts outstanding work without late cache writes', async () => {
        const fetchFn = jest.fn(
            (_url, { signal }) =>
                new Promise((_resolve, reject) =>
                    signal.addEventListener('abort', () =>
                        reject(new DOMException('Timeout', 'AbortError'))
                    )
                )
        );
        const store = new OrbitalDataStore({ storage, fetchFn, timeoutMs: 5 });
        await expect(store.load('iss', 'test')).rejects.toThrow('Timeout');
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(storage.getItem('orbit_cache_v2_iss')).toBeNull();
    });
    test('dispose cancels fetch and rejects instead of returning a late result', async () => {
        const fetchFn = (_url, { signal }) =>
            new Promise((_resolve, reject) =>
                signal.addEventListener('abort', () =>
                    reject(new DOMException('Disposed', 'AbortError'))
                )
            );
        const store = new OrbitalDataStore({ storage, fetchFn });
        const pending = store.load('iss', 'test');
        store.dispose();
        await expect(pending).rejects.toThrow();
        expect(store.controllers.size).toBe(0);
    });
});
