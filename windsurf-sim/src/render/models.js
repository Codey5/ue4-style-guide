// Board, rig and sailor models, posed every frame from the simulation state.
import * as THREE from 'three';
import { Figure } from './figure.js';
import { DEG, clamp, lerp, smoothstep } from '../physics/math.js';
import { rigAxes } from '../physics/sail.js';
import { S } from '../physics/states.js';
import { boardShape, deckY } from '../physics/shape.js';
import { BODY, bodyContext, boomGrips, boomLocal, boomStations, overreach, poseBody, reachLimit, reachPhi, segSegDist, stance, tubeOffset } from '../physics/body.js';

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
      // (the curve the hands hold, closing in to the clew at the end of the boom)
      const closing = (x) => 0.2 * Math.pow(Math.sin(Math.PI * clamp(x / L, 0, 1)), 0.7) + 0.02;
      for (let i = 0; i <= 16; i++) {
        const x = -0.06 + (i / 16) * (L + 0.08);
        const p = boomLocal(geo, x, -sideZ);
        pts.push(new THREE.Vector3(x, p[1], sideZ * Math.min(tubeOffset(geo, x), closing(x))));
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
    // The uphaul rope: tied to the front of the boom, its tail to the mast
    // foot on a bungee. It hangs by the mast, or runs taut to your hands.
    this.uphaul = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new Array(16).fill(0).map(() => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0xd9d9d9 }));
    this.uphaul.frustumCulled = false;
    this.group.add(this.uphaul);
    this.updateUphaul(null, null);
    this.flutterPhase = 0;
  }

  /** The uphaul rope: hanging from the boom front, or (uphauling) taut from it to the hands. */
  updateUphaul(sim, sailor) {
    const geo = this.geo, pos = this.uphaul.geometry.attributes.position, n = pos.count;
    const top = new THREE.Vector3(0.06, geo.boomHeight, 0), foot = new THREE.Vector3(0.05, 0.12, 0);
    const pts = [];
    if (sim && sailor?.pose && sim.state === S.UPHAUL) {
      // Taut from the boom to the hands, then the tail falls to the mast foot.
      this.group.updateMatrix();
      const inv = this.group.matrix.clone().invert();
      const hf = sailor.pose.haL.clone().applyMatrix4(inv), hb = sailor.pose.haR.clone().applyMatrix4(inv);
      const [h1, h2] = hf.distanceTo(top) < hb.distanceTo(top) ? [hf, hb] : [hb, hf];
      for (let i = 0; i < 6; i++) pts.push(top.clone().lerp(h1, i / 5));
      for (let i = 1; i < 4; i++) pts.push(h1.clone().lerp(h2, i / 3));
      for (let i = 1; i < n - 8; i++) {
        const t = i / (n - 9);
        pts.push(h2.clone().lerp(foot, t).add(new THREE.Vector3(0, -Math.sin(Math.PI * t) * 0.15, 0)));
      }
    } else {
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        pts.push(new THREE.Vector3(0.05 + Math.sin(Math.PI * t) * 0.18, geo.boomHeight * (1 - t) + 0.25 * t, 0));
      }
    }
    for (let i = 0; i < n; i++) pos.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
    pos.needsUpdate = true;
  }

  /** The membrane's normals and the battens, after the sail's vertices move. */
  syncSail() {
    const pos = this.sailPos;
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
  }

  /**
   * Cloth gives: where the sailor's body is in the way (the pose just drawn),
   * the sail is pushed out round it, to whichever side is nearer, and the
   * cloth around eases over the bulge, instead of the body showing through.
   */
  drapeAround(sim, sailor) {
    if (!sailor?.pose || sim.state === S.FALLING) return;
    if (this.drape(sailor.pose)) this.syncSail();
  }

  /** Push the sail's vertices out of the body (capsules, board frame), with a soft edge. */
  drape(pose) {
    const inv = this.group.matrix.clone().invert();
    // (the cloth goes round the far side of you: you're on one side of the
    // sail, even when it's bulging back toward you before the battens pop)
    const chestZ = pose.chest.clone().applyMatrix4(inv).z;
    const away = Math.abs(chestZ) > 0.05 ? -Math.sign(chestZ) : 0;
    const caps = bodyCapsules(pose).filter((c) => c.name !== 'forearm').map((c) => ({
      a: c.a.clone().applyMatrix4(inv), b: c.b.clone().applyMatrix4(inv), r: c.r + 0.03,
    }));
    const pos = this.sailPos, NU = SAIL_NU + 1, n = pos.length / 3;
    const disp = this.dispBuf ??= new Float32Array(n);
    disp.fill(0);
    const p = new THREE.Vector3(), ab = new THREE.Vector3(), w = new THREE.Vector3();
    const inside = (x, y, z, c) => {
      p.set(x, y, z);
      ab.subVectors(c.b, c.a);
      const t = clamp(w.subVectors(p, c.a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
      return c.r - p.distanceTo(w.copy(c.a).addScaledVector(ab, t));
    };
    let any = false;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      for (const c of caps) {
        if (inside(x, y, z, c) <= 0) continue;
        // The least move across the sail (rig-local z) that clears it, either way.
        const out = (dir) => {
          let lo = 0, hi = 2 * c.r;
          for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (inside(x, y, z + dir * m, c) > 0) lo = m; else hi = m; }
          return dir * hi;
        };
        const up = out(1), down = out(-1);
        const d = away ? (away > 0 ? up : down) : Math.abs(up) < Math.abs(down) ? up : down;
        if (Math.abs(d) > Math.abs(disp[i])) disp[i] = d;
        any = true;
      }
    }
    if (!any) return false;
    // Ease the cloth around over the bulge (twice), never undoing a push.
    const tmp = this.dispTmp ??= new Float32Array(n);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const u = i % NU, v = (i - u) / NU;
        let sum = disp[i] * 2, wsum = 2;
        for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const uu = u + du, vv = v + dv;
          if (uu < 0 || uu >= NU || vv < 0 || vv > SAIL_NV) continue;
          sum += disp[vv * NU + uu]; wsum++;
        }
        const avg = sum / wsum;
        tmp[i] = Math.abs(disp[i]) >= Math.abs(avg) && Math.sign(disp[i]) === Math.sign(avg) ? disp[i] : (disp[i] === 0 ? avg * 0.8 : disp[i]);
      }
      disp.set(tmp);
    }
    // (not the luff: the sleeve stays on the mast)
    for (let i = 0; i < n; i++) if (i % NU > 0) pos[i * 3 + 2] += disp[i];
    // Where a limb goes right through the sail (no way round it across the
    // cloth), the cloth lies over it: pushed straight out of it.
    for (let i = 0; i < n; i++) {
      if (i % NU === 0) continue;
      for (const c of caps) {
        p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        ab.subVectors(c.b, c.a);
        const t = clamp(w.subVectors(p, c.a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
        const axis = w.copy(c.a).addScaledVector(ab, t);
        const d = p.distanceTo(axis);
        if (d >= c.r - 0.005 || d < 1e-6) continue;
        p.sub(axis).multiplyScalar((c.r - 0.005) / d).add(axis);
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      }
    }
    return true;
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
    this.syncSail();
    const side = r.side;

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

// (front: a point the chest faces, so the body knows which way it's turned)
const JOINTS = ['pelvis', 'chest', 'neck', 'head', 'shL', 'shR', 'elL', 'elR', 'haL', 'haR', 'kneeF', 'kneeB', 'footF', 'footB', 'front'];

export class Sailor {
  constructor(height = 1.8) {
    this.group = new THREE.Group();
    this.h = height;
    this.figure = new Figure(height);
    this.group.add(this.figure.root);
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
    // What the hands hold through a move: the boom; the mast (stepping round
    // it in a tack, pushing the sail round it in a helitack); the mast and the
    // front of the boom (holding the sail in while the nose comes up through
    // the wind); or just the front of the boom, the other hand free (the sail
    // let go in a carving 360).
    const d = sim.stateData;
    const sinceSwitch = st === S.TACK && d.switched ? sim.stateTime - (d.switchTime ?? 0) : 0;
    let hold = 'boom';
    if (st === S.SECURE || st === S.CLIMB) hold = 'mastUphaul';
    else if (st === S.UPHAUL) hold = 'uphaul';
    else if (st === S.TACK) hold = !d.switched ? 'mastBoom' : sinceSwitch < 0.3 ? 'mast' : 'boom';
    else if (st === S.TRICK && d.kind === 'heli' && d.phase === 'spin') hold = 'mast';
    else if (st === S.TRICK && d.kind === 'c360' && d.turned > 75 * DEG && d.turned < 300 * DEG) hold = 'mastFree';
    this.hold = hold;
    const onBoom = hold === 'boom';
    // (holding the mast you hang out to windward off it, at arm's length; in
    // a spock, off the boom, outside the wishbone as it turns with you)
    if (hold === 'mast' || hold === 'mastBoom' || hold === 'mastFree') beta = Math.max(beta, 8 * DEG);
    if (st === S.TRICK && d.kind === 'spock') beta = Math.max(beta, 14 * DEG);
    const hooked = s.hooked && st === S.SAILING;
    // (on the mast: just below the boom, on the windward side of it)
    const mastAt = (y) => toBoard(new THREE.Vector3(0, y, -sim.rig.side * 0.035));
    let hands, lines = null;
    if (hold === 'mastBoom') {
      hands = { f: mastAt(rig.geo.boomHeight - 0.2).toArray(), b: toBoard(rig.boomPoint(0.25, sim.rig.side)).toArray() };
    } else if (hold === 'mast') {
      hands = { f: mastAt(rig.geo.boomHeight - 0.1).toArray(), b: mastAt(rig.geo.boomHeight - 0.42).toArray() };
    } else if (hold === 'mastFree') {
      hands = { f: toBoard(rig.boomPoint(0.22, sim.rig.side)).toArray(), b: mastAt(rig.geo.boomHeight - 0.42).toArray() };
    } else if (st === S.UPHAUL) {
      // On the uphaul rope, an arm's length out toward the boom (hand over
      // hand up it as the rig comes up), or on the rope by the boom once it's close.
      const top = toBoard(new THREE.Vector3(0.06, rig.geo.boomHeight, 0));
      const sit = pose.sit ?? 0;
      const sh = new THREE.Vector3(0.5 * (pose.feetF[0] + pose.feetB[0]) + 0.05, pose.feetF[1] + H * (0.8 - 0.35 * sit), side * 0.12);
      const d = top.clone().sub(sh), dist = d.length();
      const reachOut = Math.min(dist, BODY.reach * H * 0.92);
      d.normalize();
      hands = { f: sh.clone().addScaledVector(d, reachOut).toArray(), b: sh.clone().addScaledVector(d, Math.max(0.05, reachOut - 0.13)).toArray() };
    } else if (!onBoom) {
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
    let ctx = bodyContext({ H, stance: pose, side, leanX: s.leanX, hooked, hands, lines, lineLength: sim.harnessLines, onBoom, phi: reachPhi(phi) });
    const reach = ctx.reach;
    // Hanging at full stretch the physics lean can run a degree or two past
    // the reach (your arms holding you), or lag a moment behind a rig moved
    // out of reach; draw those at the edge of the reach.
    this.reachFits = true;
    if (onBoom) {
      let lim = reachLimit(ctx);
      // The rig's come down onto you (raked right back and pulled over you):
      // bend your knees and duck under the boom.
      for (const extra of [0.08, 0.16, 0.24, 0.32]) {
        if (lim.fits) break;
        const lower = { ...ctx, sit: ctx.sit + extra }, l2 = reachLimit(lower);
        if (l2.fits) { ctx = lower; lim = l2; }
      }
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
    // (the back arches a little hanging in the harness, its hook pulling your
    // hips toward the boom, and rounds as you crouch)
    const chest = pelvis.clone().lerp(neck, 0.72).addScaledVector(facing, 0.03 + (hooked ? 0.02 : 0) - 0.12 * (pose.sit ?? 0));
    const head = neck.clone().addScaledVector(torsoAxis, 0.09 * H).addScaledVector(facing, 0.02);
    const feetF = V(pose.feetF), feetB = V(pose.feetB);

    // If the boom still can't be reached (legs fully stretched) let go.
    const clampReach = (sh, ha) => {
      const d = ha.clone().sub(sh);
      return d.length() > reach ? sh.clone().addScaledVector(d.normalize(), reach) : ha;
    };
    // Back hand let go of the boom (too much pull): it drops to your side;
    // let go in a carving 360, it's out behind you for balance.
    const backOff = (onBoom && st === S.SAILING && s.backOff > 0) || hold === 'mastFree';
    if (hold === 'mastFree') haB = shR.clone().add(new THREE.Vector3(-0.35 * reach, -0.6 * reach, 0)).addScaledVector(leanDir, 0.45 * reach);
    else if (backOff) haB = shR.clone().add(new THREE.Vector3(0, -0.85 * reach, 0)).addScaledVector(facing, 0.12);
    this.backOff = backOff || (onBoom && s.regrab < 1);
    const gripF = haF.distanceTo(shL) <= reach * 1.001, gripB = !backOff && haB.distanceTo(shR) <= reach * 1.001;
    this.lastHands = onBoom ? { F: haF.clone(), B: haB.clone() } : null; // grip points, for tools/pose-check
    haF = clampReach(shL, haF);
    haB = clampReach(shR, haB);

    const arm = 0.5 * BODY.reach * H;
    Object.assign(p, { pelvis, chest, neck, head, shL, shR, haL: haF, haR: haB, footF: feetF, footB: feetB, front: chest.clone().addScaledVector(facing, 0.3) });
    p.elL = ik(shL, haF, arm, arm, new THREE.Vector3(0, -1, 0).addScaledVector(leanDir, 0.4));
    p.elR = ik(shR, haB, arm, arm, new THREE.Vector3(0, -1, 0).addScaledVector(leanDir, 0.4));
    // Knees bent forward and in toward the rig, but never into the mast or
    // the foot of the sail: beside the mast the knee goes out the other way
    // round it, under the sail it bends out to windward.
    const mastA = toBoard(new THREE.Vector3(0, 0, 0)), mastB = toBoard(new THREE.Vector3(0, 1.3, 0));
    const low = [];
    for (let k = 0; k < rig.sailPos.length; k += 3) {
      if (rig.sailPos[k + 1] < 1.1 && rig.sailPos[k] > 0.02) low.push(toBoard(new THREE.Vector3(rig.sailPos[k], rig.sailPos[k + 1], rig.sailPos[k + 2])));
    }
    const segPt = (a, b, q) => {
      const ab = b.clone().sub(a);
      return q.distanceTo(a.clone().addScaledVector(ab, clamp(q.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1)));
    };
    const legGap = (knee, foot) => {
      let gap = Math.min(segSegDist(pelvis.toArray(), knee.toArray(), mastA.toArray(), mastB.toArray()) - 0.085,
        segSegDist(knee.toArray(), foot.toArray(), mastA.toArray(), mastB.toArray()) - 0.055) - 0.035;
      for (const q of low) gap = Math.min(gap, segPt(pelvis, knee, q) - 0.105, segPt(knee, foot, q) - 0.075);
      return gap;
    };
    const leg = (foot, pole0) => {
      const mid = pelvis.clone().add(foot).multiplyScalar(0.5);
      const ab = mastB.clone().sub(mastA);
      const onMast = mastA.clone().addScaledVector(ab, clamp(mid.clone().sub(mastA).dot(ab) / ab.lengthSq(), 0, 1));
      const away = mid.clone().sub(onMast).setY(0);
      if (away.lengthSq() < 1e-6) away.copy(leanDir);
      away.normalize();
      let best = null, bestGap = -Infinity;
      for (const dir of [away, leanDir]) {
        for (const w of [0, 0.6, 1.5, 3, 6]) {
          const knee = ik(pelvis, foot, 0.25 * H, 0.25 * H, pole0.clone().addScaledVector(dir, w));
          const gap = legGap(knee, foot);
          if (gap > 0.01) return knee;
          if (gap > bestGap) { bestGap = gap; best = knee; }
        }
      }
      return best;
    };
    p.kneeF = leg(feetF, facing.clone().add(new THREE.Vector3(0.4, 0.1, 0)));
    p.kneeB = leg(feetB, facing.clone().add(new THREE.Vector3(-0.1, 0.1, 0)));
    // (free: a hand that's let go, which moves with the body)
    p.grip = { L: gripF, R: gripB, freeR: backOff, pole: new THREE.Vector3(0, -1, 0).addScaledVector(leanDir, 0.4) };

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
      const chest = pelvis.clone().lerp(neck, 0.7);
      Object.assign(p, {
        pelvis, chest, neck, head, shL, shR, haL, haR, footF, footB,
        // (facing the rig, hands up on it)
        front: chest.clone().add(haL.clone().add(haR).multiplyScalar(0.5).sub(chest).normalize().multiplyScalar(0.3)),
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
    const chest = pelvis.clone().lerp(neck, 0.7);
    Object.assign(p, {
      pelvis, chest, neck, head, shL, shR, haL, haR, footF, footB,
      front: chest.clone().add(new THREE.Vector3(0.05, 0.12, -side * 0.3)), // (facing the board, head up)
      elL: ik(shL, haL, 0.31, 0.3, new THREE.Vector3(0, 1, 0)), elR: ik(shR, haR, 0.31, 0.3, new THREE.Vector3(0, -1, 0)),
      kneeF: ik(pelvis, footF, 0.44, 0.42, new THREE.Vector3(0, -1, 0)), kneeB: ik(pelvis, footB, 0.44, 0.42, new THREE.Vector3(0, -1, 0)),
    });
    return p;
  }

  update(sim, rig, dt) {
    const target = this.targetPose(sim, rig);
    if (!this.base) this.base = clonePose(target);
    // Tacking, the back foot comes round the front of the mast to be the new
    // front one: at the switch each foot carries on along its own path.
    const tackSwitched = sim.state === S.TACK && !!sim.stateData.switched;
    if (tackSwitched && !this.tackSwitched) {
      const q = this.base;
      [q.footF, q.footB] = [q.footB, q.footF];
      [q.kneeF, q.kneeB] = [q.kneeB, q.kneeF];
    }
    this.tackSwitched = tackSwitched;
    const fast = sim.state === S.FALLING || sim.state === S.SAILING || sim.state === S.FLIP;
    const k = 1 - Math.exp(-dt * (fast ? 22 : 9));
    // (stepping round the mast the feet keep close to their path)
    const kFeet = sim.state === S.TACK ? 1 - Math.exp(-dt * 24) : k;
    for (const j of JOINTS) this.base[j].lerp(target[j], j.startsWith('foot') || j.startsWith('knee') ? kFeet : k);
    // (a hand on the boom is on it, smoothing or not)
    if (target.grip?.L) this.base.haL.copy(target.haL);
    if (target.grip?.R) this.base.haR.copy(target.haR);
    // Drawn: that pose, with the body's give on top.
    const p = this.pose = clonePose(this.base);
    const H = this.h, arm = 0.5 * BODY.reach * H;
    const grip = target.grip ?? { L: false, R: false, pole: new THREE.Vector3(0, -1, 0) };
    this.give(sim, p, dt, grip);
    // Gripping hands go exactly on the boom, the arms reaching from where the
    // shoulders are; if the body's give has taken a shoulder out of reach,
    // the upper body is held back by that arm.
    const snap = () => {
      if (grip.L) { p.haL.copy(target.haL); p.elL.copy(ik(p.shL, p.haL, arm, arm, grip.pole)); }
      if (grip.R) { p.haR.copy(target.haR); p.elR.copy(ik(p.shR, p.haR, arm, arm, grip.pole)); }
    };
    snap();
    const reach = BODY.reach * H;
    let held = false;
    for (const [sh, ha, on] of [['shL', 'haL', grip.L], ['shR', 'haR', grip.R]]) {
      const d = p[ha].distanceTo(p[sh]);
      if (!on || d <= reach) continue;
      const back = p[ha].clone().sub(p[sh]).multiplyScalar((d - reach) / d);
      for (const j of ['neck', 'head', 'shL', 'shR', 'front']) p[j].add(back);
      p.chest.addScaledVector(back, 0.6);
      held = true;
    }
    if (held) snap();
    this.levelHead(sim, p);
    this.clearOfRig(sim, rig, dt);
    // The stance's feet: the front foot along the board (more so in the strap), the back one across it.
    const side = sim.sailor.side;
    const toe = (a) => new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const onBoard = !(sim.state === S.WATER || sim.state === S.WATERSTART || sim.state === S.FALLING);
    // Hips turned toward the bow from the shoulders (square to the boom):
    // more so in the straps, hooked in; little in a move or off the board.
    const s = sim.sailor, st = sim.state;
    const twist = !onBoard ? 0 : st === S.SAILING ? 0.3 + (s.straps === 2 ? 0.25 : 0) + (s.hooked ? 0.1 : 0) : 0.12;
    const hipFacing = p.front.clone().sub(p.chest).setY(0).normalize().add(new THREE.Vector3(twist, 0, 0));
    this.figure.update(p, { onBoard, toes: [toe(s.straps ? 0.9 * side : 0.2 * side), toe(1.3 * side)], lookAt: this.lookAt, hipFacing });
  }

  /**
   * The body's give. Legs and back are springs, not rods: what the deck under
   * your feet does (chop slamming into it, a landing, the nose digging in and
   * the board slowing, a hard carve) your weight lags behind and the legs and
   * back soak up, then spring back. Two springs, each with its weight: the
   * hips on the legs, and the upper body on the hips (carried along by them),
   * set off by the deck's acceleration under your feet. Your hands, on the
   * boom, stay put; in the air, you and the board fall together and the
   * springs settle.
   */
  give(sim, p, dt, grip) {
    const g = this.spring ??= {
      v0: null, acc: new THREE.Vector3(),
      hips: new THREE.Vector3(), hipsV: new THREE.Vector3(), upper: new THREE.Vector3(), upperV: new THREE.Vector3(),
    };
    const st = sim.state;
    const onBoard = st === S.SAILING || st === S.TACK || st === S.FLIP || st === S.TRICK || st === S.SECURE || st === S.UPHAUL || st === S.RISING;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(sim.roll, sim.yaw, sim.pitch, 'YZX'));
    const qInv = q.clone().invert();
    this.q = q; this.qInv = qInv;
    // The deck under your feet: its velocity (world), from the board's
    // motion and turn rates, and so its acceleration (board frame, smoothed a touch).
    const r = p.footF.clone().add(p.footB).multiplyScalar(0.5);
    const w = new THREE.Vector3(sim.rollRate ?? 0, 0, sim.pitchRate ?? 0).add(new THREE.Vector3(0, sim.yawRate ?? 0, 0).applyQuaternion(qInv));
    const v = new THREE.Vector3(sim.vel[0], sim.heaveVel ?? 0, sim.vel[2]).add(w.cross(r).applyQuaternion(q));
    let drive = new THREE.Vector3();
    if (g.v0 && dt > 1e-4 && dt < 0.1) {
      const a = v.clone().sub(g.v0).divideScalar(dt).applyQuaternion(qInv);
      g.acc.lerp(a, 1 - Math.exp(-dt / 0.03));
      // (your weight is pressed down into the deck by what slows its fall,
      // and lags behind it fore and aft and sideways; in the air you fall together)
      if (onBoard && !sim.airborne) drive = g.acc.clone().negate().clampLength(0, 60);
    }
    g.v0 = v;
    if (!onBoard) {
      // (off the board the body is posed afresh: let the springs settle quickly)
      const f = Math.exp(-dt * 10);
      g.hips.multiplyScalar(f); g.upper.multiplyScalar(f); g.hipsV.set(0, 0, 0); g.upperV.set(0, 0, 0);
    } else {
      // Hips: on the legs (about 2 Hz, half damped), giving most up and down.
      // Upper body: on the hips (about 3 Hz), swaying fore and aft and
      // sideways, carried by the hips' spring.
      const kH = (2 * Math.PI * 2) ** 2, cH = 2 * 0.5 * Math.sqrt(kH);
      const kU = (2 * Math.PI * 2.8) ** 2, cU = 2 * 0.4 * Math.sqrt(kU);
      const gainH = new THREE.Vector3(0.6, 1, 0.45), gainU = new THREE.Vector3(1, 0.2, 0.8);
      const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
      for (let i = 0; i < n; i++) {
        const aH = drive.clone().multiply(gainH).addScaledVector(g.hips, -kH).addScaledVector(g.hipsV, -cH);
        // (the hips' spring force is what carries the upper body along: it lags behind it)
        const carried = g.hips.clone().multiplyScalar(kH).addScaledVector(g.hipsV, cH).multiply(gainU);
        const aU = carried.addScaledVector(g.upper, -kU).addScaledVector(g.upperV, -cU);
        g.hipsV.addScaledVector(aH, h); g.hips.addScaledVector(g.hipsV, h);
        g.upperV.addScaledVector(aU, h); g.upper.addScaledVector(g.upperV, h);
      }
      // (as far as knees, ankles and back go)
      const limit = (o, ov, lo, hi) => {
        for (const ax of ['x', 'y', 'z']) {
          if (o[ax] < lo[ax]) { o[ax] = lo[ax]; ov[ax] = Math.max(0, ov[ax]); }
          if (o[ax] > hi[ax]) { o[ax] = hi[ax]; ov[ax] = Math.min(0, ov[ax]); }
        }
      };
      limit(g.hips, g.hipsV, new THREE.Vector3(-0.1, -0.16, -0.08), new THREE.Vector3(0.1, 0.05, 0.08));
      limit(g.upper, g.upperV, new THREE.Vector3(-0.1, -0.03, -0.08), new THREE.Vector3(0.1, 0.03, 0.08));
    }
    // Onto the pose: the hips, then the upper body bending over them (the
    // chest less than the shoulders and head: the back bends); the knees
    // bend to the hips; free hands go with you, gripping ones stay on the boom.
    const kneeBend = (kn, foot) => p[kn].clone().sub(p.pelvis.clone().add(p[foot]).multiplyScalar(0.5));
    const bendF = kneeBend('kneeF', 'footF'), bendB = kneeBend('kneeB', 'footB');
    const top = g.hips.clone().add(g.upper);
    p.pelvis.add(g.hips);
    p.chest.add(g.hips).addScaledVector(g.upper, 0.55);
    for (const j of ['neck', 'head', 'shL', 'shR', 'elL', 'elR', 'front']) p[j].add(top);
    if (grip.freeR) p.haR.add(top);
    const leg = 0.25 * this.h;
    p.kneeF.copy(ik(p.pelvis, p.footF, leg, leg, bendF));
    p.kneeB.copy(ik(p.pelvis, p.footB, leg, leg, bendB));
  }

  /**
   * Eyes on the horizon: the head stays nearer upright than the body it's on
   * (leaning out, or the board pitching and rolling under you), and looks
   * ahead past the mast, level.
   */
  levelHead(sim, p) {
    const st = sim.state;
    this.lookAt = null;
    if (st === S.WATER || st === S.WATERSTART || st === S.FALLING || !this.q) return;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.qInv);
    const d = p.head.clone().sub(p.neck), len = d.length();
    p.head.copy(p.neck).addScaledVector(d.divideScalar(len).lerp(up, 0.4).normalize(), len);
    const ahead = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q).setY(0).normalize().applyQuaternion(this.qInv);
    this.lookAt = p.head.clone().addScaledVector(ahead, Math.max(2, sim.board.length * 0.5 + 3 - p.head.x));
  }

  /**
   * Last of all, on the pose as drawn (smoothing and all): nothing of the rig
   * goes through the body. The torso is moved out to windward of the boom
   * tube you hold, and off the mast, and the arms and legs follow it. It
   * gives way at once, and comes back in over a few tenths of a second (it
   * remembers how far it was pushed), so the body never jumps.
   */
  clearOfRig(sim, rig, dt) {
    const st = sim.state;
    const pushed = this.pushed ??= { upper: new THREE.Vector3(), pelvis: new THREE.Vector3() };
    if (!(st === S.SAILING || st === S.TACK || st === S.FLIP || st === S.TRICK || st === S.SECURE)) {
      pushed.upper.set(0, 0, 0); pushed.pelvis.set(0, 0, 0);
      return;
    }
    const p = this.pose, H = this.h, m = rig.group.matrix;
    const upperJoints = ['chest', 'neck', 'head', 'shL', 'shR', 'elL', 'elR', 'front'];
    const back = Math.exp(-dt * 5);
    pushed.upper.multiplyScalar(back); pushed.pelvis.multiplyScalar(back);
    for (const j of upperJoints) p[j].add(pushed.upper);
    p.pelvis.add(pushed.pelvis);
    const windward = new THREE.Vector3(0, 0, sim.sailor.side);
    // (both tubes: you're outside the wishbone, beyond the one you hold)
    const tube = [];
    for (const sd of [1, -1]) for (let x = 0.05; x < rig.boomLength * 0.8; x += 0.07) tube.push(rig.boomPoint(x, sd * sim.rig.side).applyMatrix4(m));
    const mastA = new THREE.Vector3(0, 0, 0).applyMatrix4(m), mastB = new THREE.Vector3(0, rig.geo.boomHeight + 0.9, 0).applyMatrix4(m);
    const near = (a, b, q) => {
      const ab = b.clone().sub(a);
      const t = clamp(q.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
      return [a.clone().addScaledVector(ab, t), t];
    };
    // (off the tube you hold, out the way you hold it from: square to the
    // sail, on its windward side, level)
    const out = new THREE.Vector3(0, 0, -sim.rig.side).transformDirection(m).setY(0);
    const outward = out.lengthSq() > 1e-4 ? out.normalize() : windward;
    let moved = 0;
    for (let it = 0; it < 16 && moved < 0.8; it++) {
      // (the back as it's bent: hips to chest, chest to the head, where it's been turned)
      const top = p.head;
      let worst = 0, dir = null, tAt = 1;
      tube.forEach((q) => {
        for (const [a, b, t0] of [[p.pelvis, p.chest, 0], [p.chest, top, 0.5]]) {
          const [c, t] = near(a, b, q);
          const depth = 0.135 + 0.017 + 0.012 - q.distanceTo(c);
          if (depth > worst) { worst = depth; dir = outward; tAt = t0 + 0.5 * t; }
        }
      });
      // (the mast: the nearest point of it to the torso, pushed straight off it)
      for (let k = 0; k <= 12; k++) {
        const q = mastA.clone().lerp(mastB, k / 12);
        for (const [a, b, t0] of [[p.pelvis, p.chest, 0], [p.chest, top, 0.5]]) {
          const [c, t] = near(a, b, q);
          const depth = 0.135 + 0.025 + 0.012 - q.distanceTo(c);
          if (depth > worst) {
            worst = depth; tAt = t0 + 0.5 * t;
            dir = c.clone().sub(q).setY(0);
            dir = dir.lengthSq() > 1e-6 ? dir.normalize() : windward;
          }
        }
      }
      if (worst <= 0) break;
      const shift = dir.clone().multiplyScalar(Math.min(worst + 0.005, 0.8 - moved));
      for (const j of upperJoints) p[j].add(shift);
      p.pelvis.addScaledVector(shift, 1 - tAt);
      pushed.upper.add(shift); pushed.pelvis.addScaledVector(shift, 1 - tAt);
      moved += shift.length();
    }

    // The arms reach from where the shoulders are now, the elbows bending
    // round the boom rather than through it; the knees keep their bend.
    const arm = 0.5 * BODY.reach * H, down = new THREE.Vector3(0, -1, 0);
    const pole0 = down.clone().addScaledVector(windward, 0.4);
    const poles = [pole0, pole0.clone().addScaledVector(outward, 1), pole0.clone().addScaledVector(outward, 2.5), down, down.clone().addScaledVector(outward, -1)];
    for (const [sh, el, ha] of [['shL', 'elL', 'haL'], ['shR', 'elR', 'haR']]) {
      let best = null, bestGap = -Infinity;
      for (const pole of poles) {
        const e = ik(p[sh], p[ha], arm, arm, pole);
        let gap = Infinity;
        for (const q of tube) gap = Math.min(gap, near(p[sh], e, q)[0].distanceTo(q) - 0.082);
        if (gap > bestGap) { bestGap = gap; best = e; }
        if (gap > 0) break;
      }
      p[el].copy(best);
    }
    if (pushed.pelvis.lengthSq() > 1e-8) {
      for (const [k, f] of [['kneeF', 'footF'], ['kneeB', 'footB']]) {
        const bend = p[k].clone().sub(p.pelvis.clone().add(p[f]).multiplyScalar(0.5));
        p[k].copy(ik(p.pelvis, p[f], 0.25 * H, 0.25 * H, bend.lengthSq() > 1e-8 ? bend : windward));
      }
    }
  }

  /** Harness hook position in the board frame (for the lines). */
  get hookLocal() {
    return this.figure.hookPos;
  }
}

/**
 * The body as capsules (board frame) from the posed joints, roughly the
 * figure's own shapes: for keeping the rig out of it.
 */
export function bodyCapsules(p) {
  const c = (name, a, b, r) => ({ name, a, b, r });
  return [
    c('torso', p.pelvis, p.chest, 0.135), c('torso', p.chest, p.neck, 0.13), c('head', p.head, p.head, 0.115),
    c('upper arm', p.shL, p.elL, 0.055), c('upper arm', p.shR, p.elR, 0.055),
    c('forearm', p.elL, p.haL, 0.045), c('forearm', p.elR, p.haR, 0.045),
    c('thigh', p.pelvis, p.kneeF, 0.085), c('thigh', p.pelvis, p.kneeB, 0.085),
    c('shin', p.kneeF, p.footF, 0.055), c('shin', p.kneeB, p.footB, 0.055),
  ];
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
