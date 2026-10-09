import * as THREE from 'three';
import { surfaces } from './track.js';
import { createSkidMarks } from './skidmarks.js';

const PALETTE = {
  meadow: 0x9faf72, grass: 0x8fa768, lightGrass: 0xa7b579,
  pine: 0x617c55, pineLight: 0x8a9d63, pineDark: 0x425f4d,
  trunk: 0x6e6851, rock: 0x9fa58e, cream: 0xfff4ce,
  orange: 0xf28044, charcoal: 0x263d40, red: 0xca604a,
};

function randomGenerator(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function material(color, extras = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...extras });
}

function box(group, size, position, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

function canvasLabel(text, { foreground = '#fff4ce', background = '#283e40', width = 512, height = 128, fontSize = 68 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = foreground;
  ctx.font = `900 ${fontSize}px monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2 + 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  return new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
}

function makeCar() {
  const car = new THREE.Group();
  const orange = material(PALETTE.orange);
  const cream = material(PALETTE.cream);
  const dark = material(PALETTE.charcoal);
  const glass = material(0x365358);
  const tireMat = material(0x243333);
  const silver = material(0xb5c4b8);
  const rearLight = new THREE.MeshBasicMaterial({ color: 0xe36c4e });
  const light = new THREE.MeshBasicMaterial({ color: 0xffebad });

  // The car's local origin is tyre contact height. Its nose points along +Z.
  box(car, [2.08, 0.56, 4.12], [0, 0.82, 0], cream);
  box(car, [1.97, 0.25, 1.25], [0, 1.18, 1.32], orange);
  box(car, [2.08, 0.28, 0.2], [0, 0.59, 2.08], dark);
  box(car, [2.08, 0.27, 0.2], [0, 0.59, -2.08], dark);
  box(car, [1.7, 0.18, 1.89], [0, 1.84, -0.22], orange);
  // Chunky cabin built as a trapezoid; the windshield and backlight follow it.
  const cabinVertices = new Float32Array([
    -0.92, 1.1, -1.43, 0.92, 1.1, -1.43, -0.79, 1.81, -1.11, 0.79, 1.81, -1.11,
    -0.92, 1.1, 0.99, 0.92, 1.1, 0.99, -0.79, 1.81, 0.66, 0.79, 1.81, 0.66,
  ]);
  const cabinGeo = new THREE.BufferGeometry();
  cabinGeo.setAttribute('position', new THREE.BufferAttribute(cabinVertices, 3));
  cabinGeo.setIndex([0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5, 2, 6, 3, 3, 6, 7]);
  cabinGeo.computeVertexNormals();
  car.add(new THREE.Mesh(cabinGeo, glass));
  for (const side of [-1, 1]) {
    box(car, [0.075, 0.75, 0.12], [side * 0.86, 1.47, -0.26], orange);
    const pillar = box(car, [0.085, 0.76, 0.12], [side * 0.86, 1.47, 0.81], cream);
    pillar.rotation.x = -0.42;
    const backPillar = box(car, [0.1, 0.75, 0.12], [side * 0.86, 1.46, -1.26], orange);
    backPillar.rotation.x = 0.42;
    box(car, [0.16, 0.12, 0.3], [side * 1.11, 1.3, 0.56], orange);
    box(car, [0.055, 0.18, 3.7], [side * 1.056, 0.9, 0], orange);
    box(car, [0.16, 0.24, 0.62], [side * 0.77, 0.94, -2.083], rearLight);
    box(car, [0.58, 0.28, 0.075], [side * 0.64, 1.04, 2.09], light);
    // Black mudflaps behind every wheel.
    for (const z of [-1.34, 1.35]) box(car, [0.34, 0.56, 0.07], [side * 1.01, 0.33, z - 0.43], tireMat);
  }
  box(car, [0.83, 0.25, 0.08], [0, 0.95, 2.105], dark);
  box(car, [1.0, 0.12, 0.085], [0, 0.83, -2.11], dark);
  box(car, [0.18, 0.34, 0.18], [-0.71, 1.45, -1.72], dark);
  box(car, [0.18, 0.34, 0.18], [0.71, 1.45, -1.72], dark);
  box(car, [2.12, 0.12, 0.41], [0, 1.64, -1.81], orange);
  box(car, [0.57, 0.055, 0.52], [0, 1.965, -0.03], dark);
  box(car, [0.38, 0.07, 0.34], [0, 1.99, 0.12], cream);
  box(car, [0.036, 0.48, 0.035], [0.3, 2.12, -0.65], dark);
  const stripe = box(car, [0.3, 0.014, 1.2], [-0.29, 1.315, 1.32], cream);
  stripe.rotation.x = 0;
  const numberMat = canvasLabel('07', { foreground: '#283e40', background: '#fff4ce', width: 128, height: 128, fontSize: 84 });
  for (const side of [-1, 1]) {
    const number = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.49), numberMat);
    number.position.set(side * 1.047, 0.99, -0.25);
    number.rotation.y = side * Math.PI / 2;
    car.add(number);
  }
  const rearLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.15), canvasLabel('POCKET', { width: 256, height: 64, fontSize: 42 }));
  rearLabel.position.set(0, 0.91, -2.113); rearLabel.rotation.y = Math.PI; car.add(rearLabel);

  const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.34, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.351, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const z of [-1.33, 1.33]) for (const side of [-1, 1]) {
    const wheel = new THREE.Group();
    wheel.position.set(side * 1.045, 0.49, z);
    wheel.userData.front = z > 0;
    wheel.add(new THREE.Mesh(wheelGeo, tireMat), new THREE.Mesh(hubGeo, silver));
    box(wheel, [0.36, 0.06, 0.47], [0, 0, 0], cream);
    box(wheel, [0.36, 0.47, 0.06], [0, 0, 0], cream);
    car.add(wheel); wheels.push(wheel);
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.35, 4.5), new THREE.MeshBasicMaterial({ color: 0x35463c, transparent: true, opacity: 0.24, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.025; car.add(shadow);
  car.traverse(obj => { if (obj.isMesh && obj !== shadow) { obj.castShadow = true; obj.receiveShadow = true; } });
  return { car, wheels };
}

export function createWorld(scene, track) {
  const winter = track.theme === 'winter';
  const random = randomGenerator(track.seed || 741982);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const groundPalette = winter ? [0xdde9eb, 0xd4e3e9, 0xe9eff0, 0xcddfe8, 0xd9e7ee, 0xe4edf1] : [0x93a66c, 0x9cac72, 0x9dad76, 0x899e67, 0xa7b67d, 0x96aa72];
  const stage = new THREE.Group(); stage.name = `Procedural ${track.name || 'North Ridge'}`; scene.add(stage);
  const obstacles = [];

  function terrainHeight(x, z, near = null) {
    const n = near || track.nearest(x, z);
    const away = Math.max(0, n.distance - 19);
    const waves = 0.48 + 0.25 * Math.sin(x * 0.016 + z * 0.009) + 0.18 * Math.sin(z * 0.029 - x * 0.014);
    const rise = Math.min(65, away * 0.29) * waves;
    return n.point.y - 0.8 + Math.floor(rise / 2) * 2;
  }

  // Flat-shaded terrain is generated below the verges; the separate verge
  // ribbon guarantees a seamless edge even on the ascending bends.
  const terrainPositions = [], terrainColors = [];
  const cell = 18;
  const routeBounds = track.samples.reduce((bounds, p) => ({
    minX: Math.min(bounds.minX, p.x), maxX: Math.max(bounds.maxX, p.x),
    minZ: Math.min(bounds.minZ, p.z), maxZ: Math.max(bounds.maxZ, p.z),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  const minX = routeBounds.minX - 580, maxX = routeBounds.maxX + 580;
  const minZ = routeBounds.minZ - 280, maxZ = routeBounds.maxZ + 310;
  const nx = Math.ceil((maxX - minX) / cell), nz = Math.ceil((maxZ - minZ) / cell);
  const heights = new Float32Array((nx + 1) * (nz + 1));
  for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) heights[iz * (nx + 1) + ix] = terrainHeight(minX + ix * cell, minZ + iz * cell);
  function terrainVertex(ix, iz, col) {
    terrainPositions.push(minX + ix * cell, heights[iz * (nx + 1) + ix], minZ + iz * cell);
    terrainColors.push(col.r, col.g, col.b);
  }
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    color.setHex(groundPalette[Math.floor(random() * groundPalette.length)]);
    terrainVertex(ix, iz, color); terrainVertex(ix, iz + 1, color); terrainVertex(ix + 1, iz, color);
    terrainVertex(ix + 1, iz, color); terrainVertex(ix, iz + 1, color); terrainVertex(ix + 1, iz + 1, color);
  }
  const terrainGeo = new THREE.BufferGeometry();
  terrainGeo.setAttribute('position', new THREE.Float32BufferAttribute(terrainPositions, 3));
  terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(terrainColors, 3));
  terrainGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeo, material(0xffffff, { vertexColors: true }));
  terrain.receiveShadow = true; stage.add(terrain);

  function ribbon(lateralA, lateralB, mat, { y = 0.04, start = 0, end = track.length, drop = 0, step = 3 } = {}) {
    const positions = [], indices = [];
    const segments = Math.max(1, Math.ceil((end - start) / step));
    for (let i = 0; i <= segments; i++) {
      const p = track.sample(start + (end - start) * i / segments);
      positions.push(p.x + p.tz * lateralA, p.y + y, p.z - p.tx * lateralA);
      positions.push(p.x + p.tz * lateralB, p.y + y - drop, p.z - p.tx * lateralB);
      if (i < segments) {
        const j = i * 2;
        if (lateralB > lateralA) indices.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
        else indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
      }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setIndex(indices); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; stage.add(mesh); return mesh;
  }
  const verge = material(winter ? 0xd4e4eb : 0xc9b993);
  const vergeGrass = material(winter ? 0xe4edf0 : 0x99ad71);
  ribbon(-8.3, 8.3, verge, { y: -0.02 });
  for (const side of [-1, 1]) {
    ribbon(side * 8.25, side * 15.5, vergeGrass, { y: -0.055, drop: 0.28 });
    ribbon(side * 15.5, side * 23.5, vergeGrass, { y: -0.34, drop: 0.62 });
  }
  for (const segment of track.surfaceSegments) {
    const roadMaterial = segment.surface === 'ice'
      ? new THREE.MeshPhongMaterial({ color: surfaces.ice.color, shininess: 70, specular: 0xd4eaff, flatShading: true })
      : material(surfaces[segment.surface].color);
    ribbon(-track.width / 2, track.width / 2, roadMaterial, { start: track.length * segment.from, end: track.length * segment.to });
  }
  const paint = material(winter ? 0xe0e9eb : 0xe0dcc0);
  const paintEdge = track.width / 2 - 0.55;
  for (const segment of track.surfaceSegments.filter(segment => segment.surface === 'asphalt')) {
    const start = segment.from * track.length, end = segment.to * track.length;
    ribbon(-paintEdge, -paintEdge + 0.19, paint, { y: 0.065, start, end });
    ribbon(paintEdge - 0.19, paintEdge, paint, { y: 0.065, start, end });
    for (let s = start + 6; s < end - 6; s += 16) ribbon(-0.065, 0.065, paint, { y: 0.071, start: s, end: s + 5.5 });
  }
  // Discrete pebbles and wheel ruts add grain without a texture or image asset.
  const pebbleCount = 2100;
  const pebbles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material(winter ? 0xffffff : 0xbda17d), pebbleCount);
  const looseSegments = track.surfaceSegments.filter(segment => segment.surface !== 'asphalt');
  const looseLength = looseSegments.reduce((sum, segment) => sum + segment.to - segment.from, 0);
  function randomLooseProgress() {
    let distance = random() * looseLength;
    for (const segment of looseSegments) {
      const span = segment.to - segment.from;
      if (distance <= span) return segment.from + distance;
      distance -= span;
    }
    return 0;
  }
  for (let i = 0; i < pebbleCount; i++) {
    const s = track.length * randomLooseProgress();
    const p = track.sample(s); const lateral = (random() - 0.5) * 11.8;
    dummy.position.set(p.x + p.tz * lateral, p.y + 0.064, p.z - p.tx * lateral);
    dummy.rotation.set(0, random() * Math.PI, 0);
    const icy = track.surfaceAt(s) === 'ice';
    dummy.scale.set(0.07 + random() * (icy ? 0.06 : 0.26), 0.012 + random() * 0.017, 0.12 + random() * (icy ? 1.4 : 0.38));
    dummy.updateMatrix(); pebbles.setMatrixAt(i, dummy.matrix);
    pebbles.setColorAt(i, color.setHex(winter ? (icy ? 0xc3e5f2 : i % 3 ? 0xeaf4f6 : 0xbecfdc) : i % 3 ? 0xd3bf98 : 0x987e60));
  }
  stage.add(pebbles);

  const trees = [];
  // Stage-side planting is deliberately denser than the distant forest.
  for (let s = -30; s < track.length + 80; s += 13) {
    const p = track.sample(s);
    for (const side of [-1, 1]) {
      const lateral = side * (20 + random() * 28);
      const x = p.x + p.tz * lateral + (random() - 0.5) * 7;
      const z = p.z - p.tx * lateral + (random() - 0.5) * 10;
      if (track.nearest(x, z).distance < 17) continue;
      trees.push({ x, z, y: terrainHeight(x, z), size: 0.8 + random() * 0.7, yaw: random() * Math.PI, variant: Math.floor(random() * 3) });
    }
  }
  for (let i = 0; i < 2400; i++) {
    const x = minX + 80 + random() * (maxX - minX - 160), z = minZ + 150 + random() * (maxZ - minZ - 280);
    const n = track.nearest(x, z);
    if (n.distance < 36 || n.distance > 430) continue;
    trees.push({ x, z, y: terrainHeight(x, z, n), size: 0.65 + random() * 1.25, yaw: random() * Math.PI, variant: Math.floor(random() * 3) });
  }
  const trunks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 3.9, 0.62), material(winter ? 0x667781 : PALETTE.trunk), trees.length);
  const crownGeometry = new THREE.ConeGeometry(3.3, 5.6, 4);
  const crownsA = new THREE.InstancedMesh(crownGeometry, material(0xffffff), trees.length);
  const crownsB = new THREE.InstancedMesh(crownGeometry, material(0xffffff), trees.length);
  const crownsC = new THREE.InstancedMesh(crownGeometry, material(0xffffff), trees.length);
  const treeColors = winter ? [0x527578, 0x719394, 0x44636e] : [PALETTE.pine, PALETTE.pineLight, PALETTE.pineDark];
  const snowCaps = winter ? [0, 1, 2].map(() => new THREE.InstancedMesh(crownGeometry, material(0xecf5f6), trees.length)) : [];
  trees.forEach((t, i) => {
    if (track.nearest(t.x, t.z).distance < 80) obstacles.push({ x: t.x, z: t.z, radius: 0.42 * t.size, kind: 'tree' });
    dummy.rotation.set(0, t.yaw + Math.PI / 4, 0);
    dummy.scale.setScalar(t.size); dummy.position.set(t.x, t.y + 1.9 * t.size, t.z); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    for (const [mesh, elevation, scale] of [[crownsA, 4.5, 1], [crownsB, 6.7, 0.8], [crownsC, 8.6, 0.59]]) {
      dummy.position.set(t.x, t.y + elevation * t.size, t.z); dummy.scale.setScalar(t.size * scale); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setHex(treeColors[t.variant]).multiplyScalar(mesh === crownsA ? 0.9 : mesh === crownsC ? 1.08 : 1));
    }
    snowCaps.forEach((mesh, tier) => {
      const elevation = [4.5, 6.7, 8.6][tier], scale = [1, 0.8, 0.59][tier];
      dummy.position.set(t.x, t.y + (elevation + scale * 0.66) * t.size, t.z);
      dummy.scale.setScalar(t.size * scale * 0.8); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    });
  });
  stage.add(trunks, crownsA, crownsB, crownsC, ...snowCaps);

  // Angular boulders and square wildflower tufts break up the grass verges.
  const rockCount = 340;
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), material(winter ? 0xb6cbd6 : PALETTE.rock), rockCount);
  const tufts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material(winter ? 0xffffff : 0xc0c182), 850);
  for (let i = 0; i < rockCount; i++) {
    const p = track.sample(random() * track.length); const side = random() < 0.5 ? -1 : 1; const offset = side * (19 + random() * 90);
    const x = p.x + p.tz * offset, z = p.z - p.tx * offset;
    if (track.nearest(x, z).distance < 17) { dummy.scale.setScalar(0); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix); continue; }
    dummy.position.set(x, terrainHeight(x, z) + 0.5, z); dummy.rotation.set(random(), random() * Math.PI, random() * 0.3);
    const scale = 0.5 + random() * 2.5; dummy.scale.set(scale * 1.3, scale * 0.8, scale); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
    if (track.nearest(x, z).distance < 65) obstacles.push({ x, z, radius: scale * 1.05, kind: 'rock' });
  }
  for (let i = 0; i < 850; i++) {
    const p = track.sample(random() * track.length); const offset = (random() < 0.5 ? -1 : 1) * (9.5 + random() * 6);
    dummy.position.set(p.x + p.tz * offset, p.y + 0.05, p.z - p.tx * offset); dummy.rotation.set(0, p.heading, 0);
    dummy.scale.set((winter ? 1.6 : 0.25) + random() * 0.7, (winter ? 0.17 : 0.25) + random() * 0.6, (winter ? 2.1 : 0.2) + random() * 0.5); dummy.updateMatrix(); tufts.setMatrixAt(i, dummy.matrix);
    tufts.setColorAt(i, color.setHex(winter ? (i % 3 ? 0xe8f1f4 : 0xccdee7) : i % 7 === 0 ? 0xe1cf8c : 0x7f995e));
  }
  stage.add(rocks, tufts);

  // Two rows of angular peaks form the blue-green valley walls.
  const mountainMaterials = (winter ? [0x9db9cf, 0xb1c9db, 0xc2d6e4, 0x8caabd] : [0x718f80, 0x819b89, 0x93a997, 0x6d897c]).map(hex => material(hex));
  for (let i = 0; i < 38; i++) {
    const side = i % 2 ? 1 : -1;
    const z = routeBounds.minZ - 100 + Math.floor(i / 2) * ((routeBounds.maxZ - routeBounds.minZ + 240) / 18);
    const x = (side < 0 ? routeBounds.minX : routeBounds.maxX) + side * (310 + random() * 190);
    const height = 100 + random() * 130;
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(100 + random() * 110, height, 4), mountainMaterials[i % mountainMaterials.length]);
    mountain.position.set(x, terrainHeight(x, z) + height * 0.27, z);
    mountain.rotation.y = Math.PI / 4 + random() * 0.65; stage.add(mountain);
    if (winter) {
      const cap = new THREE.Mesh(mountain.geometry, material(0xe1edf4));
      cap.position.copy(mountain.position); cap.position.y += height * 0.21;
      cap.rotation.copy(mountain.rotation); cap.scale.setScalar(0.58); stage.add(cap);
    }
  }

  // Verge markers always remain outside the drivable twelve-metre ribbon.
  const postCount = Math.floor(track.length / 27) * 2;
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 1.05, 0.24), material(0xf0e8c9), postCount);
  const reflectors = new THREE.InstancedMesh(new THREE.BoxGeometry(0.215, 0.19, 0.252), material(PALETTE.orange), postCount);
  let postIndex = 0;
  for (let s = 18; s < track.length - 10 && postIndex < postCount - 1; s += 27) {
    const p = track.sample(s);
    for (const side of [-1, 1]) {
      dummy.position.set(p.x + p.tz * 7.75 * side, p.y + 0.47, p.z - p.tx * 7.75 * side);
      dummy.rotation.set(0, p.heading, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); posts.setMatrixAt(postIndex, dummy.matrix);
      dummy.position.y += 0.29; dummy.updateMatrix(); reflectors.setMatrixAt(postIndex, dummy.matrix); postIndex++;
    }
  }
  posts.count = postIndex; reflectors.count = postIndex; stage.add(posts, reflectors);

  function atTrack(group, s, lateral = 0) {
    const p = track.sample(s); group.position.set(p.x + p.tz * lateral, p.y, p.z - p.tx * lateral); group.rotation.y = p.heading; stage.add(group); return group;
  }
  function arch(s, finish) {
    const group = new THREE.Group();
    const cream = material(PALETTE.cream), dark = material(PALETTE.charcoal), orange = material(PALETTE.orange);
    for (const side of [-1, 1]) {
      box(group, [0.65, 5.8, 0.65], [side * 7.7, 2.9, 0], dark);
      box(group, [0.79, 1.1, 0.78], [side * 7.7, 0.56, 0], orange);
      box(group, [0.35, 5.5, 0.35], [side * 8.8, 2.75, 0.8], cream);
      box(group, [1.75, 0.32, 1.4], [side * 8.2, 0.15, 0.2], dark);
    }
    box(group, [16.2, 1.7, 0.45], [0, 5.15, 0], dark);
    box(group, [16.3, 0.12, 0.55], [0, 6.02, 0], orange);
    const title = new THREE.Mesh(new THREE.PlaneGeometry(10.9, 1.35), canvasLabel(finish ? 'FINISH / META' : `${track.name} / ${track.code}`.toUpperCase(), { width: 1024, height: 128, fontSize: 54 }));
    title.position.set(0, 5.15, -0.234); title.rotation.y = Math.PI; group.add(title);
    // Checker pattern is individual code-built squares.
    for (const x of [-6.65, 6.65]) for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      box(group, [0.36, 0.36, 0.021], [x + (col - 1) * 0.36, 5.15 + (row - 1) * 0.36, -0.239], (row + col) % 2 ? dark : cream);
    }
    atTrack(group, s);
    for (let col = 0; col < 16; col++) for (let row = 0; row < 2; row++) {
      const p = track.sample(s - 0.9 + row * 0.7);
      const square = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.7), (row + col) % 2 ? dark : cream);
      const lateral = -5.625 + col * 0.75;
      square.position.set(p.x + p.tz * lateral, p.y + 0.082, p.z - p.tx * lateral); square.rotation.set(-Math.PI / 2, 0, -p.heading); stage.add(square);
    }
  }
  arch(30, false); arch(track.length - 18, true);

  const arrowMats = {
    left: canvasLabel('<<<', { foreground: '#f2dca0', background: '#354e47', fontSize: 98 }),
    right: canvasLabel('>>>', { foreground: '#f2dca0', background: '#354e47', fontSize: 98 }),
  };
  for (const note of track.pacenotes) {
    const side = note.direction === 'left' ? -1 : 1;
    for (let i = 0; i < 3; i++) {
      const group = new THREE.Group();
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.86), arrowMats[note.direction]);
      sign.position.set(0, 1.6, -0.07); sign.rotation.y = Math.PI; group.add(sign);
      box(group, [0.14, 1.95, 0.14], [-0.85, 0.96, 0], material(PALETTE.trunk));
      box(group, [0.14, 1.95, 0.14], [0.85, 0.96, 0], material(PALETTE.trunk));
      atTrack(group, note.s - 12 + i * 12, side * 8.8);
    }
  }

  // A small rally paddock frames the first view without occupying the course.
  const camp = new THREE.Group();
  const tentOrange = material(PALETTE.orange), tentCream = material(PALETTE.cream), dark = material(PALETTE.charcoal);
  for (const x of [-2.7, 2.7]) for (const z of [-2.3, 2.3]) box(camp, [0.14, 3.1, 0.14], [x, 1.55, z], dark);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.9, 1.7, 4), tentOrange); roof.scale.z = 0.88; roof.position.y = 3.5; roof.rotation.y = Math.PI / 4; camp.add(roof);
  box(camp, [5.7, 0.32, 4.85], [0, 2.93, 0], tentCream);
  box(camp, [3.1, 0.85, 1.0], [0, 0.42, 0.7], dark);
  atTrack(camp, 42, -18.5);
  for (let i = 0; i < 14; i++) {
    const p = track.sample(16 + i * 5.2);
    for (const side of [-1, 1]) {
      const barrier = new THREE.Group();
      box(barrier, [0.23, 0.9, 0.23], [0, 0.45, 0], dark);
      box(barrier, [0.075, 0.13, 5.25], [0, 0.76, 2.5], i % 2 ? tentCream : tentOrange);
      atTrack(barrier, p.s, side * 9.2);
    }
  }
  // Tiny marshals/spectators are built from blocks as well.
  for (let i = 0; i < 16; i++) {
    const person = new THREE.Group(); const shirt = material([0xe48748, 0x426b65, 0xf1d48c, 0x658797][i % 4]);
    box(person, [0.48, 0.61, 0.33], [0, 1.0, 0], shirt);
    box(person, [0.35, 0.36, 0.34], [0, 1.5, 0], material(0xdab58a));
    for (const side of [-1, 1]) { box(person, [0.18, 0.65, 0.21], [side * 0.15, 0.37, 0], dark); box(person, [0.15, 0.57, 0.21], [side * 0.32, 1.02, 0], shirt); }
    atTrack(person, 35 + random() * 56, (i % 2 ? 1 : -1) * (10.8 + random() * 2.5));
  }

  const { car, wheels } = makeCar(); scene.add(car);
  function contactHeight(x, z) {
    const near = track.nearest(x, z);
    const distance = near.distance;
    if (distance <= track.width / 2) return near.point.y + 0.04;
    if (distance <= 8.25) return near.point.y - 0.02;
    if (distance <= 15.5) return near.point.y - 0.055 - (distance - 8.25) / 7.25 * 0.28;
    if (distance <= 23.5) return near.point.y - 0.34 - (distance - 15.5) / 8 * 0.62;
    return terrainHeight(x, z, near);
  }
  const skidmarks = createSkidMarks(contactHeight, { offroadSurface: track.offroadSurface || 'dirt' });
  scene.add(skidmarks.mesh);
  const dustCount = 75;
  const dustMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: winter ? 0.6 : 0.42, depthWrite: false }), dustCount);
  dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); dustMesh.frustumCulled = false; scene.add(dustMesh);
  const dust = Array.from({ length: dustCount }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, size: 0, rotation: 0, color: 0xc9b68d }));
  let dustCursor = 0, dustAccumulator = 0, wheelRotation = 0;
  dummy.scale.setScalar(0); dummy.updateMatrix(); for (let i = 0; i < dustCount; i++) { dustMesh.setMatrixAt(i, dummy.matrix); dustMesh.setColorAt(i, color.setHex(0xffffff)); }

  // Sparse snow stays around the player, avoiding thousands of distant flakes.
  const flakes = winter ? Array.from({ length: 115 }, () => ({
    x: (random() - 0.5) * 100, y: random() * 38, z: (random() - 0.5) * 100,
    fall: 1.6 + random() * 1.8, size: 0.06 + random() * 0.09,
  })) : [];
  const snowMesh = winter ? new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0.68, depthWrite: false }), flakes.length) : null;
  if (snowMesh) { snowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); snowMesh.frustumCulled = false; scene.add(snowMesh); }
  let snowTime = 0;

  function update(dt, state) {
    skidmarks.update(dt, state);
    if (state.mode === 'paused') return;
    if (snowMesh) {
      snowTime += dt;
      for (let i = 0; i < flakes.length; i++) {
        const flake = flakes[i];
        flake.y = (flake.y - dt * flake.fall + 38) % 38;
        dummy.position.set(state.x + flake.x + Math.sin(snowTime * 0.5 + i) * 1.6, state.y + flake.y - 3, state.z + flake.z);
        dummy.rotation.set(snowTime * 0.3, 0, snowTime * 0.4 + i); dummy.scale.setScalar(flake.size); dummy.updateMatrix(); snowMesh.setMatrixAt(i, dummy.matrix);
      }
      snowMesh.instanceMatrix.needsUpdate = true;
    }
    const racing = state.mode === 'racing';
    if (!racing) return;
    wheelRotation -= state.speed * dt / 0.48;
    for (const wheel of wheels) { wheel.rotation.set(wheelRotation, wheel.userData.front ? -state.steer * 0.37 : 0, 0, 'YXZ'); }
    const actualSurface = state.offroad ? track.offroadSurface || 'dirt' : state.surface;
    const dusty = actualSurface !== 'asphalt' || Math.abs(state.slip || 0) > 0.3;
    if (dusty && Math.abs(state.speed) > 3) {
      dustAccumulator += dt * Math.min(44, Math.abs(state.speed) * 1.8);
      while (dustAccumulator > 1) {
        dustAccumulator--;
        const particle = dust[dustCursor++ % dustCount];
        const side = random() < 0.5 ? -1 : 1;
        particle.life = 0.8 + random() * 0.65;
        particle.x = state.x - Math.sin(state.heading) * 1.7 + Math.cos(state.heading) * side * 1.0;
        particle.z = state.z - Math.cos(state.heading) * 1.7 - Math.sin(state.heading) * side * 1.0;
        particle.y = contactHeight(particle.x, particle.z) + 0.35;
        particle.vx = -Math.sin(state.heading) * 1.8 + side * Math.cos(state.heading) * 1.2;
        particle.vz = -Math.cos(state.heading) * 1.8 - side * Math.sin(state.heading) * 1.2;
        particle.size = 0.25 + random() * 0.36; particle.rotation = random() * Math.PI;
        particle.color = actualSurface === 'snow' ? 0xe4f3fc : actualSurface === 'ice' ? 0xb9e1f4 : actualSurface === 'asphalt' ? 0xc8ccd0 : actualSurface === 'dirt' ? 0xb08b64 : 0xc9b68d;
      }
    } else dustAccumulator = 0;
    for (let i = 0; i < dustCount; i++) {
      const p = dust[i]; p.life = Math.max(0, p.life - dt);
      if (p.life <= 0) dummy.scale.setScalar(0);
      else {
        p.x += p.vx * dt; p.z += p.vz * dt; p.y += dt * 0.7;
        p.size += dt * 0.48;
        dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.rotation, p.rotation, 0);
        dummy.scale.setScalar(p.size * Math.min(1, p.life * 2.7));
      }
      dummy.updateMatrix(); dustMesh.setMatrixAt(i, dummy.matrix);
      dustMesh.setColorAt(i, color.setHex(p.color));
    }
    dustMesh.instanceMatrix.needsUpdate = true;
    dustMesh.instanceColor.needsUpdate = true;
  }

  function clearTrails() {
    skidmarks.clear();
    dustCursor = dustAccumulator = wheelRotation = 0;
    dummy.scale.setScalar(0); dummy.updateMatrix();
    for (let i = 0; i < dust.length; i++) { dust[i].life = 0; dustMesh.setMatrixAt(i, dummy.matrix); }
    dustMesh.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    // Shared wheel/crown geometry and sign textures are freed exactly once.
    const geometries = new Set(), materials = new Set(), textures = new Set();
    for (const root of [stage, car, dustMesh, snowMesh].filter(Boolean)) {
      root.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        for (const mat of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
          materials.add(mat);
          for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value);
        }
        if (object.isInstancedMesh) object.dispose();
      });
      root.removeFromParent();
    }
    textures.forEach(texture => texture.dispose());
    materials.forEach(mat => mat.dispose());
    geometries.forEach(geometry => geometry.dispose());
    skidmarks.dispose();
  }

  return { car, wheels, obstacles, update, clearTrails, dispose, get skidmarkCount() { return skidmarks.segmentCount; } };
}
