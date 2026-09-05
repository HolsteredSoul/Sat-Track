import { TrackingClock } from '../src/trackingClock.js';

describe('tracking clock', () => {
    let elapsed, wall, clock;
    beforeEach(() => {
        elapsed = 0;
        wall = Date.UTC(2026, 8, 5);
        clock = new TrackingClock({ wallNow: () => wall, monotonicNow: () => elapsed });
    });
    test('speed changes preserve the current instant; pause freezes even through speed changes', () => {
        elapsed = 1000;
        clock.setSpeed(10);
        expect(clock.now()).toBe(wall + 1000);
        elapsed += 1000;
        expect(clock.now()).toBe(wall + 11000);
        clock.togglePause();
        elapsed += 5000;
        clock.setSpeed(20);
        expect(clock.now()).toBe(wall + 11000);
        clock.togglePause();
        elapsed += 1000;
        expect(clock.now()).toBe(wall + 31000);
    });
    test('Reset to Now exits historical time, unpauses, and restores 1x', () => {
        clock.restore('2024-01-01T00:00:00Z');
        clock.setSpeed(200);
        clock.togglePause();
        wall += 12345;
        clock.reset();
        expect(clock.now()).toBe(wall);
        expect(clock.paused).toBe(false);
        expect(clock.speed).toBe(1);
        expect(clock.mode).toBe('live');
    });
    test.each(['reject', 'malformed', 'invalid-date', 'missing-zone'])(
        'time service %s retains actual device time',
        async (mode) => {
            const fetchFn = async () => {
                if (mode === 'reject') throw new TypeError('offline');
                return {
                    ok: true,
                    text: async () =>
                        mode === 'malformed'
                            ? '{}'
                            : JSON.stringify({
                                  utc_datetime:
                                      mode === 'missing-zone' ? '2024-01-01T00:00:00' : 'invalidZ'
                              })
                };
            };
            await clock.synchronize({ fetchFn });
            expect(clock.now()).toBe(wall);
            expect(clock.source).toBe('Device clock');
        }
    );
    test('valid UTC response anchors at completion rather than startup', async () => {
        await clock.synchronize({
            fetchFn: async () => {
                elapsed = 5000;
                return {
                    ok: true,
                    text: async () => JSON.stringify({ utc_datetime: '2026-09-05T00:01:00+00:00' })
                };
            }
        });
        expect(clock.now()).toBe(Date.UTC(2026, 8, 5, 0, 1));
        expect(clock.source).toBe('UTC service');
    });
    test('a late sync cannot overwrite a restored historical view', async () => {
        let finish;
        const pending = clock.synchronize({
            fetchFn: () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        });
        clock.restore('2024-01-01T00:00:00Z');
        finish({
            ok: true,
            text: async () => JSON.stringify({ utc_datetime: '2026-09-05T00:00:00Z' })
        });
        await pending;
        expect(clock.now()).toBe(Date.UTC(2024, 0, 1));
        expect(clock.mode).toBe('shared');
    });
    test('time service timeout aborts and falls back to device time', async () => {
        await clock.synchronize({
            timeoutMs: 5,
            fetchFn: (_url, { signal }) =>
                new Promise((_resolve, reject) =>
                    signal.addEventListener('abort', () =>
                        reject(new DOMException('Timeout', 'AbortError'))
                    )
                )
        });
        expect(clock.now()).toBe(wall);
        expect(clock.source).toBe('Device clock');
    });

    test('Reset to Now wins over an in-flight sync even in the same clock tick', async () => {
        let finish;
        const pending = clock.synchronize({
            fetchFn: () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        });
        clock.reset();
        finish({
            ok: true,
            text: async () => JSON.stringify({ utc_datetime: '2024-01-01T00:00:00Z' })
        });
        await pending;
        expect(clock.now()).toBe(wall);
        expect(clock.source).toBe('Device clock');
    });
});
