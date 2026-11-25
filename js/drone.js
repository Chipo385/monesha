// Generic survey/spray drone and the survey flight that photographs the land.
// Deliberately not any real make or model (see docs/BRIEF.md).
import * as THREE from 'three';
import { lin, LOW } from './detail.js';

/** A quadcopter about 1 unit across. Returns { group, spin(dt) }. */
export function buildDrone(scale = 1) {
  const group = new THREE.Group();
  const M = (c, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color: lin(c), roughness, metalness });
  const shell = M(0xd9dcd8, 0.45, 0.1), dark = M(0x23282a, 0.5, 0.3), glass = M(0x0a0d10, 0.1, 0.4);
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); group.add(m); return m; };
  add(new THREE.SphereGeometry(0.17, 24, 14), shell, 0, 0, 0).scale.set(1.25, 0.45, 0.85);
  add(new THREE.BoxGeometry(0.2, 0.05, 0.13), dark, -0.02, 0.07, 0);
  const rotors = [];
  const disc = new THREE.MeshBasicMaterial({ color: 0xcfd6d2, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sx * 0.34, z = sz * 0.34;
    const arm = add(new THREE.CylinderGeometry(0.018, 0.024, 0.42, 8), dark, x / 2, 0.01, z / 2);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(sx, 0, sz).normalize());
    add(new THREE.CylinderGeometry(0.04, 0.045, 0.08, 14), dark, x, 0.04, z);
    const r = new THREE.Group();
    r.position.set(x, 0.09, z);
    r.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.006, 0.026), dark));
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.2, 28), disc);
    d.rotation.x = -Math.PI / 2;
    r.add(d);
    group.add(r); rotors.push(r);
  }
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.36, 0.014, 0.014), dark, 0, -0.18, s * 0.14);
  for (const x of [-0.1, 0.1]) for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.012, 0.14, 0.012), dark, x, -0.12, s * 0.13);
  add(new THREE.SphereGeometry(0.055, 18, 14), dark, 0.13, -0.1, 0);
  add(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 16), glass, 0.14, -0.15, 0);
  group.traverse((o) => { if (o.isMesh && o.material !== disc) o.castShadow = !LOW; });
  group.scale.setScalar(scale);
  return { group, spin: (dt) => rotors.forEach((r, i) => { r.rotation.y += dt * (i % 2 ? 38 : -38); }) };
}

/** Lawn-mower survey flight: a drone that photographs the ground, leaving a trail of photo frames. */
export function buildSurvey(farm, { scale = 0.62, speed = 0.8 } = {}) {
  const { W, VS, groundY } = farm;
  const group = new THREE.Group();
  const alt = VS + 0.75, path = [];
  for (let r = 0; r < 12; r++) {
    const z = (-0.45 + r / 11 * 0.9) * W, a = (r % 2 ? 0.45 : -0.45) * W;
    path.push(new THREE.Vector3(a, alt, z), new THREE.Vector3(-a, alt, z));
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path),
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.4 }));
  line.computeLineDistances();
  group.add(line);
  const drone = buildDrone(scale);
  group.add(drone.group);

  // View pyramid from the camera to the patch of ground being photographed
  const HX = 0.62, HZ = 0.46, SEG = 6;
  const cone = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3)),
    new THREE.LineBasicMaterial({ color: 0xc6f36b, transparent: true, opacity: 0.55 }));
  cone.frustumCulled = false;
  const FRAMES = 14, frames = [];
  for (let i = 0; i < FRAMES; i++) {
    const f = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEG * 4 * 3), 3)),
      new THREE.LineBasicMaterial({ color: 0xc6f36b, transparent: true, opacity: 0 }));
    f.frustumCulled = false; frames.push(f); group.add(f);
  }
  group.add(cone);
  const clampG = (x, z) => groundY(Math.min(0.999, Math.max(0.001, x / W + 0.5)), Math.min(0.999, Math.max(0.001, z / W + 0.5)));
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const drape = (f, x, z) => {
    const a = f.geometry.attributes.position.array; let n = 0;
    corners.forEach((c, i) => { const d = corners[(i + 1) % 4];
      for (let s = 0; s < SEG; s++) { const t = s / SEG, px = x + HX * (c[0] + (d[0] - c[0]) * t), pz = z + HZ * (c[1] + (d[1] - c[1]) * t); a[n++] = px; a[n++] = clampG(px, pz) + 0.03; a[n++] = pz; } });
    f.geometry.attributes.position.needsUpdate = true;
  };
  const legs = path.slice(1).map((v, i) => v.distanceTo(path[i]));
  const total = legs.reduce((a, b) => a + b, 0);
  // Start part-way along so the opening view has the drone over the middle of the land
  let dist = total * 0.555, last = -1, next = 0;
  function update(dt) {
    dist = (dist + dt * speed) % total;
    let d = dist, s = 0;
    while (s < legs.length - 1 && d > legs[s]) d -= legs[s++];
    const pos = drone.group.position.copy(path[s]).lerp(path[s + 1], d / legs[s]);
    drone.group.rotation.y = path[s + 1].x >= path[s].x ? 0 : Math.PI;
    drone.spin(dt);
    const shot = Math.floor(dist / 0.85);
    if (shot !== last) { last = shot; const f = frames[next++ % FRAMES]; drape(f, pos.x, pos.z); f.material.opacity = 1; }
    frames.forEach((f) => { f.material.opacity = Math.max(0, f.material.opacity - dt * 0.09); });
    const a = cone.geometry.attributes.position.array;
    corners.forEach((c, i) => { const x = pos.x + HX * c[0], z = pos.z + HZ * c[1]; a.set([pos.x, pos.y - 0.1 * scale, pos.z, x, clampG(x, z) + 0.03, z], i * 6); });
    cone.geometry.attributes.position.needsUpdate = true;
  }
  update(0.001);
  return { group, update };
}

/** Irrigation set-up: borehole, pump and storage at the yard, buried mainline to pivots and orchard submain. */
export function buildIrrigation(farm) {
  const { W, L, groundY, yard, trees } = farm;
  const g = new THREE.Group();
  const P = (u, v, lift = 0.02) => new THREE.Vector3((u - 0.5) * W, groundY(u, v) + lift, (v - 0.5) * W);
  const pipe = (a, b, r, color) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push(P(a.u + (b.u - a.u) * i / 40, a.v + (b.v - a.v) * i / 40));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, r, 6), new THREE.MeshBasicMaterial({ color })));
  };
  const mark = (p, color, h) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, h, 12), new THREE.MeshBasicMaterial({ color }));
    m.position.copy(P(p.u, p.v, h / 2)); g.add(m);
  };
  const tank = { u: yard.u + 0.016, v: yard.v + 0.01 }, bore = { u: yard.u - 0.02, v: yard.v + 0.03 };
  mark(bore, 0x7ff0d4, 0.08); mark(tank, 0xffffff, 0.06);
  pipe(bore, tank, 0.0045, 0x7ff0d4);
  L.pivots.forEach((p) => pipe(tank, p, 0.0055, 0x2f9bff));
  if (trees.orchard.length) {
    const c = trees.orchard.reduce((a, t) => [a[0] + t.x, a[1] + t.z], [0, 0]).map((v) => v / trees.orchard.length / W + 0.5);
    pipe(tank, { u: c[0], v: c[1] }, 0.0055, 0xffb347);
  }
  return g;
}
