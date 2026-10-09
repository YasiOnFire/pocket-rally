import * as THREE from 'three';

export const surfaces = {
  asphalt: { name: 'ASFALT', color: '#727f85', grip: 1 },
  gravel: { name: 'SZUTER', color: '#c6ab85', grip: 0.61 },
  dirt: { name: 'ZIEMIA', color: '#aa805c', grip: 0.53 },
  snow: { name: 'ŚNIEG', color: '#e7eef0', grip: 0.43 },
  ice: { name: 'LÓD', color: '#8fc8de', grip: 0.23 },
};

function createTrack(definition) {
  const { points, notes, ...metadata } = definition;
  // Metres throughout. Both valleys advance along Z, while every stage owns
  // its curve, samples and surface schedule independently.
  const controlPoints = points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'centripetal');
  curve.arcLengthDivisions = 3000;
  const length = curve.getLength();
  const sampleCount = Math.ceil(length / 3);
  const samples = [];
  for (let i = 0; i <= sampleCount; i++) {
    const u = i / sampleCount;
    const point = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u);
    const horizontal = Math.hypot(tangent.x, tangent.z);
    const tx = tangent.x / horizontal, tz = tangent.z / horizontal;
    samples.push({ x: point.x, y: point.y, z: point.z, s: u * length, tx, tz, heading: Math.atan2(tx, tz) });
  }

  function sample(s) {
    const clamped = THREE.MathUtils.clamp(s, 0, length);
    const n = clamped / length * sampleCount;
    const index = Math.min(sampleCount - 1, Math.floor(n));
    const a = samples[index], b = samples[index + 1], t = n - index;
    let tx = THREE.MathUtils.lerp(a.tx, b.tx, t);
    let tz = THREE.MathUtils.lerp(a.tz, b.tz, t);
    const norm = Math.hypot(tx, tz);
    tx /= norm; tz /= norm;
    return {
      x: THREE.MathUtils.lerp(a.x, b.x, t), y: THREE.MathUtils.lerp(a.y, b.y, t),
      z: THREE.MathUtils.lerp(a.z, b.z, t), s: clamped, tx, tz, heading: Math.atan2(tx, tz),
    };
  }

  function nearest(x, z, hint = 0) {
    // Full polyline projection remains exact near the finish and after reset.
    // hint is accepted for callers, but never sacrifices the nearest result.
    let best = Infinity, bestIndex = 0, bestT = 0;
    for (let i = 0; i < sampleCount; i++) {
      const a = samples[i], b = samples[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      const px = a.x + dx * t, pz = a.z + dz * t;
      const distance2 = (x - px) ** 2 + (z - pz) ** 2;
      if (distance2 < best) { best = distance2; bestIndex = i; bestT = t; }
    }
    const s = THREE.MathUtils.lerp(samples[bestIndex].s, samples[bestIndex + 1].s, bestT);
    const point = sample(s);
    return {
      s, index: bestIndex, point,
      lateral: (x - point.x) * point.tz - (z - point.z) * point.tx,
      distance: Math.sqrt(best),
    };
  }

  function surfaceAt(s) {
    const progress = THREE.MathUtils.clamp(s / length, 0, 1);
    return metadata.surfaceSegments.find(segment => progress < segment.to)?.surface
      ?? metadata.surfaceSegments.at(-1).surface;
  }

  // Notes sit at the apex. Their hand-tuned severity is independent of the
  // direction, which comes from the actual bend in the driver's +Z view.
  const pacenotes = notes.map(([index, severity]) => {
    const point = controlPoints[index];
    const s = nearest(point.x, point.z).s;
    const angle = sample(s + 25).heading - sample(s - 25).heading;
    const direction = Math.atan2(Math.sin(angle), Math.cos(angle)) > 0 ? 'left' : 'right';
    return { s, direction, severity, label: `${direction === 'left' ? 'LEWY' : 'PRAWY'} ${severity}` };
  });

  return { ...metadata, length, width: 12, samples, sample, nearest, surfaceAt, pacenotes };
}

const pine = createTrack({
  id: 'pine-pass', name: 'Sosnowa Przełęcz', code: 'OS 01', theme: 'autumn',
  titleLines: ['SOSNOWA', 'PRZEŁĘCZ'], seed: 741982, offroadSurface: 'dirt',
  description: 'Asfalt, luźny szuter i ziemia. Zarzuć tyłem między sosnami i złap kolejny zakręt.',
  surfaceSegments: [
    { from: 0, to: 0.33, surface: 'asphalt' },
    { from: 0.33, to: 0.73, surface: 'gravel' },
    { from: 0.73, to: 0.87, surface: 'dirt' },
    { from: 0.87, to: 1, surface: 'asphalt' },
  ],
  points: [
    [0, 8, 0], [0, 9, 115], [18, 12, 205], [-43, 18, 290],
    [-98, 23, 365], [-28, 27, 442], [73, 32, 510], [142, 37, 606],
    [92, 43, 706], [-28, 47, 765], [-111, 52, 848], [-83, 58, 950],
    [20, 63, 1040], [133, 69, 1111], [171, 73, 1218],
    [86, 78, 1310], [9, 83, 1426], [48, 89, 1526],
    [145, 94, 1612], [159, 99, 1717], [74, 105, 1817],
    [-3, 110, 1900], [-31, 116, 2014], [-12, 118, 2090],
  ],
  notes: [[2, 4], [4, 2], [7, 3], [10, 2], [14, 3], [16, 3], [19, 4], [22, 4]],
});

const winter = createTrack({
  id: 'frost-pass', name: 'Biała Grań', code: 'OS 02', theme: 'winter',
  titleLines: ['BIAŁA', 'GRAŃ'], seed: 928411, offroadSurface: 'snow',
  description: 'Śnieg, lodowe zakręty i skrawki asfaltu. Hamuj wcześniej, skręcaj delikatnie, pilnuj tyłu.',
  surfaceSegments: [
    { from: 0, to: 0.18, surface: 'snow' },
    { from: 0.18, to: 0.29, surface: 'asphalt' },
    { from: 0.29, to: 0.43, surface: 'ice' },
    { from: 0.43, to: 0.60, surface: 'snow' },
    { from: 0.60, to: 0.70, surface: 'asphalt' },
    { from: 0.70, to: 0.82, surface: 'ice' },
    { from: 0.82, to: 0.94, surface: 'snow' },
    { from: 0.94, to: 1, surface: 'asphalt' },
  ],
  points: [
    [0, 18, 0], [0, 20, 100], [-42, 25, 175], [-72, 31, 240],
    [35, 40, 335], [95, 49, 420], [55, 55, 510], [-70, 63, 600],
    [-130, 70, 690], [-55, 80, 780], [65, 91, 875], [115, 99, 980],
    [28, 108, 1085], [-84, 117, 1170], [-112, 123, 1260],
    [5, 132, 1360], [110, 140, 1435], [132, 146, 1530],
    [45, 150, 1640], [-38, 153, 1730], [-8, 154, 1810],
  ],
  notes: [[3, 2], [5, 3], [8, 2], [11, 3], [14, 2], [17, 3], [19, 3]],
});

export const tracks = [pine, winter];
export const getTrack = id => tracks.find(stage => stage.id === id) ?? pine;
export const track = pine;
export default track;
