import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkidMarks } from '../src/skidmarks.js';

const STEP = 1 / 60;
const stateAt = (z, extra = {}) => ({ mode: 'racing', x: 0, z, heading: 0, speed: 24, surface: 'gravel', slip: 0.6, handbrake: false, offroad: false, penalty: 0, ...extra });

test('a slide draws two narrow rear tyre tracks projected onto uphill ground', () => {
  const ground = (x, z) => 8 + z * 0.17 + x * 0.03;
  const skids = createSkidMarks(ground);
  skids.update(STEP, stateAt(10));
  skids.update(STEP, stateAt(10.5));
  assert.equal(skids.segmentCount, 2);
  assert.equal(skids.mesh.geometry.drawRange.count, 12);
  const positions = skids.mesh.geometry.attributes.position.array;
  for (let i = 0; i < 36; i += 3) {
    assert.ok(Math.abs(positions[i + 1] - ground(positions[i], positions[i + 2]) - 0.019) < 0.00001);
    assert.ok(Math.abs(positions[i + 2] - 8.92) <= 0.251, 'Marks belong behind the rear axle');
  }
  const firstXs = [0, 3, 6, 9, 12, 15].map(index => positions[index]);
  const secondXs = [18, 21, 24, 27, 30, 33].map(index => positions[index]);
  assert.ok(Math.max(...firstXs) < -0.8);
  assert.ok(Math.min(...secondXs) > 0.8);
  assert.ok(Math.abs(Math.max(...firstXs) - Math.min(...firstXs) - 0.3) < 0.00001);
  skids.dispose();
});

test('parked, gripping and paused cars leave no marks; resumed slides never bridge the gap', () => {
  const skids = createSkidMarks(() => 0);
  skids.update(STEP, stateAt(0));
  skids.update(STEP, stateAt(0.5));
  assert.equal(skids.segmentCount, 2);
  for (const extra of [{ speed: 0, handbrake: true }, { slip: 0.02 }, { mode: 'paused' }, { mode: 'finished' }, { mode: 'countdown' }]) {
    skids.update(STEP, stateAt(1, extra));
    skids.update(STEP, stateAt(1.5, extra));
    assert.equal(skids.segmentCount, 2);
  }
  skids.update(STEP, stateAt(2));
  assert.equal(skids.segmentCount, 2, 'The first fresh position only establishes tyre contacts');
  skids.update(STEP, stateAt(2.5));
  assert.equal(skids.segmentCount, 4);
  skids.dispose();
});

test('recovery, teleports and surface changes break trail continuity', () => {
  const skids = createSkidMarks(() => 0);
  skids.update(STEP, stateAt(0));
  skids.update(STEP, stateAt(0.5));
  skids.update(STEP, stateAt(50));
  assert.equal(skids.segmentCount, 2, 'A teleport must not create a fifty metre skid');
  skids.update(STEP, stateAt(50.5));
  assert.equal(skids.segmentCount, 4);
  skids.update(STEP, stateAt(50.9, { penalty: 5 }));
  assert.equal(skids.segmentCount, 4, 'Even a short recovery breaks the previous strip');
  skids.update(STEP, stateAt(51.3, { penalty: 5, surface: 'asphalt' }));
  assert.equal(skids.segmentCount, 4);
  skids.update(STEP, stateAt(51.7, { penalty: 5, surface: 'asphalt' }));
  assert.equal(skids.segmentCount, 6);
  skids.dispose();
});

test('all surfaces support handbrake marks and the ring stays bounded until restart clears it', () => {
  const skids = createSkidMarks(() => 0, { capacity: 20, offroadSurface: 'snow' });
  const originalBuffer = skids.mesh.geometry.attributes.position.array;
  for (const surface of ['asphalt', 'gravel', 'dirt', 'snow', 'ice']) {
    skids.clear();
    skids.update(STEP, stateAt(0, { surface, slip: 0, handbrake: true }));
    for (let i = 1; i <= 40; i++) skids.update(STEP, stateAt(i * 0.5, { surface, slip: 0, handbrake: true }));
    assert.equal(skids.segmentCount, 20);
    assert.equal(skids.mesh.geometry.drawRange.count, 120);
    assert.equal(skids.mesh.geometry.attributes.position.array, originalBuffer);
    assert.ok([...originalBuffer].every(Number.isFinite));
  }
  skids.clear();
  assert.equal(skids.segmentCount, 0);
  assert.equal(skids.mesh.geometry.drawRange.count, 0);
  skids.update(STEP, stateAt(100));
  assert.equal(skids.segmentCount, 0, 'Restart cannot connect to the old run');
  skids.dispose();
});
