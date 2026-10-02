// Board, rig and sailor models, posed every frame from the simulation state.
import * as THREE from 'three';
import { DEG, clamp, lerp, smoothstep } from '../physics/math.js';
import { rigAxes } from '../physics/sail.js';
import { S } from '../physics/sim.js';

// ---------------------------------------------------------------------------
// Board

function boardShape(board) {
  const L = board.length, W = board.width;
  const halfWidth = (s) => {
    const sw = 0.42;
    const tail = board.tailWidth * 0.42;
    if (s <= sw) return lerp(tail, W / 2, Math.pow(Math.sin((Math.PI / 2) * (s / sw)), 0.75));
    const k = (s - sw) / (1 - sw);
    return (W / 2) * Math.sqrt(Math.max(0, 1 - Math.pow(k, 2.3)));
  };
  const thick = (s) => board.thickness * (0.38 + 0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 0.6)) * (s > 0.9 ? 1 - (s - 0.9) * 4 : 1);
  const rocker = (s) => (s > 0.62 ? 0.17 * Math.pow((s - 0.62) / 0.38, 2.4) : 0) + (s < 0.05 ? (0.05 - s) * 0.1 : 0);
  return { L, halfWidth, thick, rocker, sOf: (x) => (x + L / 2) / L };
}

/** Deck height (board frame) at board x — where the sailor's feet go. */
export function deckY(board, x) {
  const sh = boardShape(board);
  const s = clamp(sh.sOf(x), 0, 1);
  return sh.rocker(s) + sh.thick(s);
}

export function buildBoard(board) {
  const group = new THREE.Group();
  const sh = boardShape(board);
  const NL = 64, NC = 28;
  const positions = [], colors = [], indices = [];
  const base = new THREE.Color(board.color);
  const pad = new THREE.Color(0x3a3d40);
  const hull = new THREE.Color(0xf1f1ec);
  const stripe = new THREE.Color(0x1e2a33);
  for (let i = 0; i <= NL; i++) {
    const s = i / NL;
    const x = -sh.L / 2 + s * sh.L;
    const w = Math.max(sh.halfWidth(s), 0.004);
    const t = Math.max(sh.thick(s), 0.01);
    const yb = sh.rocker(s);
    for (let j = 0; j < NC; j++) {
      const a = (j / NC) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const z = w * Math.sign(c) * Math.pow(Math.abs(c), 0.45);
      const yy = yb + t / 2 + (t / 2) * Math.sign(sn) * Math.pow(Math.abs(sn), sn > 0 ? 0.35 : 0.6);
      positions.push(x, yy, z);
      let col = base;
      if (sn < -0.2) col = hull;
      else if (sn > 0.55) {
        const inPad = x > board.backStrapX - 0.22 && x < board.mastFootX + 0.32;
        col = inPad ? pad : base;
        if (!inPad && Math.abs(z) < 0.03 && s > 0.62) col = stripe;
      }
      colors.push(col.r, col.g, col.b);
    }
  }
  for (let i = 0; i < NL; i++) {
    for (let j = 0; j < NC; j++) {
      const a = i * NC + j, b = i * NC + ((j + 1) % NC), c = a + NC, d = b + NC;
      indices.push(a, c, b, b, c, d);
    }
  }
  // Transom cap.
  const center = positions.length / 3;
  positions.push(-sh.L / 2, sh.rocker(0) + sh.thick(0) / 2, 0);
  colors.push(hull.r, hull.g, hull.b);
  for (let j = 0; j < NC; j++) indices.push(center, j, (j + 1) % NC);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // Fin: swept freeride fin under the tail.
  const finShape = new THREE.Shape();
  const d = board.finDepth, root = Math.max(0.1, board.finArea / d * 1.25);
  finShape.moveTo(0, 0);
  finShape.lineTo(-root, 0);
  finShape.quadraticCurveTo(-root * 0.9, -d * 0.55, -root * 0.55 - d * 0.18, -d);
  finShape.quadraticCurveTo(-root * 0.15 - d * 0.12, -d * 0.97, -d * 0.05, -d * 0.4);
  finShape.lineTo(0, 0);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
  finGeo.translate(0, 0, -0.006);
  const fin = new THREE.Mesh(finGeo, new THREE.MeshStandardMaterial({ color: 0x1b1f22, roughness: 0.4 }));
  fin.position.set(board.transomX + 0.12 + root, 0.01, 0);
  fin.castShadow = true;
  group.add(fin);

  if (board.dagger) {
    const dg = new THREE.Mesh(new THREE.BoxGeometry(0.22, board.dagger.depth, 0.025), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 }));
    dg.position.set(board.dagger.x, -board.dagger.depth / 2 + 0.02, 0);
    group.add(dg);
  }

  // Footstraps: front pair near the rails, back pair inboard.
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.8 });
  const strapGeo = new THREE.TorusGeometry(0.075, 0.02, 6, 12, Math.PI);
  const straps = [];
  for (const [x, zf] of [[board.frontStrapX, 0.29], [board.backStrapX, 0.2]]) {
    for (const side of [-1, 1]) {
      const st = new THREE.Mesh(strapGeo, strapMat);
      st.position.set(x, deckY(board, x), side * zf * board.width);
      st.scale.set(1.2, 0.85, 1);
      group.add(st);
      straps.push(st);
    }
  }
  // Mast track and base.
  const mastBase = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.6 }));
  mastBase.position.set(board.mastFootX, deckY(board, board.mastFootX) + 0.03, 0);
  group.add(mastBase);
  return group;
}

