// Small, allocation-light vector helpers used by the physics code.
// Vectors are plain [x, y, z] arrays. World frame: +X east, +Y up, -Z north.
// Board frame: +X bow (forward), +Y up (deck normal), +Z starboard.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const G = 9.81;
export const RHO_AIR = 1.225;
export const RHO_WATER = 1025;
export const NU_WATER = 1.19e-6; // kinematic viscosity of sea water, 15 °C
export const MS_TO_KN = 1.943844;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const addScaled = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Wrap an angle to (-PI, PI]. */
export const wrapAngle = (a) => {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
};
/** Move `x` toward `target` by at most `maxStep`. */
export const approach = (x, target, maxStep) =>
  x < target ? Math.min(target, x + maxStep) : Math.max(target, x - maxStep);
/** Frame-rate independent exponential smoothing. */
export const damp = (x, target, rate, dt) => target + (x - target) * Math.exp(-rate * dt);

// 3x3 matrices, row-major [m00, m01, m02, m10, ...].
export function mat3Mul(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}
export const mulMV = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
/** Multiply by the transpose (inverse for rotations): world -> local. */
export const mulMtV = (m, v) => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

/**
 * Board -> world rotation. yaw about +Y (positive turns the bow to port),
 * pitch about the board's +Z (positive lifts the nose), roll about +X
 * (positive sinks the starboard rail). Equivalent to three.js Euler order 'YZX'.
 */
export function boardMatrix(yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz = [cp, -sp, 0, sp, cp, 0, 0, 0, 1];
  const Rx = [1, 0, 0, 0, cr, -sr, 0, sr, cr];
  return mat3Mul(mat3Mul(Ry, Rz), Rx);
}
