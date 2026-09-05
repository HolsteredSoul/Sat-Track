import * as satellite from 'satellite.js';
import { validateTLE } from './core.js';
import { CONSTANTS } from './constants.js';

export const CACHE_VERSION = 2;
export const CACHE_TTL_MS = CONSTANTS.CACHE_TTL_MS;

export function catalogId(value) {
    const text = String(value ?? '');
    return /^\d{1,9}$/.test(text) && Number(text) > 0 ? String(Number(text)) : null;
}

/** CelesTrak epochs without a suffix are UTC, never browser-local time. */
export function parseEpoch(value) {
    if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/.test(value)
    ) {
        throw new Error('Invalid UTC epoch');
    }
    const ms = Date.parse(value.endsWith('Z') ? value : `${value}Z`);
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) {
        throw new Error('Invalid UTC epoch');
    }
    return ms;
}

function recordFromOMM(row) {
    if (!row || typeof row !== 'object') throw new Error('Invalid OMM row');
    const id = catalogId(row.NORAD_CAT_ID);
    if (!id) throw new Error('Invalid catalogue ID');
    const epochMs = parseEpoch(row.EPOCH);
    for (const [field, expected] of Object.entries({
        CENTER_NAME: 'EARTH',
        REF_FRAME: 'TEME',
        TIME_SYSTEM: 'UTC',
        MEAN_ELEMENT_THEORY: 'SGP4'
    })) {
        if (row[field] !== null && row[field] !== undefined && row[field] !== expected)
            throw new Error(`Unsupported ${field}`);
    }
    const normalized = { ...row, NORAD_CAT_ID: id, EPOCH: new Date(epochMs).toISOString() };
    for (const field of [
        'MEAN_MOTION',
        'ECCENTRICITY',
        'INCLINATION',
        'RA_OF_ASC_NODE',
        'ARG_OF_PERICENTER',
        'MEAN_ANOMALY',
        'BSTAR',
        'MEAN_MOTION_DOT',
        'MEAN_MOTION_DDOT'
    ]) {
        const value = row[field];
        if (
            !['number', 'string'].includes(typeof value) ||
            String(value).trim() === '' ||
            !Number.isFinite(Number(value))
        ) {
            throw new Error(`Invalid ${field}`);
        }
        normalized[field] = Number(value);
    }
    if (
        normalized.MEAN_MOTION <= 0 ||
        normalized.ECCENTRICITY < 0 ||
        normalized.ECCENTRICITY >= 1 ||
        normalized.INCLINATION < 0 ||
        normalized.INCLINATION > 180 ||
        ['RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY'].some(
            (k) => normalized[k] < 0 || normalized[k] >= 360
        )
    ) {
        throw new Error('Orbital elements out of range');
    }
    return finishRecord(satellite.json2satrec(normalized), row.OBJECT_NAME, id, epochMs);
}

function finishRecord(satrec, name, id, epochMs) {
    if (satrec.error || !Number.isFinite(satrec.jdsatepoch))
        throw new Error('Invalid satellite record');
    const pv = satellite.propagate(satrec, new Date(epochMs));
    if (!validPV(pv)) throw new Error('Unpropagatable satellite record');
    satrec.isSimulated = false;
    satrec.catalogId = id;
    satrec.epochMs = epochMs;
    return { satrec, name: typeof name === 'string' && name.trim() ? name.trim() : `NORAD ${id}` };
}

export function validPV(pv) {
    return (
        !!pv &&
        ['position', 'velocity'].every(
            (k) => pv[k] && ['x', 'y', 'z'].every((a) => Number.isFinite(pv[k][a]))
        )
    );
}

/** Parse raw data before caching. Filtering another station is not a validation failure. */
export function parseOrbitalData(payload, format = 'omm', layerKey) {
    const records = [];
    let rejected = 0;
    if (format === 'omm') {
        const rows = typeof payload === 'string' ? JSON.parse(payload) : payload;
        if (!Array.isArray(rows)) throw new Error('Expected an OMM array');
        for (const row of rows) {
            try {
                records.push(recordFromOMM(row));
            } catch {
                rejected++;
            }
        }
    } else if (format === 'tle') {
        if (typeof payload !== 'string') throw new Error('Expected TLE text');
        const lines = payload
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
        for (let i = 0; i < lines.length; ) {
            const [name, l1, l2] = lines.slice(i, i + 3);
            if (!l1?.startsWith('1 ') || !l2?.startsWith('2 ')) {
                rejected++;
                i++;
                continue;
            }
            i += 3;
            try {
                const id = catalogId(l1.slice(2, 7).trim());
                if (
                    !id ||
                    id !== catalogId(l2.slice(2, 7).trim()) ||
                    !validateTLE(name, l1, l2).valid
                )
                    throw new Error('Invalid TLE');
                const satrec = satellite.twoline2satrec(l1, l2);
                records.push(
                    finishRecord(
                        satrec,
                        name.replace(/^0 /, ''),
                        id,
                        (satrec.jdsatepoch - 2440587.5) * 86400000
                    )
                );
            } catch {
                rejected++;
            }
        }
    } else throw new Error('Unsupported cache format');
    const seen = new Set();
    const filtered = records.filter(({ satrec }) => {
        if (seen.has(satrec.catalogId)) {
            rejected++;
            return false;
        }
        seen.add(satrec.catalogId);
        return layerKey !== 'iss' || satrec.catalogId === '25544';
    });
    if (!filtered.length) throw new Error('No valid satellites in this layer');
    return {
        satData: filtered.map((r) => r.satrec),
        satNames: filtered.map((r) => r.name),
        rejected
    };
}

