import * as THREE from 'three';

const MARK_COLORS = {
  asphalt: 0x243033, gravel: 0x715a42, dirt: 0x614333,
  snow: 0x7792a5, ice: 0xe8f6ff,
};

// A fixed-size ring of independent quads keeps every slide for several minutes
// without creating meshes, allocating new buffers, or joining separate slides.
export function createSkidMarks(groundHeight, { capacity = 3600, offroadSurface = 'dirt' } = {}) {
  const positions = new Float32Array(capacity * 18);
  const colors = new Float32Array(capacity * 18);
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const colorAttribute = new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('color', colorAttribute);
  geometry.setDrawRange(0, 0);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.57, depthWrite: false,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Persistent rear tyre skidmarks';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  const color = new THREE.Color();
  const pale = new THREE.Color(0xffffff), dry = new THREE.Color(0x9f947d);
  let cursor = 0, count = 0, previous = null;

  function tyreContacts(state) {
    const sin = Math.sin(state.heading), cos = Math.cos(state.heading);
    return [-1, 1].map(side => {
      const x = state.x - sin * 1.33 + cos * side * 1.045;
      const z = state.z - cos * 1.33 - sin * side * 1.045;
      return [-0.15, 0.15].map(offset => {
        const px = x + cos * offset, pz = z - sin * offset;
        return [px, groundHeight(px, pz) + 0.019, pz];
      });
    });
  }

  function append(a, b, surface, intensity) {
    const base = cursor * 18;
    const vertices = [a[0], b[0], a[1], a[1], b[0], b[1]];
    color.setHex(MARK_COLORS[surface] ?? MARK_COLORS.dirt);
    // A little brighter on mild slides keeps the marks subtle and legible.
    color.lerp(surface === 'snow' || surface === 'ice' ? pale : dry, (1 - intensity) * 0.18);
    for (let i = 0; i < 6; i++) {
      positions.set(vertices[i], base + i * 3);
      colors[base + i * 3] = color.r;
      colors[base + i * 3 + 1] = color.g;
      colors[base + i * 3 + 2] = color.b;
    }
    positionAttribute.addUpdateRange(base, 18);
    colorAttribute.addUpdateRange(base, 18);
    cursor = (cursor + 1) % capacity;
    count = Math.min(count + 1, capacity);
  }

  function update(dt, state) {
    const surface = state.offroad ? offroadSurface : state.surface;
    const eligible = state.mode === 'racing' && dt > 0 && dt <= 0.1 &&
      Math.abs(state.speed) > 3 && (Math.abs(state.slip || 0) > 0.23 || state.handbrake);
    if (!eligible) { previous = null; return; }
    const current = { x: state.x, z: state.z, heading: state.heading, surface, penalty: state.penalty, contacts: null };
    if (previous) {
      const distance = Math.hypot(current.x - previous.x, current.z - previous.z);
      const turn = Math.abs(Math.atan2(Math.sin(current.heading - previous.heading), Math.cos(current.heading - previous.heading)));
      // R, collisions and developer teleports must never leave a bridge across
      // the course. Tiny movement is accumulated to avoid stationary blobs.
      if (distance < 0.22 && surface === previous.surface && current.penalty === previous.penalty) return;
      if (distance <= Math.min(3.5, Math.max(0.85, Math.abs(state.speed) * dt * 2.3)) &&
          turn < 0.65 && surface === previous.surface && current.penalty === previous.penalty) {
        current.contacts = tyreContacts(state);
        for (let tyre = 0; tyre < 2; tyre++) append(previous.contacts[tyre], current.contacts[tyre], surface, Math.min(1, state.slip || 0.7));
        geometry.setDrawRange(0, count * 6);
        positionAttribute.needsUpdate = true;
        colorAttribute.needsUpdate = true;
      }
    }
    current.contacts ||= tyreContacts(state);
    previous = current;
  }

  function clear() {
    cursor = count = 0;
    previous = null;
    geometry.setDrawRange(0, 0);
    positionAttribute.clearUpdateRanges();
    colorAttribute.clearUpdateRanges();
  }

  return {
    mesh, update, clear,
    get segmentCount() { return count; },
    dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
