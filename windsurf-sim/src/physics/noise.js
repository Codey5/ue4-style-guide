// Deterministic value noise. The exact same integer hash and interpolation is
// implemented in GLSL (see render/water.js) so the gust patches drawn on the
// water are the gusts the physics actually feels.

function hash3(ix, iy, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1440662683)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** 3D value noise in [-1, 1]. */
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fade(fx), uy = fade(fy), uz = fade(fz);
  const c000 = hash3(ix, iy, iz), c100 = hash3(ix + 1, iy, iz);
  const c010 = hash3(ix, iy + 1, iz), c110 = hash3(ix + 1, iy + 1, iz);
  const c001 = hash3(ix, iy, iz + 1), c101 = hash3(ix + 1, iy, iz + 1);
  const c011 = hash3(ix, iy + 1, iz + 1), c111 = hash3(ix + 1, iy + 1, iz + 1);
  const x00 = c000 + (c100 - c000) * ux, x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux, x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy, y1 = x01 + (x11 - x01) * uy;
  return (y0 + (y1 - y0) * uz) * 2 - 1;
}

/** Three-octave fractal noise, roughly in [-1, 1]. */
export function fbm3(x, y, z) {
  return (noise3(x, y, z) * 0.6 + noise3(x * 2.03 + 17.1, y * 2.03 + 5.3, z * 1.7) * 0.28 +
    noise3(x * 4.1 + 31.7, y * 4.1 + 11.9, z * 2.9) * 0.12) * 1.45;
}

/** 1D smooth noise in [-1, 1], used for slow wind shifts. */
export const noise1 = (t, seed = 0) => noise3(t, seed * 13.37, 0.5);
