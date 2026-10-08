// The sailor's body: one continuous skinned mesh (a wetsuit with panels, the
// skin of the neck) over a skeleton that's set every frame from the joints
// the physics poses (models.js), so it bends at the knees, hips, shoulders
// and elbows like a body rather than a set of tubes. The head with its
// helmet and sunglasses, the fists, the booties and the harness with its
// spreader bar and hook ride rigidly on their bones.
import * as THREE from 'three';
import { BODY, ANKLE } from '../physics/body.js';
import { clamp } from '../physics/math.js';

const COL = {
  suit: new THREE.Color(0x1b2126), panel: new THREE.Color(0x168a9a), skin: new THREE.Color(0xc59474),
};
// Bones.
const TORSO = 0, HEAD = 1, UPPER = [2, 5], FORE = [3, 6], HAND = [4, 7], THIGH = [8, 11], SHIN = [9, 12], FOOT = [10, 13];
const N_BONES = 14;
const RIGHT = 0, LEFT = 1;

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Two-bone IK: the middle joint, bending toward the pole. */
function ik(root, end, l1, l2, pole) {
  const d = end.clone().sub(root);
  const dist = clamp(d.length(), 0.01, l1 + l2 - 1e-4);
  d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const side = pole.clone().addScaledVector(d, -pole.dot(d));
  if (side.lengthSq() < 1e-8) side.set(0, 0, 1).addScaledVector(d, -d.z);
  return root.clone().addScaledVector(d, a).addScaledVector(side.normalize(), h);
}

/** A bone's frame: Y along the bone, X from a reference (made square to Y), Z = X × Y. */
function frame(y, xRef, out = new THREE.Matrix4()) {
  const Y = y.clone().normalize();
  const X = xRef.clone().addScaledVector(Y, -xRef.dot(Y));
  if (X.lengthSq() < 1e-8) X.set(1, 0, 0).addScaledVector(Y, -Y.x);
  X.normalize();
  const Z = X.clone().cross(Y);
  return out.makeBasis(X, Y, Z);
}

/** Accumulates the skinned geometry: positions, colours, and up to four bone weights per vertex. */
class SkinBuilder {
  constructor() { this.pos = []; this.col = []; this.si = []; this.sw = []; this.idx = []; }
  add(p, c, weights) {
    const e = Object.entries(weights).filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = e.reduce((s, [, w]) => s + w, 0) || 1;
    this.pos.push(p.x, p.y, p.z);
    this.col.push(c.r, c.g, c.b);
    for (let j = 0; j < 4; j++) { this.si.push(e[j] ? +e[j][0] : 0); this.sw.push(e[j] ? e[j][1] / sum : 0); }
    return this.pos.length / 3 - 1;
  }