export async function fetchText(
    url,
    { fetchFn = globalThis.fetch, signal, timeoutMs = CONSTANTS.FETCH_TIMEOUT_DIRECT } = {}
) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
        const response = await fetchFn(url, { signal: controller.signal, mode: 'cors' });
        if (!response.ok) {
            const error = new Error(`Data service returned HTTP ${response.status}`);
            error.status = response.status;
            error.retryAfter = response.headers?.get('retry-after');
            throw error;
        }
        const text = await response.text();
        if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
        return text;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}

/** Versioned raw-data cache; satrecs are rebuilt rather than trusting serialized library internals. */
export class OrbitalDataStore {
    constructor({
        storage,
        fetchFn = globalThis.fetch,
        now = Date.now,
        timeoutMs = CONSTANTS.FETCH_TIMEOUT_DIRECT
    } = {}) {
        this.storage = storage;
        this.fetchFn = fetchFn;
        this.now = now;
        this.timeoutMs = timeoutMs;
        this.controllers = new Set();
        this.cooldown = new Map();
        this.disposed = false;
    }

    readCache(key) {
        for (const cacheKey of [`orbit_cache_v2_${key}`, `tle_cache_${key}`]) {
            try {
                const raw = this.storage?.getItem(cacheKey);
                if (!raw) continue;
                const item = JSON.parse(raw);
                const legacy = cacheKey.startsWith('tle_');
                if (!legacy && item.version !== CACHE_VERSION) continue;
                const payload = legacy ? item.data : item.payload;
                const format = legacy ? 'tle' : item.format;
                const fetchedAt = legacy ? item.timestamp : item.fetchedAt;
                if (!Number.isFinite(fetchedAt) || fetchedAt > this.now() || fetchedAt < 0)
                    continue;
                const parsed = parseOrbitalData(payload, format, key);
                if (parsed.rejected) continue;
                return {
                    ...parsed,
                    format,
                    fetchedAt,
                    source: 'cached',
                    cacheAge: this.now() - fetchedAt
                };
            } catch {
                /* Try legacy cache if the new entry is corrupt. */
            }
        }
        return null;
    }

    async load(key, url, { force = false, online = true } = {}) {
        if (this.disposed) throw new DOMException('Disposed', 'AbortError');
        const cached = this.readCache(key);
        if (cached && !force && cached.cacheAge < CACHE_TTL_MS) return cached;
        if (!online) return cached && { ...cached, warning: 'Offline — using saved orbital data' };
        if ((this.cooldown.get(key) || 0) > this.now()) {
            if (cached)
                return { ...cached, warning: 'Data service cooldown — using saved orbital data' };
            throw new Error('Data service cooldown; try again later');
        }
        const controller = new AbortController();
        this.controllers.add(controller);
        let error;
        try {
            // One retry for a transport failure only. Never retry HTTP errors via another endpoint/proxy.
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const payload = await fetchText(url, {
                        fetchFn: this.fetchFn,
                        signal: controller.signal,
                        timeoutMs: this.timeoutMs
                    });
                    if (this.disposed) throw new DOMException('Disposed', 'AbortError');
                    const parsed = parseOrbitalData(payload, 'omm', key);
                    const fetchedAt = this.now();
                    if (!parsed.rejected) {
                        try {
                            this.storage?.setItem(
                                `orbit_cache_v2_${key}`,
                                JSON.stringify({
                                    version: CACHE_VERSION,
                                    format: 'omm',
                                    fetchedAt,
                                    payload
                                })
                            );
                        } catch {
                            /* Quota/private mode must not prevent live tracking. */
                        }
                    }
                    return {
                        ...parsed,
                        format: 'omm',
                        fetchedAt,
                        source: 'live',
                        warning: parsed.rejected
                            ? `${parsed.rejected} invalid records skipped; saved cache preserved`
                            : null
                    };
                } catch (e) {
                    error = e;
                    if (e.status) {
                        const seconds = Number(e.retryAfter);
                        const until =
                            e.retryAfter && Number.isFinite(seconds)
                                ? this.now() + seconds * 1000
                                : Date.parse(e.retryAfter);
                        this.cooldown.set(
                            key,
                            Math.max(this.now() + CACHE_TTL_MS, Number.isFinite(until) ? until : 0)
                        );
                    }
                    if (
                        this.disposed ||
                        controller.signal.aborted ||
                        e.status ||
                        !(e instanceof TypeError)
                    )
                        break;
                }
            }
        } finally {
            this.controllers.delete(controller);
        }
        if (this.disposed) throw error;
        if (cached) return { ...cached, warning: `${error.message}; using saved orbital data` };
        throw error;
    }

    dispose() {
        this.disposed = true;
        for (const controller of this.controllers) controller.abort();
        this.controllers.clear();
    }
}

export function describeEpoch(epochMs, simMs) {
    if (!Number.isFinite(epochMs)) return 'Illustrative orbit';
    const hours = (simMs - epochMs) / 3600000;
    const amount =
        Math.abs(hours) < 1
            ? `${Math.round(Math.abs(hours) * 60)}m`
            : `${Math.abs(hours).toFixed(1)}h`;
    return `Epoch ${amount} ${hours < 0 ? 'ahead of' : 'before'} view time`;
}
