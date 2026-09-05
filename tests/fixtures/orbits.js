// Deterministic ISS-shaped fixture, not current orbital data. Matches the existing core-test TLE.
export const iss = {
    OBJECT_NAME: 'ISS (ZARYA)',
    NORAD_CAT_ID: 25544,
    EPOCH: '2024-01-01T12:00:00.000000',
    MEAN_MOTION: 15.50110261,
    ECCENTRICITY: 0.0006703,
    INCLINATION: 51.64,
    RA_OF_ASC_NODE: 208.9163,
    ARG_OF_PERICENTER: 30.8756,
    MEAN_ANOMALY: 329.2838,
    BSTAR: 0.0001027,
    MEAN_MOTION_DOT: 0.00016717,
    MEAN_MOTION_DDOT: 0
};
// Synthetic six-digit identifier tests identity preservation, not this object's real trajectory.
export const sixDigit = { ...iss, OBJECT_NAME: 'TEST-100001', NORAD_CAT_ID: 100001 };
export const tle = `ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9997
2 25544  51.6400 208.9163 0006703  30.8756 329.2838 15.50110261999994`;

// Vallado et al., Revisiting Spacetrack Report #3, Rev 3, Appendices D/E, satellite 5.
// https://celestrak.org/publications/AIAA/2006-6753/AIAA-2006-6753-Rev3.pdf
export const vanguard = `VANGUARD 1
1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753
2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667`;
export const referencePosition = [7022.46529266, -1400.08296755, 0.03995155];
export const referenceVelocity = [1.893841015, 6.405893759, 4.53480725];
