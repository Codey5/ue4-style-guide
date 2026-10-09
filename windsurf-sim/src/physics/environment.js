// Wind field (mean wind, gusts, shifts, boundary-layer gradient) and the
// wind-driven chop on the water surface.
import { DEG, MS_TO_KN, clamp } from './math.js';
import { fbm3, noise1 } from './noise.js';
import { shelterAt } from './spot.js';
import { tw } from '../tweaks.js';

export const GUST_SCALE = 170; // metres: typical size of a gust patch
export const GUST_EVOLVE = 45; // seconds for the gust pattern to reshape itself
export const GUST_ADVECT = 0.85; // gust patches travel at ~85% of the mean wind
const Z0 = 0.0002; // roughness length of open water (m)
const LOG_REF = Math.log(10 / Z0);

/** Wind speed at height h relative to the 10 m reference (logarithmic profile). */
export const heightFactor = (h) => Math.log(Math.max(h, 0.25) / Z0) / LOG_REF;

export class Wind {
  constructor(opts = {}) {
    this.speedKn = opts.speedKn ?? 16; // forecast wind at 10 m
    this.fromDeg = opts.fromDeg ?? 270; // meteorological: where it blows FROM
    this.gustiness = opts.gustiness ?? 0.45; // 0 = laminar, 1 = very gusty
    this.shifts = opts.shifts ?? 0.5; // direction shift amount 0..1
    this.chop = opts.chop ?? 1; // chop multiplier
    this.boost = 0; // extra wind everywhere (a scripted gust, as a fraction)
  }

  get speed() {
    return this.speedKn / MS_TO_KN;
  }

  /** Unit vector the mean wind blows TOWARD (horizontal). */
  get dir() {
    const a = this.fromDeg * DEG;
    return [-Math.sin(a), 0, Math.cos(a)];
  }

  /** Gust multiplier at a point. Mirrored in the water shader. */
  gustFactor(x, z, t) {
    if (this.gustiness <= 0) return 1;
    const d = this.dir, adv = this.speed * GUST_ADVECT * t;
    const n = fbm3((x - d[0] * adv) / GUST_SCALE, (z - d[2] * adv) / GUST_SCALE, t / GUST_EVOLVE);
    return Math.max(0.2, 1 + 0.42 * this.gustiness * tw.physics.gusts * clamp(n, -1.2, 1.2));
  }

  /** Direction offset (radians, positive = veer clockwise) at a point. */
  shiftAngle(x, z, t) {
    if (this.shifts <= 0) return 0;
    const slow = noise1(t / 80, 3) * 9 + noise1(t / 23, 7) * 3;
    const d = this.dir, adv = this.speed * GUST_ADVECT * t;
    const local = fbm3((x - d[0] * adv) / (GUST_SCALE * 1.3) + 40, (z - d[2] * adv) / (GUST_SCALE * 1.3), t / GUST_EVOLVE) * 4;
    return this.shifts * (slow + local) * DEG;
  }

  /** True wind velocity vector (m/s) at world point (x, height h, z). */
  sample(x, h, z, t) {
    const speed = this.speed * (1 + this.boost) * this.gustFactor(x, z, t) * heightFactor(h);
    const a = this.fromDeg * DEG + this.shiftAngle(x, z, t);
    return [-Math.sin(a) * speed, 0, Math.cos(a) * speed];
  }
}

/**
 * Wind-driven chop: a handful of directional wave trains travelling downwind.
 * The water shader uses the same components (with Gerstner displacement).
 * A sandbar (see spot.js), when the spot has one, shelters the water in its
 * lee: there the chop is scaled down, to flat right behind it.
 */
export class Waves {
  constructor(wind, bar = null) {
    this.wind = wind;
    this.bar = bar;
    this.rebuild();
  }

  /** Chop amplitude factor at a point: 1 in open water, less in the sandbar's lee. */
  shelter(x, z) {
    if (!this.bar) return 1;
    const d = this.wind.dir;
    return shelterAt(this.bar, d[0], d[2], x, z);
  }

  /** Significant wave height here (m). */
  hsAt(x, z) {
    return this.hs * this.shelter(x, z);
  }

  rebuild() {
    const U = this.wind.speed;
    // Significant height of fetch-limited chop on a semi-sheltered spot.
    const hs = 0.02 * Math.pow(U, 1.35) * this.wind.chop;
    const lp = 2.5 + 0.55 * U; // peak wavelength (m)
    const base = Math.atan2(this.wind.dir[2], this.wind.dir[0]);
    const spec = [
      [1.0, 0, 0.42, 0.3], [0.72, 24, 0.3, 1.7], [0.55, -31, 0.26, 4.1],
      [1.38, -11, 0.28, 2.6], [0.41, 47, 0.16, 5.3], [0.86, 14, 0.22, 0.9],
      [0.3, -58, 0.1, 3.3], [0.24, 70, 0.07, 6.0],
    ];
    this.hs = hs;
    this.components = spec.map(([lf, angDeg, af, phase]) => {
      const lambda = lp * lf;
      const k = (2 * Math.PI) / lambda;
      const omega = Math.sqrt(9.81 * k); // deep-water dispersion
      const ang = base + angDeg * DEG;
      return { dx: Math.cos(ang), dz: Math.sin(ang), k, omega, amp: (hs * 0.5) * af, phase, lambda };
    });
  }

  height(x, z, t) {
    let h = 0;
    for (const c of this.components) h += c.amp * Math.sin(c.k * (c.dx * x + c.dz * z) - c.omega * t + c.phase);
    return h * this.shelter(x, z);
  }

  /** Vertical velocity of the surface (m/s) — used for board bounce. */
  verticalVelocity(x, z, t) {
    let v = 0;
    for (const c of this.components) v -= c.amp * c.omega * Math.cos(c.k * (c.dx * x + c.dz * z) - c.omega * t + c.phase);
    return v * this.shelter(x, z);
  }
}