// ---------------------------------------------------------------------------
// Rig

const SAIL_NU = 18, SAIL_NV = 44;

export class Rig {
  constructor(geo) {
    this.geo = geo;
    this.group = new THREE.Group();
    const L = geo.boomLength;
    this.boomLength = L;
    // Mast: tapered carbon tube from the base to the head of the sail.
    const mastLen = geo.head + 0.05;
    const mastGeo = new THREE.CylinderGeometry(0.012, 0.024, mastLen, 10, 1);
    mastGeo.translate(0, mastLen / 2, 0);
    const mast = new THREE.Mesh(mastGeo, new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.35, metalness: 0.2 }));
    mast.castShadow = true;
    this.group.add(mast);
    // Wishbone boom: two curved tubes around the sail.
    const boomMat = new THREE.MeshStandardMaterial({ color: 0xbfc5cc, roughness: 0.3, metalness: 0.7 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x202326, roughness: 0.9 });
    this.tubeOffset = (x) => 0.2 * Math.pow(Math.sin(Math.PI * clamp(x / L, 0, 1)), 0.7) + 0.02;
    for (const sideZ of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const x = -0.06 + (i / 16) * (L + 0.08);
        pts.push(new THREE.Vector3(x, geo.boomHeight + (x / L) * 0.06, sideZ * this.tubeOffset(x)));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.017, 8), boomMat);
      tube.castShadow = true;
      this.group.add(tube);
      const grip = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.slice(1, 10)), 20, 0.02, 8), gripMat);
      this.group.add(grip);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.08), gripMat);
    head.position.set(-0.04, geo.boomHeight, 0);
    this.group.add(head);

    // Sail membrane.
    const n = (SAIL_NU + 1) * (SAIL_NV + 1);
    this.sailPos = new Float32Array(n * 3);
    const colors = new Float32Array(n * 4);
    const idx = [];
    const yellow = new THREE.Color(0xf6c21c), teal = new THREE.Color(0x0e5a6b), char = new THREE.Color(0x25292e),
      film = new THREE.Color(0xd9e6ee), red = new THREE.Color(0xe2412b);
    for (let v = 0; v <= SAIL_NV; v++) {
      for (let u = 0; u <= SAIL_NU; u++) {
        const k = v * (SAIL_NU + 1) + u;
        const fv = v / SAIL_NV, fu = u / SAIL_NU;
        let c = film, a = 0.55;
        if (fu < 0.12) { c = yellow; a = 0.97; }
        else if (fv > 0.78) { c = teal; a = 0.96; }
        else if (fv > 0.72) { c = red; a = 0.96; }
        else if (fv < 0.16) { c = char; a = 0.95; }
        else if (fv > 0.5 && fu > 0.55) { c = teal; a = 0.93; }
        colors.set([c.r, c.g, c.b, a], k * 4);
        if (u < SAIL_NU && v < SAIL_NV) {
          const b = k + SAIL_NU + 1;
          idx.push(k, b, k + 1, k + 1, b, b + 1);
        }
      }
    }
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute('position', new THREE.BufferAttribute(this.sailPos, 3));
    sailGeo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    sailGeo.setIndex(idx);
    this.sailGeo = sailGeo;
    this.sail = new THREE.Mesh(sailGeo, new THREE.MeshStandardMaterial({
      vertexColors: true, transparent: true, side: THREE.DoubleSide, roughness: 0.5, metalness: 0, depthWrite: false,
    }));
    this.sail.castShadow = true;
    this.sail.frustumCulled = false;
    this.group.add(this.sail);

    // Battens.
    this.battenRows = [0.2, 0.33, 0.46, 0.58, 0.69, 0.79, 0.88];
    const bPos = new Float32Array(this.battenRows.length * SAIL_NU * 2 * 3);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
    this.battens = new THREE.LineSegments(bGeo, new THREE.LineBasicMaterial({ color: 0x1a1d20 }));
    this.battens.frustumCulled = false;
    this.group.add(this.battens);

    // Harness lines and uphaul.
    const lineMat = new THREE.LineBasicMaterial({ color: 0x111111 });
    this.harness = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new Array(14).fill(0).map(() => new THREE.Vector3())), lineMat);
    this.harness.frustumCulled = false;
    this.group.add(this.harness);
    const up = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      up.push(new THREE.Vector3(0.05 + Math.sin(Math.PI * t) * 0.18, geo.boomHeight * (1 - t) + 0.25 * t, 0));
    }
    this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(up), new THREE.LineBasicMaterial({ color: 0xd9d9d9 })));
    this.flutterPhase = 0;
    this.camber = 0;
  }

  /** Point on the windward boom tube, rig-local. */
  boomPoint(x, side) {
    return new THREE.Vector3(x, this.geo.boomHeight + (x / this.boomLength) * 0.06, -side * this.tubeOffset(x));
  }

  update(sim, dt, harnessTarget) {
    const r = sim.rig;
    const geo = this.geo;
    // Orient the rig from the physics angles (board frame).
    const ax = rigAxes(r.rake, r.lean, r.boom);
    const X = new THREE.Vector3(...ax.c), Y = new THREE.Vector3(...ax.m);
    const Z = new THREE.Vector3().crossVectors(X, Y);
    const m = new THREE.Matrix4().makeBasis(X, Y, Z);
    this.group.quaternion.setFromRotationMatrix(m);
    this.group.position.set(sim.board.mastFootX, deckY(sim.board, sim.board.mastFootX), 0);
    this.group.updateMatrix();

    // Sail shape: camber toward leeward when drawing, flat and fluttering when luffing.
    const alpha = sim.aero ? sim.aero.alphaMid : 0;
    const q = sim.aero ? sim.aero.qMean : 0;
    const aDeg = alpha / DEG;
    const power = smoothstep(2, 10, Math.abs(aDeg)) * (aDeg >= 0 ? 1 : -0.8);
    this.camber = lerp(this.camber, power, Math.min(1, dt * 8));
    const luff = (1 - smoothstep(1, 7, Math.abs(aDeg))) * clamp(q / 15, 0, 1) * (sim.rig.up > 0.6 ? 1 : 0);
    this.flutterPhase += dt * (6 + Math.sqrt(Math.max(q, 0)) * 1.4) * Math.PI * 2;
    const side = r.side;
    const twistTop = (4 + 10 * clamp(q / 90, 0, 1.4)) * DEG;
    const inWater = sim.rig.up < 0.4;
    const pos = this.sailPos;
    for (let v = 0; v <= SAIL_NV; v++) {
      const fv = v / SAIL_NV;
      const h = geo.tack + fv * (geo.head - geo.tack);
      const chord = Math.max(geo.chordAt(Math.min(h, geo.head - 0.01)), 0.02);
      const tw = clamp((h - geo.boomHeight) / (geo.head - geo.boomHeight), 0, 1) * twistTop * (inWater ? 0 : 1);
      const ca = Math.cos(-side * tw), sa = Math.sin(-side * tw);
      const depth = 0.1 * chord * this.camber * (inWater ? 0.2 : 1);
      for (let u = 0; u <= SAIL_NU; u++) {
        const fu = u / SAIL_NU;
        const x = fu * chord;
        let z = side * depth * Math.sin(Math.PI * Math.pow(fu, 0.75));
        z += luff * 0.06 * chord * Math.sin(fu * 9 - this.flutterPhase + fv * 5) * fu * (1 - fu * 0.4);
        const k = (v * (SAIL_NU + 1) + u) * 3;
        pos[k] = x * ca + z * sa;
        pos[k + 1] = h;
        pos[k + 2] = -x * sa + z * ca;
      }
    }
    this.sailGeo.attributes.position.needsUpdate = true;
    this.sailGeo.computeVertexNormals();

    // Battens follow the membrane rows.
    const bp = this.battens.geometry.attributes.position.array;
    let o = 0;
    for (const fr of this.battenRows) {
      const v = Math.round(fr * SAIL_NV);
      for (let u = 0; u < SAIL_NU; u++) {
        const k0 = (v * (SAIL_NU + 1) + u) * 3, k1 = k0 + 3;
        bp[o++] = pos[k0]; bp[o++] = pos[k0 + 1]; bp[o++] = pos[k0 + 2] + 0.003;
        bp[o++] = pos[k1]; bp[o++] = pos[k1 + 1]; bp[o++] = pos[k1 + 2] + 0.003;
      }
    }
    this.battens.geometry.attributes.position.needsUpdate = true;

    // Harness lines: a loop under the windward boom tube, or taut to the hook.
    const a = this.boomPoint(this.boomLength * 0.3, side), b = this.boomPoint(this.boomLength * 0.47, side);
    const hp = this.harness.geometry.attributes.position;
    // harnessTarget is the sailor's hook in the board frame.
    const bottom = harnessTarget ? harnessTarget.clone().applyMatrix4(this.group.matrix.clone().invert()) :
      new THREE.Vector3((a.x + b.x) / 2, geo.boomHeight - 0.42, a.z - side * 0.05);
    for (let i = 0; i < hp.count; i++) {
      const t = i / (hp.count - 1);
      const p = t < 0.5 ? a.clone().lerp(bottom, t * 2) : bottom.clone().lerp(b, (t - 0.5) * 2);
      if (!harnessTarget) p.y -= Math.sin(Math.PI * t) * 0.03;
      hp.setXYZ(i, p.x, p.y, p.z);
    }
    hp.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Sailor

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Two-bone IK: returns the middle joint position. */
function ik(root, end, l1, l2, pole) {
  const d = tmpA.subVectors(end, root);
  const dist = clamp(d.length(), 0.01, l1 + l2 - 1e-4);
  const dir = d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const poleDir = tmpB.copy(pole).sub(tmpC.copy(dir).multiplyScalar(pole.dot(dir))).normalize();
  return root.clone().add(dir.clone().multiplyScalar(a)).add(poleDir.multiplyScalar(h));
}

class Limb {
  constructor(radius, material, parent) {
    this.mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, 1, 4, 10), material);
    this.mesh.castShadow = true;
    this.radius = radius;
    parent.add(this.mesh);
  }
  set(a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = Math.max(d.length(), 1e-3);
    this.mesh.position.copy(a).addScaledVector(d, 0.5);
    this.mesh.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
    this.mesh.scale.set(1, Math.max(len - this.radius * 2, 0.01), 1);
  }
}