  /**
   * A tube along a straight axis (the limbs are straight in the rest pose):
   * elliptical rings { s, rx, rz, cz } at distance s along `dir`, closed
   * with a point at either end. (ex, dir, ez) must be right-handed.
   */
  tube({ o, dir, ex, ez, rings, seg, shade, weigh, caps = [true, true] }) {
    const first = this.pos.length / 3;
    for (const r of rings) {
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const p = o.clone().addScaledVector(dir, r.s).addScaledVector(ex, Math.cos(a) * r.rx).addScaledVector(ez, Math.sin(a) * r.rz + (r.cz ?? 0));
        this.add(p, shade(r, a), weigh(p, r.s, a));
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = first + i * seg + j, b = first + i * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
        this.idx.push(a, c, b, b, c, d);
      }
    }
    const cap = (ri, end) => {
      const r = rings[ri];
      const p = o.clone().addScaledVector(dir, r.s + (end ? 1 : -1) * Math.min(r.rx, r.rz) * 0.6).addScaledVector(ez, r.cz ?? 0);
      const c = this.add(p, shade(r, 0), weigh(p, r.s, 0));
      const base = first + ri * seg;
      for (let j = 0; j < seg; j++) {
        const a = base + j, b = base + ((j + 1) % seg);
        if (end) this.idx.push(c, b, a); else this.idx.push(c, a, b);
      }
    };
    if (caps[0]) cap(0, false);
    if (caps[1]) cap(rings.length - 1, true);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/** A rigid tube in a bone's own frame (booties, the harness band). */
function rigidTube(rings, seg, color, { caps = [true, true], ex = V3(1, 0, 0), dir = V3(0, 1, 0), ez = V3(0, 0, 1) } = {}) {
  const b = new SkinBuilder();
  const c = new THREE.Color(color);
  b.tube({ o: V3(), dir, ex, ez, rings, seg, shade: (r) => (r.color ? new THREE.Color(r.color) : c), weigh: () => ({ 0: 1 }), caps });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setIndex(b.idx);
  g.computeVertexNormals();
  return g;
}

export class Figure {
  constructor(height = 1.8) {
    const H = height, k = H / 1.78;
    this.H = H;
    this.root = new THREE.Group();
    const L = BODY.torso * H; // hip joint to the base of the neck
    const legL = 0.25 * H; // thigh, shin (as the pose's legs)
    const armL = 0.5 * BODY.reach * H; // upper arm; forearm with the hand to the grip
    const shW = BODY.shoulder * H, hipW = 0.085 * k;
    this.legL = legL; this.hipW = hipW;
    const sL = L / 0.552, sA = armL / 0.347, sG = legL / 0.445; // stretch the 1.78 m shapes to this body

    // ---- Rest pose: standing, facing +Z, right hand toward -X, arms a little out.
    const yHip = ANKLE + 2 * legL;
    const pelvis = V3(0, yHip, 0), neck = V3(0, yHip + L, 0);
    const headAt = neck.clone().add(V3(0, 0.09 * H, 0.02));
    const ySh = yHip + L - BODY.neckDrop * H;
    const out = 0.17; // arms 10° out from the sides
    const armDir = [V3(-Math.sin(out), -Math.cos(out), 0), V3(Math.sin(out), -Math.cos(out), 0)];
    const sh = [V3(-shW, ySh, 0), V3(shW, ySh, 0)];
    const hip = [V3(-hipW, yHip, 0), V3(hipW, yHip, 0)];
    const down = V3(0, -1, 0);
    const rest = new Array(N_BONES);
    rest[TORSO] = frame(V3(0, 1, 0), V3(1, 0, 0)).setPosition(pelvis);
    rest[HEAD] = frame(headAt.clone().sub(neck), V3(1, 0, 0)).setPosition(neck);
    // (the elbows bend toward the front, so each arm's bend axis is the body's right, -X)
    for (const s of [RIGHT, LEFT]) {
      rest[UPPER[s]] = frame(armDir[s], V3(-1, 0, 0)).setPosition(sh[s]);
      rest[FORE[s]] = frame(armDir[s], V3(-1, 0, 0)).setPosition(sh[s].clone().addScaledVector(armDir[s], armL));
      rest[HAND[s]] = frame(armDir[s], V3(-1, 0, 0)).setPosition(sh[s].clone().addScaledVector(armDir[s], 2 * armL));
      // (and the knees bend forward: the legs' bend axis is the body's left, +X)
      rest[THIGH[s]] = frame(down, V3(1, 0, 0)).setPosition(hip[s]);
      rest[SHIN[s]] = frame(down, V3(1, 0, 0)).setPosition(hip[s].clone().addScaledVector(down, legL));
      rest[FOOT[s]] = frame(V3(0, 0, 1), V3(-1, 0, 0)).setPosition(hip[s].clone().addScaledVector(down, 2 * legL));
    }
    const axes = (m) => { const x = V3(), y = V3(), z = V3(); m.extractBasis(x, y, z); return { x, y, z }; };

    // ---- The skin.
    const sb = new SkinBuilder();
    const sideOf = (x) => (x < 0 ? RIGHT : LEFT);
    // Torso, up through the neck: hips, waist, chest, shoulders (y from the hip joints, 1.78 m body).
    const torsoRings = [
      [-0.115, 0.07, 0.06, -0.004], [-0.088, 0.13, 0.092, -0.014], [-0.045, 0.163, 0.106, -0.02], [0.0, 0.171, 0.109, -0.018],
      [0.06, 0.162, 0.103, -0.008], [0.13, 0.147, 0.097, 0.0], [0.2, 0.149, 0.099, 0.006], [0.28, 0.161, 0.107, 0.014],
      [0.35, 0.174, 0.113, 0.02], [0.42, 0.184, 0.109, 0.016], [0.47, 0.188, 0.1, 0.008], [0.505, 0.172, 0.086, 0.0],
      [0.532, 0.118, 0.072, -0.004], [0.552, 0.07, 0.062, 0.0], [0.585, 0.06, 0.056, 0.006], [0.625, 0.055, 0.052, 0.01], [0.67, 0.052, 0.05, 0.012],
    ].map(([y, rx, rz, cz]) => ({ s: y * sL, rx: rx * k, rz: rz * k, cz: cz * k }));
    sb.tube({
      o: pelvis, dir: V3(0, 1, 0), ex: V3(1, 0, 0), ez: V3(0, 0, 1), rings: torsoRings, seg: 28,
      shade: (r, a) => {
        if (r.s > L + 0.075 * k) return COL.skin;
        // teal panels over the shoulders, a stripe down each side
        const lat = Math.abs(Math.cos(a));
        if (r.s > L - 0.09 * k && r.s < L + 0.01 && lat > 0.55) return COL.panel;
        if (r.s > 0.2 * k && r.s < L - 0.12 * k && lat > 0.985) return COL.panel;
        return COL.suit;
      },
      weigh: (p, y) => {
        const w = {};
        const head = smooth(L - 0.01, L + 0.06 * k, y);
        const s = sideOf(p.x), ax = Math.abs(p.x);
        const arm = 0.55 * smooth(0.55 * shW, 0.95 * shW, ax) * smooth(L - 0.17 * k, L - 0.07 * k, y) * (1 - head);
        const leg = 0.45 * smooth(0.06 * k, 0.15 * k, ax) * smooth(0.03 * k, -0.08 * k, y);
        w[HEAD] = head; w[UPPER[s]] = arm; w[THIGH[s]] = leg;
        w[TORSO] = Math.max(0, 1 - head - arm - leg);
        return w;
      },
    });
    // Arms: shoulder to wrist, the deltoid, biceps and forearm muscle.
    const armRings = [
      [-0.045, 0.05, 0.05, 0], [0.0, 0.06, 0.062, 0], [0.05, 0.058, 0.058, 0], [0.12, 0.05, 0.053, 0.004], [0.2, 0.046, 0.048, 0.004],
      [0.28, 0.042, 0.043, 0], [0.347, 0.04, 0.041, -0.002], [0.4, 0.043, 0.04, 0.003], [0.47, 0.039, 0.035, 0.002], [0.55, 0.032, 0.028, 0], [0.605, 0.027, 0.023, 0],
    ].map(([s, rx, rz, cz]) => ({ s: s * sA, rx: rx * k * 1.08, rz: rz * k * 1.08, cz: cz * k }));
    for (const s of [RIGHT, LEFT]) {
      const a = axes(rest[UPPER[s]]);
      sb.tube({
        o: sh[s], dir: a.y, ex: a.x, ez: a.z, rings: armRings, seg: 14,
        shade: (r) => (r.s < 0.82 * armL ? COL.panel : COL.suit),
        weigh: (p, d) => {
          const torso = 0.45 * smooth(0.03, -0.045 * k, d);
          const t = smooth(armL - 0.05 * k, armL + 0.05 * k, d);
          return { [TORSO]: torso, [UPPER[s]]: (1 - torso) * (1 - t), [FORE[s]]: (1 - torso) * t };
        },
      });
    }
    // Legs: hip to ankle; the quads in front, the kneecap, the calf behind.
    // (in the legs' frames +Z is the back of the leg)
    const legRings = [
      [-0.07, 0.07, 0.07, 0], [-0.02, 0.088, 0.09, 0], [0.06, 0.088, 0.088, 0], [0.16, 0.08, 0.08, -0.004], [0.28, 0.068, 0.068, -0.003],
      [0.38, 0.056, 0.056, 0], [0.445, 0.05, 0.052, -0.004], [0.5, 0.05, 0.052, 0.006], [0.58, 0.053, 0.058, 0.012], [0.68, 0.045, 0.046, 0.006],
      [0.78, 0.036, 0.036, 0], [0.86, 0.034, 0.034, 0],
    ].map(([s, rx, rz, cz]) => ({ s: s * sG, rx: rx * k * 1.1, rz: rz * k * 1.1, cz: cz * k }));
    for (const s of [RIGHT, LEFT]) {
      const a = axes(rest[THIGH[s]]);
      const outward = s === RIGHT ? -1 : 1; // the outside of the leg, along the frame's X
      sb.tube({
        o: hip[s], dir: a.y, ex: a.x, ez: a.z, rings: legRings, seg: 16,
        shade: (r, ang) => (r.s > 0.05 * k && r.s < 0.8 * legL && Math.cos(ang) * outward > 0.93 ? COL.panel : COL.suit),
        weigh: (p, d) => {
          const torso = 0.45 * smooth(0.05 * k, -0.07 * k, d);
          const t = smooth(legL - 0.055 * k, legL + 0.055 * k, d);
          return { [TORSO]: torso, [THIGH[s]]: (1 - torso) * (1 - t), [SHIN[s]]: (1 - torso) * t };
        },
      });
    }
    const geo = sb.geometry();
    const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0 });
    this.mesh = new THREE.SkinnedMesh(geo, skinMat);
    this.mesh.frustumCulled = false; // (posed far from the rest pose, e.g. flying over the boom)
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.bones = Array.from({ length: N_BONES }, () => new THREE.Bone());
    for (const b of this.bones) this.mesh.add(b);
    const inverses = rest.map((m) => m.clone().invert());
    this.mesh.bind(new THREE.Skeleton(this.bones, inverses), new THREE.Matrix4());
    this.root.add(this.mesh);
    rest.forEach((m, i) => m.decompose(this.bones[i].position, this.bones[i].quaternion, this.bones[i].scale));

