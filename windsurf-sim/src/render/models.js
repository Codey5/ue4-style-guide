// Board, rig and sailor models, posed every frame from the simulation state.
import * as THREE from 'three';
import { DEG, clamp, lerp, smoothstep } from '../physics/math.js';
import { rigAxes } from '../physics/sail.js';
import { S } from '../physics/states.js';
import { boardShape, deckY } from '../physics/shape.js';
import { BODY, bodyContext, boomGrips, boomLocal, boomStations, overreach, poseBody, reachLimit, reachPhi, stance, tubeOffset } from '../physics/body.js';

export { deckY };

// ---------------------------------------------------------------------------
// Board

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
    for (const sideZ of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const x = -0.06 + (i / 16) * (L + 0.08);
        pts.push(new THREE.Vector3(x, geo.boomHeight + (x / L) * 0.06, sideZ * tubeOffset(geo, x)));
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
  }

  /** Point on the windward boom tube, rig-local. */
  boomPoint(x, side) {
    return new THREE.Vector3(...boomLocal(this.geo, x, side));
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

    // The sail, from the aerodynamics it's actually producing. Each band of
    // the sail bulges the way its battens are popped (snapping through, with
    // a little overshoot, when they pop), as deep as it's loaded and the
    // outhaul allows; the leech twists open as far as the physics twisted it;
    // and where a band is luffing it flutters, from a pocket behind the mast
    // to a flapping leech, harder the more wind there is.
    const aero = sim.aero && sim.rig.up > 0.6 ? sim.aero : null;
    const strips = geo.strips;
    const inWater = sim.rig.up < 0.4;
    const nS = strips.length;
    this.camVis ??= r.cam.slice();
    this.popAge ??= new Array(nS).fill(9);
    this.load ??= new Array(nS).fill(0);
    this.luffAmt ??= new Array(nS).fill(0);
    const tw = new Array(nS).fill(0);
    for (let i = 0; i < nS; i++) {
      const before = this.camVis[i];
      this.camVis[i] = r.cam[i];
      if ((before >= 0) !== (r.cam[i] >= 0) || Math.abs(r.cam[i]) < 0.98) this.popAge[i] = 0;
      else this.popAge[i] += dt;
      const st = aero?.strips[i];
      const aDeg = st ? st.alpha / DEG : 0, q = st ? st.q : 0;
      // How full the band is: loaded on its concave side; flat when luffing.
      const loadT = st ? smoothstep(2, 10, aDeg) : 0;
      this.load[i] = lerp(this.load[i], loadT, Math.min(1, dt * 8));
      const luffT = st ? (1 - smoothstep(1.5, 7, Math.abs(aDeg))) * clamp(q / 12, 0, 1.3) : 0;
      this.luffAmt[i] = lerp(this.luffAmt[i], luffT, Math.min(1, dt * 6));
      tw[i] = (st?.tw ?? 0) * (inWater ? 0 : 1);
    }
    const q = aero ? aero.qMean : 0;
    this.flutterPhase += dt * (5 + Math.sqrt(Math.max(q, 0)) * 1.5) * Math.PI * 2;
    this.leechPhase = (this.leechPhase ?? 0) + dt * (22 + Math.sqrt(Math.max(q, 0)) * 3) * Math.PI * 2;
    const leechFlutter = smoothstep(45, 140, q);
    // (a fuller sail with the outhaul eased; flatter pulled tight)
    const fullness = 1 - 0.25 * clamp(sim.tune?.outhaul ?? 0, -1, 1);
    // Interpolate a per-band value to a height on the luff.
    const at = (arr, h) => {
      if (h <= strips[0].h) return arr[0];
      for (let i = 0; i < nS - 1; i++) {
        if (h <= strips[i + 1].h) return lerp(arr[i], arr[i + 1], (h - strips[i].h) / (strips[i + 1].h - strips[i].h));
      }
      return arr[nS - 1];
    };
    // (the band a batten belongs to: battens snap with their own band)
    const bandOf = (h) => { let k = 0; for (let i = 1; i < nS; i++) if (Math.abs(h - strips[i].h) < Math.abs(h - strips[k].h)) k = i; return k; };
    const camRow = new Array(SAIL_NV + 1);
    const pos = this.sailPos;
    for (let v = 0; v <= SAIL_NV; v++) {
      const fv = v / SAIL_NV;
      const h = geo.tack + fv * (geo.head - geo.tack);
      const chord = Math.max(geo.chordAt(Math.min(h, geo.head - 0.01)), 0.02);
      // Battens snap the band to one side; between them the cloth follows.
      const k = bandOf(h);
      const overshoot = Math.exp(-this.popAge[k] * 18) * Math.sin(this.popAge[k] * 60) * 0.35;
      const cam = lerp(at(this.camVis, h), this.camVis[k], 0.6) * (1 + overshoot);
      camRow[v] = cam;
      const sideRow = cam >= 0 ? 1 : -1;
      const twist = at(tw, h);
      const ca = Math.cos(-sideRow * twist), sa = Math.sin(-sideRow * twist);
      const load = at(this.load, h), luff = at(this.luffAmt, h);
      const depth = chord * (0.035 + 0.075 * load) * fullness * (inWater ? 0.25 : 1);
      for (let u = 0; u <= SAIL_NU; u++) {
        const fu = u / SAIL_NU;
        const x = fu * chord;
        let z = cam * depth * Math.sin(Math.PI * Math.pow(fu, 0.75));
        // Luffing: the pocket behind the mast backs and shivers, and a
        // ripple runs back to a flapping leech.
        const pocket = Math.exp(-((fu - 0.22) ** 2) / 0.02);
        z -= sideRow * luff * chord * 0.05 * pocket * (0.6 + 0.4 * Math.sin(this.flutterPhase * 1.7 + fv * 3));
        z += luff * chord * 0.055 * Math.pow(fu, 1.3) * Math.sin(fu * 10 - this.flutterPhase + fv * 6);
        // The twisted-off leech flutters fast in a big breeze.
        if (fu > 0.82 && fv > 0.55) z += leechFlutter * 0.012 * ((fu - 0.82) / 0.18) * Math.sin(this.leechPhase + fv * 9);
        const kk = (v * (SAIL_NU + 1) + u) * 3;
        pos[kk] = x * ca + z * sa;
        pos[kk + 1] = h;
        pos[kk + 2] = -x * sa + z * ca;
      }
    }
    this.sailGeo.attributes.position.needsUpdate = true;
    this.sailGeo.computeVertexNormals();
    const side = r.side;

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
    const lines = boomStations(geo, true);
    const a = this.boomPoint(lines.lineA, side), b = this.boomPoint(lines.lineB, side);
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
    const H = this.h;
    const p = {};
    const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    const toBoard = (vRig) => vRig.clone().applyMatrix4(rig.group.matrix);

    // The same stance, grips and posed body the physics balances (body.js),
    // at the physics lean: what you see is what holds the rig.
    const pose = stance(b, s, st, sim.stateData, sim.stateTime);
    let beta = s.beta;
    if (st === S.SECURE || st === S.UPHAUL || st === S.CLIMB) {
      beta = st === S.UPHAUL ? 12 * DEG * (1 - (sim.stateData.progress ?? 0)) + 4 * DEG : 4 * DEG;
    } else if (st === S.TACK) beta = 3 * DEG;
    const onBoom = !(st === S.SECURE || st === S.UPHAUL || st === S.CLIMB || (st === S.TACK && !sim.stateData.switched));
    const hooked = s.hooked && st === S.SAILING;
    let hands, lines = null;
    if (!onBoom) {
      // On the mast and the uphaul.
      const up = sim.rig.up ?? 1;
      hands = {
        f: toBoard(new THREE.Vector3(0.02, Math.min(rig.geo.boomHeight - 0.1, 0.4 + up * 0.9), -side * 0.05)).toArray(),
        b: toBoard(new THREE.Vector3(0.12, Math.min(rig.geo.boomHeight, 0.5 + up * 0.9), -side * 0.08)).toArray(),
      };
    } else {
      const g = boomGrips(b, sim.rig, sim.sailGeo, hooked, s.gripX);
      hands = { f: g.f, b: g.b };
      lines = { a: g.lineA, b: g.lineB };
    }
    // Leaning back against the pull (fore and aft): the reach is judged the
    // way the physics judges it.
    const phi = onBoom && st === S.SAILING ? s.phi ?? 0 : 0;
    const ctx = bodyContext({ H, stance: pose, side, leanX: s.leanX, hooked, hands, lines, lineLength: sim.harnessLines, onBoom, phi: reachPhi(phi) });
    const reach = ctx.reach;
    // Hanging at full stretch the physics lean can run a degree or two past
    // the reach (your arms holding you), or lag a moment behind a rig moved
    // out of reach; draw those at the edge of the reach.
    this.reachFits = true;
    if (onBoom) {
      const lim = reachLimit(ctx);
      this.reachFits = lim.fits;
      if (lim.fits) beta = clamp(beta, lim.betaMin, lim.betaMax);
    }
    this.leanDrawn = beta;
    // Then lean back as far as the arms (or harness lines) reach toward the
    // physics lean: the hips go back over the tail, arms straight.
    let phiDraw = reachPhi(phi);
    if (onBoom && phi !== phiDraw && this.reachFits) {
      const fits = (f) => overreach(ctx, poseBody(ctx, beta, f)) <= 0;
      if (fits(phi)) phiDraw = phi;
      else if (fits(phiDraw)) {
        let lo = phiDraw, hi = phi;
        for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
        phiDraw = lo;
      }
    }
    this.phiDrawn = phiDraw;
    const body = poseBody(ctx, beta, phiDraw);
    let pelvis = V(body.pelvis), neck = V(body.neck), mid = V(body.mid);
    const half = V(ctx.half), base = V(ctx.base), leanDir = V(ctx.leanDir), facing = V(ctx.facing);
    let haF = V(hands.f), haB = V(hands.b);
    this.offReach = onBoom && overreach(ctx, body) > 0.01;
    if (this.offReach) {
      // The boom is out of reach (rig raked far forward or let right out, or
      // the rig still coming over to you): move the shoulder line the least
      // distance that brings both hands to it (alternating projections onto
      // the two reach spheres) and hang the body from the feet to the new neck.
      const r = reach * 0.97, torsoLen = BODY.torso * H, leg = BODY.leg * H;
      const pull = (o, ha) => {
        const sh = mid.clone().add(o);
        const d = sh.distanceTo(ha);
        if (d > r) mid.addScaledVector(ha.clone().sub(sh), (d - r) / d);
      };
      for (let i = 0; i < 10; i++) { pull(half, haF); pull(half.clone().negate(), haB); }
      const axis0 = neck.clone().sub(pelvis).normalize();
      neck = mid.clone().addScaledVector(axis0, BODY.neckDrop * H);
      const l1 = pelvis.distanceTo(base), l2 = torsoLen;
      const span = neck.distanceTo(base);
      const l1Max = Math.max(l1, leg);
      if (span > l1Max + l2) neck = base.clone().addScaledVector(neck.clone().sub(base).normalize(), (l1Max + l2) * 0.999);
      const legLen = clamp(span - l2 * 0.999, l1, l1Max);
      pelvis = ik(base, neck, legLen, l2, pelvis.clone().sub(base).addScaledVector(leanDir, 0.05));
      mid = neck.clone().addScaledVector(neck.clone().sub(pelvis).normalize(), -BODY.neckDrop * H);
    }
    const torsoAxis = neck.clone().sub(pelvis).normalize();
    const shL = mid.clone().add(half), shR = mid.clone().sub(half); // front and back shoulder
    const chest = pelvis.clone().lerp(neck, 0.72).addScaledVector(facing, 0.03);
    const head = neck.clone().addScaledVector(torsoAxis, 0.09 * H).addScaledVector(facing, 0.02);
    const feetF = V(pose.feetF), feetB = V(pose.feetB);

    // If the boom still can't be reached (legs fully stretched) let go.
    const clampReach = (sh, ha) => {
      const d = ha.clone().sub(sh);
      return d.length() > reach ? sh.clone().addScaledVector(d.normalize(), reach) : ha;
    };
    const gripF = haF.distanceTo(shL) <= reach * 1.001, gripB = haB.distanceTo(shR) <= reach * 1.001;
    this.lastHands = onBoom ? { F: haF.clone(), B: haB.clone() } : null; // grip points, for tools/pose-check
    haF = clampReach(shL, haF);
    haB = clampReach(shR, haB);

    const arm = 0.5 * BODY.reach * H;
    Object.assign(p, { pelvis, chest, neck, head, shL, shR, haL: haF, haR: haB, footF: feetF, footB: feetB });
    p.elL = ik(shL, haF, arm, arm, new THREE.Vector3(0, -1, 0).addScaledVector(leanDir, 0.4));
    p.elR = ik(shR, haB, arm, arm, new THREE.Vector3(0, -1, 0).addScaledVector(leanDir, 0.4));
    p.kneeF = ik(pelvis, feetF, 0.25 * H, 0.25 * H, facing.clone().add(new THREE.Vector3(0.4, 0.1, 0)));
    p.kneeB = ik(pelvis, feetB, 0.25 * H, 0.25 * H, facing.clone().add(new THREE.Vector3(-0.1, 0.1, 0)));
    p.grip = { L: gripF, R: gripB, pole: new THREE.Vector3(0, -1, 0).addScaledVector(leanDir, 0.4) };

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
        if (s.fallType === 'catapult') {
          // Head first over the boom: the harness lines pivot you forward about the hips.
          const pivot = out.pelvis.clone(), axis = new THREE.Vector3(0, 0, 1), turn = -2.3 * smoothstep(0, 0.75, k);
          for (const j of JOINTS) out[j].sub(pivot).applyAxisAngle(axis, turn).add(pivot);
        }
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
      // Hands on the boom once it's within reach (on the mast or the board
      // before that), shoulders just below and to windward of the hands, body
      // trailing in the water, back foot on the board near the tail.
      const H = this.h, reach = BODY.reach * H;
      const toBoard = (v) => v.clone().applyMatrix4(rig.group.matrix);
      const windward = new THREE.Vector3(0, 0, side);
      const outside = b.width / 2 + 0.22;
      const placeShoulders = (hF, hB) => {
        const mid = hF.clone().add(hB).multiplyScalar(0.5);
        const sh = mid.add(new THREE.Vector3(-0.12, -0.3, 0)).addScaledVector(windward, 0.3);
        sh.y = clamp(sh.y, -0.1, 0.9);
        if (sh.z * side < outside) sh.z = side * outside;
        return sh;
      };
      const candidates = [
        [toBoard(rig.boomPoint(0.3, side)), toBoard(rig.boomPoint(rig.boomLength * 0.42, side))],
        [toBoard(new THREE.Vector3(0, 0.35, 0)), toBoard(new THREE.Vector3(0, 0.75, 0))],
      ];
      let haL, haR, shMid;
      for (const [hF, hB] of candidates) {
        const sm = placeShoulders(hF, hB);
        if (sm.distanceTo(hF) <= reach * 1.05 && sm.distanceTo(hB) <= reach * 1.05) { haL = hF; haR = hB; shMid = sm; break; }
      }
      if (!shMid) {
        // Hold the board by the mast foot until the rig comes round.
        haL = new THREE.Vector3(b.mastFootX + 0.05, deckY(b, b.mastFootX) + 0.03, side * 0.12);
        haR = new THREE.Vector3(b.mastFootX - 0.25, deckY(b, b.mastFootX) + 0.03, side * 0.2);
        shMid = new THREE.Vector3(b.mastFootX - 0.15, -0.05, side * outside);
      }
      const shL = shMid.clone().add(new THREE.Vector3(0.13 * H, 0, 0));
      const shR = shMid.clone().add(new THREE.Vector3(-0.13 * H, 0, 0));
      const neck = shMid.clone().add(new THREE.Vector3(0, 0.05, 0));
      const pelvis = shMid.clone().add(new THREE.Vector3(-0.28, -0.42, 0)).addScaledVector(windward, 0.32);
      pelvis.y = Math.min(pelvis.y, -0.35);
      const up = neck.clone().sub(pelvis).normalize();
      const head = neck.clone().addScaledVector(up, 0.07 * H).add(new THREE.Vector3(0, 0.06, 0));
      let footB = new THREE.Vector3(b.backStrapX + 0.12, deckY(b, b.backStrapX) + 0.075, side * 0.16);
      const legLen = 0.49 * H;
      if (footB.distanceTo(pelvis) > legLen) footB = pelvis.clone().addScaledVector(footB.clone().sub(pelvis).normalize(), legLen);
      const footF = pelvis.clone().add(new THREE.Vector3(0.15, -0.65, 0)).addScaledVector(windward, 0.12);
      const clampReach = (sh, ha) => { const d = ha.clone().sub(sh); return d.length() > reach ? sh.clone().addScaledVector(d.normalize(), reach) : ha; };
      haL = clampReach(shL, haL); haR = clampReach(shR, haR);
      Object.assign(p, {
        pelvis, chest: pelvis.clone().lerp(neck, 0.7), neck, head, shL, shR, haL, haR, footF, footB,
        elL: ik(shL, haL, 0.5 * BODY.reach * H, 0.5 * BODY.reach * H, new THREE.Vector3(0, -1, 0)), elR: ik(shR, haR, 0.5 * BODY.reach * H, 0.5 * BODY.reach * H, new THREE.Vector3(0, -1, 0)),
        kneeF: ik(pelvis, footF, 0.25 * H, 0.25 * H, new THREE.Vector3(1, 0, 0)), kneeB: ik(pelvis, footB, 0.25 * H, 0.25 * H, new THREE.Vector3(0, 1, 0)),
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
    if (target.grip) {
      // Gripping hands go exactly on the boom; the elbow straightens if the
      // smoothed shoulder lags a little behind.
      const H = this.h;
      const snap = (sh, el, ha, tHa, on) => {
        if (!on) return;
        p[ha].copy(target[tHa]);
        p[el].copy(ik(p[sh], p[ha], 0.5 * BODY.reach * H, 0.5 * BODY.reach * H, target.grip.pole));
      };
      snap('shL', 'elL', 'haL', 'haL', target.grip.L);
      snap('shR', 'elR', 'haR', 'haR', target.grip.R);
    }
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