const JOINTS = ['pelvis', 'chest', 'neck', 'head', 'shL', 'shR', 'elL', 'elR', 'haL', 'haR', 'kneeF', 'kneeB', 'footF', 'footB'];

export class Sailor {
  constructor(height = 1.8) {
    this.group = new THREE.Group();
    this.h = height;
    const k = height / 1.78;
    const suit = new THREE.MeshStandardMaterial({ color: 0x1d2328, roughness: 0.7 });
    const panel = new THREE.MeshStandardMaterial({ color: 0x168a9a, roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc59474, roughness: 0.75 });
    const harness = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 });
    const g = this.group;
    this.torso = new Limb(0.15 * k, suit, g);
    this.neck = new Limb(0.05, skin, g);
    this.upperL = new Limb(0.048, panel, g); this.upperR = new Limb(0.048, panel, g);
    this.foreL = new Limb(0.04, suit, g); this.foreR = new Limb(0.04, suit, g);
    this.thighF = new Limb(0.075, suit, g); this.thighB = new Limb(0.075, suit, g);
    this.shinF = new Limb(0.055, suit, g); this.shinB = new Limb(0.055, suit, g);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.105 * k, 16, 12), skin);
    this.cap = new THREE.Mesh(new THREE.SphereGeometry(0.11 * k, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 }));
    this.handL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin);
    this.handR = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin);
    this.belt = new THREE.Mesh(new THREE.CylinderGeometry(0.17 * k, 0.165 * k, 0.16, 16), harness);
    this.hook = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 6, 10), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.3 }));
    this.feet = [0, 1].map(() => new THREE.Mesh(new THREE.BoxGeometry(0.27 * k, 0.07, 0.1), suit));
    for (const m of [this.head, this.cap, this.handL, this.handR, this.belt, this.hook, ...this.feet]) { m.castShadow = true; g.add(m); }
    this.pose = null;
    this.fallPose = null;
  }

  /** Target joint positions, board frame. */
  targetPose(sim, rig) {
    const b = sim.board, s = sim.sailor, st = sim.state;
    const side = s.side;
    // Segment lengths from standard anthropometric ratios of body height H:
    // hip joint 0.53H off the floor, thigh/shank 0.25H, hip-to-neck 0.31H,
    // shoulders 0.82H, upper arm 0.19H, forearm-to-grip 0.19H.
    const H = this.h;
    const leg = 0.49 * H, torsoLen = 0.31 * H;
    const p = {};
    const deck = (x) => deckY(b, x);
    const toBoard = (vRig) => vRig.clone().applyMatrix4(rig.group.matrix);

    let feetF, feetB, beta = s.beta, sit = 0;
    if (st === S.SECURE || st === S.UPHAUL || st === S.CLIMB) {
      feetF = new THREE.Vector3(b.mastFootX - 0.16, 0, side * 0.12);
      feetB = new THREE.Vector3(b.mastFootX - 0.5, 0, side * 0.1);
      beta = st === S.UPHAUL ? 12 * DEG * (1 - (sim.stateData.progress ?? 0)) + 4 * DEG : 4 * DEG;
      sit = st === S.UPHAUL ? 0.3 * (1 - (sim.stateData.progress ?? 0)) + 0.06 : 0.06;
    } else if (st === S.TACK) {
      const d = sim.stateData;
      const k = d.switched ? 1 : clamp(sim.stateTime / 0.6, 0, 1);
      feetF = new THREE.Vector3(b.mastFootX + 0.12 * k, 0, side * (0.16 - 0.1 * k));
      feetB = new THREE.Vector3(b.mastFootX - 0.25 + 0.2 * k, 0, side * 0.12);
      beta = 3 * DEG;
      sit = 0.08;
    } else {
      const strapZF = 0.29 * b.width, strapZB = 0.2 * b.width;
      if (s.straps === 2) {
        feetF = new THREE.Vector3(b.frontStrapX, 0, side * strapZF);
        feetB = new THREE.Vector3(b.backStrapX, 0, side * strapZB);
        sit = s.hooked ? 0.18 : 0.1;
      } else if (s.straps === 1) {
        feetF = new THREE.Vector3(b.frontStrapX, 0, side * strapZF);
        feetB = new THREE.Vector3(s.x - 0.32, 0, side * 0.04);
        sit = 0.1;
      } else {
        feetF = new THREE.Vector3(s.x + 0.26, 0, side * 0.03);
        feetB = new THREE.Vector3(s.x - 0.32, 0, side * 0.06);
        sit = s.hooked ? 0.14 : 0.07;
      }
      if (st === S.FLIP) sit = 0.16;
    }
    // Joint positions are ankles; the foot boxes are drawn below them.
    feetF.y = deck(feetF.x) + 0.075;
    feetB.y = deck(feetB.x) + 0.075;

    const leanDir = new THREE.Vector3(-0.22 - s.leanX * 0.8, 0, side).normalize();
    const facing = leanDir.clone().negate(); // toward the sail
    const across = new THREE.Vector3(1, 0, 0); // shoulder line roughly along the board
    const base = feetF.clone().add(feetB).multiplyScalar(0.5);
    const bodyAxis = new THREE.Vector3().addScaledVector(UP, Math.cos(beta)).addScaledVector(leanDir, Math.sin(beta));
    const pelvis = base.clone().addScaledVector(bodyAxis, leg * (1 - sit)).addScaledVector(facing, sit * 0.3);
    const chest = pelvis.clone().addScaledVector(bodyAxis, torsoLen * 0.72).addScaledVector(facing, 0.03);
    const neck = pelvis.clone().addScaledVector(bodyAxis, torsoLen);
    const head = neck.clone().addScaledVector(bodyAxis, 0.09 * H).addScaledVector(facing, 0.02);
    const shL = neck.clone().addScaledVector(across, 0.13 * H).addScaledVector(bodyAxis, -0.028 * H);
    const shR = neck.clone().addScaledVector(across, -0.13 * H).addScaledVector(bodyAxis, -0.028 * H);

    // Hands: front hand forward on the boom, back hand further aft.
    let haF, haB;
    if (st === S.SECURE || st === S.UPHAUL || st === S.CLIMB || (st === S.TACK && !sim.stateData.switched)) {
      haF = toBoard(new THREE.Vector3(0.02, Math.min(rig.geo.boomHeight - 0.1, 0.4 + (sim.rig.up ?? 1) * 0.9), -side * 0.05));
      haB = toBoard(new THREE.Vector3(0.12, Math.min(rig.geo.boomHeight, 0.5 + (sim.rig.up ?? 1) * 0.9), -side * 0.08));
    } else {
      haF = toBoard(rig.boomPoint(0.26 + (s.hooked ? 0.04 : 0), side));
      haB = toBoard(rig.boomPoint(rig.boomLength * (s.hooked ? 0.52 : 0.46), side));
    }
    // Reach limit: if the boom is out of reach (falls, transitions) let go.
    const reach = 0.37 * H;
    const shF = shL, shB = shR;
    const clampReach = (sh, ha) => {
      const d = ha.clone().sub(sh);
      if (d.length() > reach) ha = sh.clone().addScaledVector(d.normalize(), reach);
      return ha;
    };
    haF = clampReach(shF, haF);
    haB = clampReach(shB, haB);

    Object.assign(p, { pelvis, chest, neck, head, shL, shR, haL: haF, haR: haB, footF: feetF, footB: feetB });
    p.elL = ik(shL, haF, 0.19 * H, 0.19 * H, new THREE.Vector3(0, -1, 0).addScaledVector(leanDir, 0.4));
    p.elR = ik(shR, haB, 0.19 * H, 0.19 * H, new THREE.Vector3(0, -1, 0).addScaledVector(leanDir, 0.4));
    p.kneeF = ik(pelvis, feetF, 0.25 * H, 0.25 * H, facing.clone().add(new THREE.Vector3(0.4, 0.1, 0)));
    p.kneeB = ik(pelvis, feetB, 0.25 * H, 0.25 * H, facing.clone().add(new THREE.Vector3(-0.1, 0.1, 0)));

    // In the water: floating beside the board, or hanging on near the tail.
    if (st === S.WATER || st === S.WATERSTART || st === S.FALLING || st === S.CLIMB || st === S.RISING) {
      const w = this.waterPose(sim, rig);
      if (st === S.WATER || st === S.WATERSTART) return w;
      if (st === S.CLIMB) return blendPose(w, p, smoothstep(0.2, 1.4, sim.stateTime));
      if (st === S.RISING) return blendPose(w, p, smoothstep(0, 0.7, sim.stateTime));
      if (st === S.FALLING) {
        if (!this.fallPose) this.fallPose = this.pose ? clonePose(this.pose) : p;
        const k = smoothstep(0, 0.85, sim.stateTime);
        const out = blendPose(this.fallPose, w, k);
        // Arc through the air; a catapult goes over the boom.
        const over = s.fallType === 'catapult' ? 1.4 : s.fallType === 'windward' || s.fallType === 'backwind' ? 0 : 0.6;
        const lift = Math.sin(Math.PI * k) * (0.5 + over * 0.8);
        const shift = new THREE.Vector3(over * 0.8, 0, -side * over * 1.2).multiplyScalar(Math.sin(Math.PI * k * 0.5));
        for (const j of JOINTS) out[j].y += lift, out[j].add(shift);
        return out;
      }
    }
    this.fallPose = null;
    return p;
  }

  waterPose(sim, rig) {
    const b = sim.board, s = sim.sailor, side = s.side, st = sim.state;
    const y = -0.32;
    const p = {};
    if (st === S.WATERSTART) {
      // Back foot on the board near the tail, body low in the water, hands on the boom.
      const footB = new THREE.Vector3(b.backStrapX + 0.1, deckY(b, b.backStrapX) + 0.03, side * 0.12);
      const pelvis = new THREE.Vector3(b.backStrapX - 0.1, y, side * 0.75);
      const neck = pelvis.clone().add(new THREE.Vector3(0.35, 0.38, -side * 0.05));
      const head = neck.clone().add(new THREE.Vector3(0.08, 0.15, 0));
      const toBoard = (v) => v.clone().applyMatrix4(rig.group.matrix);
      const reach = (sh, ha) => { const d = ha.clone().sub(sh); return d.length() > 0.62 ? sh.clone().addScaledVector(d.normalize(), 0.62) : ha; };
      const shL = neck.clone().add(new THREE.Vector3(0.15, 0, 0)), shR = neck.clone().add(new THREE.Vector3(-0.15, 0, 0));
      const haL = reach(shL, toBoard(rig.boomPoint(0.25, side))), haR = reach(shR, toBoard(rig.boomPoint(rig.boomLength * 0.4, side)));
      const footF = pelvis.clone().add(new THREE.Vector3(0.3, -0.55, side * 0.2));
      Object.assign(p, {
        pelvis, chest: pelvis.clone().lerp(neck, 0.7), neck, head, shL, shR, haL, haR, footF, footB,
        elL: ik(shL, haL, 0.31, 0.3, new THREE.Vector3(0, -1, 0)), elR: ik(shR, haR, 0.31, 0.3, new THREE.Vector3(0, -1, 0)),
        kneeF: ik(pelvis, footF, 0.44, 0.42, new THREE.Vector3(1, 0, 0)), kneeB: ik(pelvis, footB, 0.44, 0.42, new THREE.Vector3(0, 1, 0)),
      });
      return p;
    }
    // Floating on the windward side by the mast foot, one arm over the board.
    const pelvis = new THREE.Vector3(b.mastFootX - 0.5, y - 0.15, side * 0.85);
    const neck = new THREE.Vector3(b.mastFootX - 0.05, y + 0.12, side * 0.6);
    const head = neck.clone().add(new THREE.Vector3(0.05, 0.17, 0));
    const shL = neck.clone().add(new THREE.Vector3(0.05, 0, -side * 0.18)), shR = neck.clone().add(new THREE.Vector3(-0.05, 0, side * 0.18));
    const haL = new THREE.Vector3(b.mastFootX + 0.05, deckY(b, b.mastFootX) + 0.03, side * 0.05);
    const haR = shR.clone().add(new THREE.Vector3(0.1, -0.35, side * 0.15));
    const footF = pelvis.clone().add(new THREE.Vector3(-0.5, -0.45, side * 0.2));
    const footB = pelvis.clone().add(new THREE.Vector3(-0.65, -0.5, side * -0.05));
    Object.assign(p, {
      pelvis, chest: pelvis.clone().lerp(neck, 0.7), neck, head, shL, shR, haL, haR, footF, footB,
      elL: ik(shL, haL, 0.31, 0.3, new THREE.Vector3(0, 1, 0)), elR: ik(shR, haR, 0.31, 0.3, new THREE.Vector3(0, -1, 0)),
      kneeF: ik(pelvis, footF, 0.44, 0.42, new THREE.Vector3(0, -1, 0)), kneeB: ik(pelvis, footB, 0.44, 0.42, new THREE.Vector3(0, -1, 0)),
    });
    return p;
  }

  update(sim, rig, dt) {
    const target = this.targetPose(sim, rig);
    if (!this.pose) this.pose = clonePose(target);
    const fast = sim.state === S.FALLING || sim.state === S.SAILING || sim.state === S.FLIP;
    const k = 1 - Math.exp(-dt * (fast ? 22 : 9));
    for (const j of JOINTS) this.pose[j].lerp(target[j], k);
    const p = this.pose;
    this.torso.set(p.pelvis, p.neck);
    this.neck.set(p.neck, p.head);
    this.upperL.set(p.shL, p.elL); this.foreL.set(p.elL, p.haL);
    this.upperR.set(p.shR, p.elR); this.foreR.set(p.elR, p.haR);
    this.thighF.set(p.pelvis, p.kneeF); this.shinF.set(p.kneeF, p.footF);
    this.thighB.set(p.pelvis, p.kneeB); this.shinB.set(p.kneeB, p.footB);
    this.head.position.copy(p.head);
    this.cap.position.copy(p.head).add(new THREE.Vector3(0, 0.01, 0));
    this.cap.quaternion.setFromUnitVectors(UP, p.head.clone().sub(p.neck).normalize());
    this.handL.position.copy(p.haL); this.handR.position.copy(p.haR);
    const beltPos = p.pelvis.clone().lerp(p.neck, 0.22);
    this.belt.position.copy(beltPos);
    this.belt.quaternion.setFromUnitVectors(UP, p.neck.clone().sub(p.pelvis).normalize());
    const facing = new THREE.Vector3(0.2, 0, -sim.sailor.side).normalize();
    this.hook.position.copy(beltPos).addScaledVector(facing, 0.18);
    this.hook.lookAt(this.hook.position.clone().add(facing));
    this.feet[0].position.copy(p.footF).y -= 0.04; this.feet[1].position.copy(p.footB).y -= 0.04;
    this.feet[0].rotation.y = sim.sailor.straps ? 0.9 * sim.sailor.side : 0.2 * sim.sailor.side;
    this.feet[1].rotation.y = sim.sailor.side * 1.3;
  }

  /** Harness hook position in the board frame (for the lines). */
  get hookLocal() {
    return this.hook.position;
  }
}

function clonePose(p) {
  const o = {};
  for (const j of JOINTS) o[j] = p[j].clone();
  return o;
}
function blendPose(a, b, t) {
  const o = {};
  for (const j of JOINTS) o[j] = a[j].clone().lerp(b[j], t);
  return o;
}