    // ---- Rigid parts on their bones (in the bone's own frame).
    const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
    const skin = std(0xc59474, { roughness: 0.7 });
    const add = (bone, mesh, at, scale) => {
      if (at) mesh.position.copy(at);
      if (scale) mesh.scale.copy(scale);
      mesh.castShadow = true;
      this.bones[bone].add(mesh);
      return mesh;
    };
    // Head (frame: origin at the base of the neck, Y up the head, Z the face, X its left).
    const hd = headAt.distanceTo(neck) - 0.012 * k; // (the skull's centre, a little below the pose's head point)
    const sphere = (n = 20, m = 14) => new THREE.SphereGeometry(1, n, m);
    add(HEAD, new THREE.Mesh(sphere(24, 18), skin), V3(0, hd, 0.004), V3(0.074 * k, 0.097 * k, 0.088 * k));
    add(HEAD, new THREE.Mesh(sphere(), skin), V3(0, hd - 0.052 * k, 0.026 * k), V3(0.058 * k, 0.05 * k, 0.063 * k)); // jaw
    const nose = add(HEAD, new THREE.Mesh(new THREE.ConeGeometry(0.014 * k, 0.034 * k, 8), skin), V3(0, hd - 0.012 * k, 0.093 * k));
    nose.rotation.x = Math.PI / 2 + 0.35;
    // Wraparound sunglasses.
    const glasses = add(HEAD, new THREE.Mesh(new THREE.CylinderGeometry(0.09 * k, 0.088 * k, 0.026 * k, 24, 1, true, -1.05, 2.1),
      std(0x0d1216, { roughness: 0.12, metalness: 0.5, side: THREE.DoubleSide })), V3(0, hd + 0.014 * k, 0.0));
    glasses.scale.set(0.84, 1, 1);
    // Helmet: a white shell over the top and back, ear covers and a chin strap.
    const shellMat = std(0xf1f2ee, { roughness: 0.35 });
    const shell = add(HEAD, new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), shellMat),
      V3(0, hd + 0.024 * k, -0.012 * k), V3(0.083 * k, 0.098 * k, 0.096 * k));
    shell.rotation.x = -0.5;
    for (const x of [-1, 1]) {
      const ear = add(HEAD, new THREE.Mesh(sphere(14, 10), shellMat), V3(x * 0.07 * k, hd - 0.002 * k, -0.014 * k), V3(0.014 * k, 0.03 * k, 0.03 * k));
      ear.castShadow = false;
    }
    const strap = add(HEAD, new THREE.Mesh(new THREE.TorusGeometry(0.078 * k, 0.0045 * k, 5, 18, Math.PI), std(0x111417)), V3(0, hd - 0.012 * k, 0.004 * k));
    strap.rotation.set(-0.42, 0, Math.PI);
    strap.scale.set(1, 1.05, 1);
    // Fists round the boom (frame: Y along the forearm, origin at the grip).
    for (const s of [RIGHT, LEFT]) {
      add(HAND[s], new THREE.Mesh(sphere(16, 12), skin), V3(0, -0.004, 0), V3(0.04 * k, 0.05 * k, 0.034 * k));
      const thumb = add(HAND[s], new THREE.Mesh(new THREE.CapsuleGeometry(0.011 * k, 0.03 * k, 3, 8), skin), V3(0, -0.012 * k, 0.03 * k));
      thumb.rotation.x = 0.6;
    }
    // Neoprene booties (frame: Y toward the toes, Z up, origin at the ankle).
    const bootRings = [
      [-0.07, 0.03, 0.035, -0.035], [-0.05, 0.04, 0.05, -0.028], [-0.01, 0.045, 0.062, -0.016], [0.04, 0.047, 0.045, -0.034],
      [0.1, 0.047, 0.03, -0.047], [0.16, 0.043, 0.022, -0.054], [0.2, 0.034, 0.016, -0.059], [0.22, 0.02, 0.01, -0.062],
    ].map(([s, rx, rz, cz]) => ({ s: s * k, rx: rx * k, rz: rz * k, cz: cz * k }));
    const bootGeo = rigidTube(bootRings, 14, 0x262c31);
    const bootMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    const collarGeo = new THREE.CylinderGeometry(0.043 * k, 0.046 * k, 0.07 * k, 14, 1, false);
    collarGeo.rotateX(Math.PI / 2);
    for (const s of [RIGHT, LEFT]) {
      add(FOOT[s], new THREE.Mesh(bootGeo, bootMat));
      add(FOOT[s], new THREE.Mesh(collarGeo, std(0x262c31, { roughness: 0.75 })), V3(0, -0.006 * k, 0.012 * k));
    }
    // The harness: a waist band round the hips, a spreader bar across the front and the hook.
    const at = (y) => {
      // (the torso's cross-section at height y, a little proud of it)
      let i = 1;
      while (i < torsoRings.length - 1 && torsoRings[i].s < y) i++;
      const a = torsoRings[i - 1], b = torsoRings[i], t = clamp((y - a.s) / (b.s - a.s), 0, 1);
      return { s: y, rx: (a.rx + (b.rx - a.rx) * t) * 1.02 + 0.004, rz: (a.rz + (b.rz - a.rz) * t) * 1.02 + 0.004, cz: a.cz + (b.cz - a.cz) * t };
    };
    const bandRings = [at(0.04 * k), at(0.048 * k), at(0.14 * k), at(0.15 * k)];
    bandRings[0].color = 0x14181b; bandRings[3].color = 0x14181b;
    const band = rigidTube(bandRings, 28, 0xff7a1a, { caps: [false, false] });
    const bandMesh = add(TORSO, new THREE.Mesh(band, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide })));
    bandMesh.receiveShadow = true;
    const front = at(0.095 * k);
    const zBar = front.cz + front.rz + 0.022 * k;
    const bar = add(TORSO, new THREE.Mesh(new THREE.CapsuleGeometry(0.011 * k, 0.2 * k, 3, 8), std(0x9aa3a8, { metalness: 0.7, roughness: 0.35 })), V3(0, 0.095 * k, zBar));
    bar.rotation.z = Math.PI / 2;
    const hook = add(TORSO, new THREE.Mesh(new THREE.TorusGeometry(0.03 * k, 0.008 * k, 6, 12, Math.PI * 1.25), std(0xcfd4d6, { metalness: 0.85, roughness: 0.25 })),
      V3(0, 0.095 * k + 0.006, zBar + 0.035 * k));
    hook.rotation.set(Math.PI / 2, 0, -Math.PI * 0.125);
    this.hookOffset = V3(0, 0.1 * k, zBar + 0.05 * k);
    this.hookPos = V3();

    this.last = { F: V3(0, 0, 1), arm: [null, null], leg: [null, null] };
  }

  /**
   * Set the skeleton from the posed joints (board frame). p has the joints
   * of models.js plus `front`, a point the chest faces; onBoard: the feet
   * stand on the deck (else they point along the shins). toes: the feet's
   * directions on the deck, [front foot, back foot].
   */
  update(p, { onBoard = true, toes = null, lookAt = null } = {}) {
    const legL = this.legL;
    const U = p.neck.clone().sub(p.pelvis).normalize();
    // Facing: square to the spine (keep last frame's if it's ambiguous).
    const fh = p.front.clone().sub(p.chest);
    let F = fh.addScaledVector(U, -fh.dot(U));
    if (F.lengthSq() < 1e-6) F = this.last.F.clone().addScaledVector(U, -this.last.F.dot(U));
    F.normalize();
    this.last.F.copy(F);
    const R = F.clone().cross(U).normalize(); // the body's right
    const set = (i, m, at) => { m.setPosition(at); m.decompose(this.bones[i].position, this.bones[i].quaternion, this.bones[i].scale); };
    const m = new THREE.Matrix4();
    set(TORSO, frame(U, R.clone().negate(), m), p.pelvis);
    // The head turns to look where you're going (past the mast), up to 70° off the chest.
    const hy = p.head.clone().sub(p.neck).normalize();
    let look = F.clone();
    if (lookAt) {
      const d = lookAt.clone().sub(p.neck);
      d.addScaledVector(hy, -d.dot(hy));
      if (d.lengthSq() > 1e-6) {
        d.normalize();
        const ang = Math.min(Math.acos(clamp(d.dot(F), -1, 1)), 70 * Math.PI / 180);
        const axis = F.clone().cross(d);
        if (axis.lengthSq() > 1e-8) look = F.clone().applyAxisAngle(axis.normalize(), ang);
      }
    }
    set(HEAD, frame(hy, hy.clone().cross(look), m), p.neck);

    // Arms: whichever posed shoulder is on the body's right is the right arm.
    const shLRight = p.shL.clone().sub(p.shR).dot(R) > 0;
    const arms = shLRight ? [['shL', 'elL', 'haL'], ['shR', 'elR', 'haR']] : [['shR', 'elR', 'haR'], ['shL', 'elL', 'haL']];
    for (const s of [RIGHT, LEFT]) {
      const [sh, el, ha] = arms[s].map((j) => p[j]);
      const up = el.clone().sub(sh), fo = ha.clone().sub(el);
      let n = up.clone().cross(fo);
      if (n.lengthSq() < 1e-6 * up.lengthSq() * fo.lengthSq()) n = this.last.arm[s] ?? R.clone();
      n.normalize();
      this.last.arm[s] = n.clone();
      set(UPPER[s], frame(up, n, m), sh);
      set(FORE[s], frame(fo, n, m), el);
      set(HAND[s], frame(fo, n, m), ha);
    }
    // Legs: hips either side of the pelvis joint, knees bent the way the pose bends them.
    const fRight = p.footF.clone().sub(p.footB).dot(R) > 0;
    const legs = fRight ? [['footF', 'kneeF', 0], ['footB', 'kneeB', 1]] : [['footB', 'kneeB', 1], ['footF', 'kneeF', 0]];
    for (const s of [RIGHT, LEFT]) {
      const [fj, kj, which] = legs[s];
      const foot = p[fj];
      let hip = p.pelvis.clone().addScaledVector(R, s === RIGHT ? this.hipW : -this.hipW);
      const span = hip.distanceTo(foot);
      if (span > 2 * legL * 0.999) hip = foot.clone().addScaledVector(hip.clone().sub(foot).normalize(), 2 * legL * 0.999);
      const pole = p[kj].clone().sub(hip.clone().add(foot).multiplyScalar(0.5));
      const knee = ik(hip, foot, legL, legL, pole.lengthSq() > 1e-8 ? pole : F);
      const th = knee.clone().sub(hip), sn = foot.clone().sub(knee);
      let n = th.clone().cross(sn);
      if (n.lengthSq() < 1e-6 * th.lengthSq() * sn.lengthSq()) n = this.last.leg[s] ?? R.clone().negate();
      n.normalize();
      this.last.leg[s] = n.clone();
      set(THIGH[s], frame(th, n, m), hip);
      set(SHIN[s], frame(sn, n, m), knee);
      // Feet flat on the deck pointing where the stance puts them; off the board, pointed.
      if (onBoard && toes) {
        const t = toes[which].clone();
        set(FOOT[s], frame(t, t.clone().cross(V3(0, 1, 0)), m), foot);
      } else {
        const t = sn.clone().normalize().multiplyScalar(0.6).add(F.clone().multiplyScalar(0.8)).normalize();
        set(FOOT[s], frame(t, n.clone().negate(), m), foot);
      }
    }
    // The hook, for the harness lines.
    this.bones[TORSO].updateMatrix();
    this.hookPos.copy(this.hookOffset).applyMatrix4(this.bones[TORSO].matrix);
  }
}
