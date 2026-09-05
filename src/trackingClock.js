import { fetchText } from './orbitalData.js';
import { CONSTANTS } from './constants.js';

/** Monotonic elapsed time with a re-anchored origin on speed/pause changes. */
export class TrackingClock {
    constructor({ wallNow = Date.now, monotonicNow = () => performance.now() } = {}) {
        this.wallNow = wallNow;
        this.monotonicNow = monotonicNow;
        this.speed = 1;
        this.paused = false;
        this.source = 'Device clock';
        this.mode = 'live';
        this.setTime(wallNow());
    }
    now() {
        return this.epoch + (this.paused ? 0 : (this.monotonicNow() - this.anchor) * this.speed);
    }
    setTime(epoch) {
        if (!Number.isFinite(epoch)) throw new Error('Invalid clock timestamp');
        this.epoch = epoch;
        this.anchor = this.monotonicNow();
        this.revision = (this.revision || 0) + 1;
    }
    setSpeed(speed) {
        if (!Number.isFinite(speed) || speed < 1 || speed > 200) return;
        this.setTime(this.now());
        this.speed = speed;
        this.mode = 'simulation';
    }
    togglePause() {
        this.setTime(this.now());
        this.paused = !this.paused;
    }
    reset() {
        this.speed = 1;
        this.paused = false;
        this.source = 'Device clock';
        this.mode = 'live';
        this.setTime(this.wallNow());
    }
    restore(iso) {
        const epoch = Date.parse(iso);
        if (!Number.isFinite(epoch)) return false;
        this.setTime(epoch);
        this.mode = 'shared';
        return true;
    }
    async synchronize(options = {}) {
        const revisionBefore = this.revision;
        try {
            const text = await fetchText('https://worldtimeapi.org/api/timezone/Etc/UTC', {
                timeoutMs: CONSTANTS.FETCH_TIMEOUT_TIME_API,
                ...options
            });
            const value = JSON.parse(text).utc_datetime;
            const epoch =
                typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
                    ? Date.parse(value)
                    : NaN;
            if (!Number.isFinite(epoch)) throw new Error('Invalid time service response');
            if (this.mode === 'live' && this.revision === revisionBefore) {
                this.setTime(epoch);
                this.source = 'UTC service';
            }
        } catch {
            if (this.mode === 'live' && this.revision === revisionBefore) {
                this.setTime(this.wallNow());
                this.source = 'Device clock';
            }
        }
    }
}
