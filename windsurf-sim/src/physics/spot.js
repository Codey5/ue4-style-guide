// The spot's speed strip: a long, low sandbar offshore, angled so that
// sailing along it is a broad reach on starboard tack. The chop can't get
// past it, so the water in its lee is flat right behind it and builds up
// again with distance downwind (fetch) — where speedsurfers go for records.
// The physics, the water shader and the wake all use the same numbers.
import { clamp, smoothstep } from './math.js';

export const SANDBAR = {
  ax: 450, az: 0, // its upwind (northern) end, world metres
  lx: 0.5, lz: Math.sqrt(3) / 2, // direction along it (120° off the wind from the west)
  length: 900,
  halfWidth: 8,
  course: [150, 650], // the marked 500 m course, metres along the bar
  laneD: 30, // the course runs this far into the lee of the bar's centre line
};

/**
 * Bar coordinates of a world point: s metres along the bar from its upwind
 * end, d metres downwind of its centre line (measured along the wind).
 * (wx, wz): unit vector the mean wind blows toward.
 */
export function barCoords(bar, wx, wz, x, z) {
  const px = x - bar.ax, pz = z - bar.az;
  const det = bar.lx * wz - bar.lz * wx;
  return [(px * wz - pz * wx) / det, (bar.lx * pz - bar.lz * px) / det];
}

/** The world point at bar coordinates (s, d). */
export function barPoint(bar, wx, wz, s, d) {
  return [bar.ax + bar.lx * s + wx * d, bar.az + bar.lz * s + wz * d];
}

/** Put a sim at the top of the speed strip, in the bar's lee, already heading down it. */
export function placeAtStrip(sim, bar = SANDBAR) {
  const wd = sim.wind.dir;
  const [x, z] = barPoint(bar, wd[0], wd[2], 40, bar.halfWidth + bar.laneD);
  sim.reset('sailing', [x, 0, z]);
  sim.yaw = Math.atan2(-bar.lz, bar.lx);
  sim.vel = [bar.lx * 5, 0, bar.lz * 5];
}

/** How much of the bar's length shelters this point (fading out round its ends). */
const alongMask = (bar, s) => smoothstep(-120, 60, s) * (1 - smoothstep(bar.length - 60, bar.length + 120, s));

/**
 * Chop amplitude factor at a point (0..1): the chop shoals and breaks on
 * the windward edge, is flat just to leeward (6%), and builds back to full
 * over about 450 m of fetch. Mirrored in the water shader.
 */
export function shelterAt(bar, wx, wz, x, z) {
  if (!bar) return 1;
  const [s, d] = barCoords(bar, wx, wz, x, z);
  const along = alongMask(bar, s);
  if (along <= 0) return 1;
  const lee = smoothstep(-bar.halfWidth - 14, -bar.halfWidth + 2, d);
  const fetch = 0.06 + 0.94 * smoothstep(20, 450, d - bar.halfWidth);
  return 1 - along * lee * (1 - fetch);
}

/** Whether a point is on the sand (the bar's dry top and its shallows). */
export function onBar(bar, wx, wz, x, z) {
  if (!bar) return false;
  const [s, d] = barCoords(bar, wx, wz, x, z);
  const taper = clamp(Math.min(s, bar.length - s) / 40, 0, 1); // (rounded ends)
  return s > 0 && s < bar.length && Math.abs(d) < (bar.halfWidth - 1) * taper;
}

/** GLSL for the water shader: uBar = (ax, az, lx, lz), uBar2 = (length, halfWidth, on). */
export const SHELTER_GLSL = /* glsl */ `
uniform vec4 uBar;
uniform vec3 uBar2;
vec2 barCoords(vec2 p, vec2 w) {
  vec2 q = p - uBar.xy;
  float det = uBar.z * w.y - uBar.w * w.x;
  return vec2((q.x * w.y - q.y * w.x) / det, (uBar.z * q.y - uBar.w * q.x) / det);
}
float barAlong(float s) { return smoothstep(-120.0, 60.0, s) * (1.0 - smoothstep(uBar2.x - 60.0, uBar2.x + 120.0, s)); }
float shelterAt(vec2 p, vec2 w) {
  if (uBar2.z < 0.5) return 1.0;
  vec2 sd = barCoords(p, w);
  float along = barAlong(sd.x);
  float lee = smoothstep(-uBar2.y - 14.0, -uBar2.y + 2.0, sd.y);
  float fetch = 0.06 + 0.94 * smoothstep(20.0, 450.0, sd.y - uBar2.y);
  return 1.0 - along * lee * (1.0 - fetch);
}
`;
