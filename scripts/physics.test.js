import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RallySimulation, SURFACES, formatTime, wrapAngle } from '../src/physics.js';
import { track, tracks, getTrack, surfaces } from '../src/track.js';

const STEP = 1 / 60;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function straightTrack(surface = 'asphalt', heading = 0) {
  const tx = Math.sin(heading), tz = Math.cos(heading);
  return {
    width: 100,
    length: 600,
    sample(s) { return { x: tx * s, y: 0, z: tz * s, s, heading }; },
    surfaceAt() { return surface; },
    nearest(x, z) {
      const s = clamp(x * tx + z * tz, 0, this.length);
      const point = this.sample(s);
      return { index: 0, s, lateral: x * tz - z * tx, point, distance: Math.hypot(x - point.x, z - point.z) };
    },
  };
}

function chaseCamera(origin, heading, high = false) {
  const camera = new THREE.PerspectiveCamera(57, 1, 0.15, 1600);
  const tx = Math.sin(heading), tz = Math.cos(heading);
  const back = high ? 15 : 9.2;
  camera.position.set(origin.x - tx * back, origin.y + (high ? 10 : 4.8), origin.z - tz * back);
  camera.lookAt(origin.x + tx * 12, origin.y + 1.7, origin.z + tz * 12);
  camera.updateMatrixWorld();
  return camera;
}

function screenX(point, camera) {
  return new THREE.Vector3(point.x, point.y, point.z).project(camera).x;
}

function running(track = straightTrack()) {
  const simulation = new RallySimulation(track);
  simulation.start();
  for (let frame = 0; simulation.mode === 'countdown' && frame < 190; frame++) {
    simulation.tick(STEP);
  }
  assert.equal(simulation.mode, 'racing');
  simulation.surface = track.surfaceAt(simulation.s);
  simulation.events.length = 0;
  return simulation;
}

function frames(simulation, count, input = {}) {
  for (let frame = 0; frame < count; frame++) simulation.tick(STEP, input);
}

test('countdown locks the car and stage clock until GO', () => {
  const simulation = new RallySimulation(straightTrack());
  simulation.start();
  const start = { x: simulation.x, z: simulation.z };
  frames(simulation, 120, { throttle: true, steer: 1 });
  assert.equal(simulation.mode, 'countdown');
  assert.equal(simulation.elapsed, 0);
  assert.equal(simulation.speed, 0);
  assert.deepEqual({ x: simulation.x, z: simulation.z }, start);
  while (simulation.mode === 'countdown') simulation.tick(STEP, { throttle: true });
  assert.equal(simulation.elapsed, 0);
  assert.deepEqual(simulation.events.map(event => event.type), ['countdown', 'countdown', 'countdown', 'go']);
  simulation.tick(STEP, { throttle: true });
  assert.ok(simulation.elapsed > 0);
  assert.ok(simulation.z > start.z);
});

test('throttle accelerates and braking reduces forward speed', () => {
  const simulation = running();
  frames(simulation, 180, { throttle: true });
  const speedBeforeBrake = simulation.speed;
  const positionBeforeBrake = simulation.z;
  assert.ok(speedBeforeBrake > 20, `Expected usable acceleration, got ${speedBeforeBrake} m/s`);
  frames(simulation, 36, { brake: true });
  assert.ok(simulation.speed < speedBeforeBrake - 8);
  assert.ok(simulation.vz > 0, 'Brief braking should still leave forward momentum');
  assert.ok(simulation.z > positionBeforeBrake);
});

test('left and right inputs match both chase cameras at different headings on every surface', () => {
  for (const surface of Object.keys(SURFACES)) for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    const left = running(straightTrack(surface, heading));
    const right = running(straightTrack(surface, heading));
    frames(left, 100, { throttle: true });
    frames(right, 100, { throttle: true });
    // Keep the camera at its pre-turn pose so its follow motion cannot hide
    // which side the driver actually chose. +X is screen-left at heading 0.
    const cameras = [chaseCamera(left, heading), chaseCamera(left, heading, true)];
    frames(left, 35, { throttle: true, steer: -1 });
    frames(right, 35, { throttle: true, steer: 1 });
    for (const camera of cameras) {
      const leftX = screenX(left, camera), rightX = screenX(right, camera);
      assert.ok(leftX < -0.01, `Left input must move left on ${surface} at heading ${heading}, got ${leftX}`);
      assert.ok(rightX > 0.01, `Right input must move right on ${surface} at heading ${heading}, got ${rightX}`);
      assert.ok(Math.abs(leftX + rightX) < 1e-9, 'Opposite steering must remain symmetric');
    }
    assert.ok(wrapAngle(left.heading - heading) > 0);
    assert.ok(wrapAngle(right.heading - heading) < 0);
    assert.ok(Math.abs(left.s - right.s) < 1e-9);
  }
});

test('every pacenote on both stages names the bend seen through the forward-facing camera', () => {
  assert.equal(track.pacenotes.length, 8);
  for (const stage of tracks) for (const note of stage.pacenotes) {
    const entry = stage.sample(note.s - 25);
    const exit = stage.sample(note.s + 25);
    const camera = chaseCamera(entry, entry.heading);
    // Compare the outgoing tangent to the incoming driver's view using Three's
    // projection, independently of the heading-sign rule used by the notes.
    const outgoing = { x: entry.x + exit.tx * 30, y: entry.y + 1.7, z: entry.z + exit.tz * 30 };
    const projectedX = screenX(outgoing, camera);
    assert.ok(Math.abs(projectedX) > 0.2, `The bend at ${note.s} m must be clearly directional`);
    const perceivedDirection = projectedX < 0 ? 'left' : 'right';
    assert.equal(note.direction, perceivedDirection, `Wrong callout on ${stage.id} at ${Math.round(note.s)} m: ${note.label}`);
    assert.equal(note.label, `${perceivedDirection === 'left' ? 'LEWY' : 'PRAWY'} ${note.severity}`);
  }
});

test('winter is a distinct complete stage with alternating snow, ice and asphalt', () => {
  const winter = getTrack('frost-pass');
  assert.equal(tracks.length, 2);
  assert.equal(getTrack('pine-pass'), track);
  assert.equal(getTrack('unknown-stage'), track);
  assert.equal(winter.theme, 'winter');
  assert.equal(winter.offroadSurface, 'snow');
  assert.notEqual(winter.seed, track.seed);
  assert.ok(winter.length > 2000 && winter.length < 2600);
  assert.notEqual(winter.samples, track.samples);
  assert.ok(Math.abs(winter.sample(winter.length * 0.5).x - track.sample(track.length * 0.5).x) > 20);
  assert.deepEqual([...new Set(winter.surfaceSegments.map(segment => segment.surface))].sort(), ['asphalt', 'ice', 'snow']);
  assert.ok(winter.surfaceSegments.filter(segment => segment.surface === 'ice').length >= 2);
  for (const stage of tracks) {
    assert.equal(stage.surfaceSegments[0].from, 0);
    assert.equal(stage.surfaceSegments.at(-1).to, 1);
    for (const [index, segment] of stage.surfaceSegments.entries()) {
      assert.ok(segment.from < segment.to);
      assert.ok(SURFACES[segment.surface] && surfaces[segment.surface]);
      assert.equal(stage.surfaceAt((segment.from + segment.to) / 2 * stage.length), segment.surface);
      if (index > 0) {
        assert.equal(stage.surfaceSegments[index - 1].to, segment.from);
        assert.equal(stage.surfaceAt(segment.from * stage.length + 0.01), segment.surface);
      }
    }
  }
});

test('switching stages resets position, surface, drift and stage progress', () => {
  const simulation = running(track);
  frames(simulation, 120, { throttle: true, steer: 0.2 });
  simulation.track = getTrack('frost-pass');
  simulation.reset();
  const start = simulation.track.sample(14);
  assert.equal(simulation.surface, 'snow');
  assert.equal(simulation.mode, 'menu');
  assert.equal(simulation.x, start.x);
  assert.equal(simulation.z, start.z);
  assert.equal(simulation.heading, start.heading);
  assert.equal(simulation.maxS, 14);
  assert.equal(simulation.checkpoint, 0);
  assert.equal(simulation.penalty, 0);
  assert.equal(simulation.elapsed, 0);
  assert.equal(simulation.speed, 0);
  assert.equal(simulation.lateralVelocity, 0);
  assert.equal(simulation.slip, 0);
});

test('pause freezes race position, velocity and elapsed time; resuming continues', () => {
  const simulation = running();
  frames(simulation, 100, { throttle: true });
  simulation.pause();
  const frozen = { x: simulation.x, z: simulation.z, vx: simulation.vx, vz: simulation.vz, elapsed: simulation.elapsed };
  frames(simulation, 240, { throttle: true, steer: 1 });
  assert.equal(simulation.mode, 'paused');
  assert.deepEqual({ x: simulation.x, z: simulation.z, vx: simulation.vx, vz: simulation.vz, elapsed: simulation.elapsed }, frozen);
  simulation.pause();
  simulation.tick(STEP, { throttle: true });
  assert.equal(simulation.mode, 'racing');
  assert.ok(simulation.elapsed > frozen.elapsed);
  assert.ok(simulation.z > frozen.z);
});

test('pause also freezes countdown and resumes the remaining count', () => {
  const simulation = new RallySimulation(straightTrack());
  simulation.start();
  frames(simulation, 60);
  simulation.pause();
  const remaining = simulation.countdown;
  frames(simulation, 120);
  assert.equal(simulation.countdown, remaining);
  simulation.pause();
  assert.equal(simulation.mode, 'countdown');
  simulation.tick(STEP);
  assert.ok(simulation.countdown < remaining);
});

test('recovery costs five seconds, preserves earned progress and enforces its cooldown', () => {
  const simulation = running();
  frames(simulation, 180, { throttle: true });
  const maxS = simulation.maxS;
  const elapsed = simulation.elapsed;
  const checkpoint = simulation.checkpoint;
  simulation.x = 18;
  assert.equal(simulation.recover(), true);
  assert.equal(simulation.penalty, 5);
  assert.equal(simulation.totalTime, elapsed + 5);
  assert.equal(simulation.maxS, maxS);
  assert.equal(simulation.checkpoint, checkpoint);
  assert.ok(simulation.s <= maxS, 'Recovery cannot earn forward progress');
  assert.equal(simulation.x, 0);
  assert.equal(simulation.speed, 0);
  assert.equal(simulation.recover(), false);
  assert.equal(simulation.penalty, 5);
  frames(simulation, 91);
  assert.equal(simulation.recover(), true);
  assert.equal(simulation.penalty, 10);
  assert.equal(simulation.maxS, maxS);
});

test('loose surfaces retain more sideways slip and accelerate more slowly', () => {
  const sliding = {};
  const accelerating = {};
  for (const surface of Object.keys(SURFACES)) {
    const simulation = running(straightTrack(surface));
    simulation.vx = 8;
    simulation.vz = 22;
    simulation.speed = Math.hypot(8, 22);
    frames(simulation, 6);
    sliding[surface] = { slip: simulation.slip, x: simulation.x };
    const acceleratingCar = running(straightTrack(surface));
    frames(acceleratingCar, 120, { throttle: true });
    accelerating[surface] = acceleratingCar.speed;
  }
  assert.ok(sliding.asphalt.slip < sliding.gravel.slip);
  assert.ok(sliding.gravel.slip < sliding.dirt.slip);
  assert.ok(sliding.asphalt.x < sliding.gravel.x);
  assert.ok(sliding.gravel.x < sliding.dirt.x);
  assert.ok(accelerating.asphalt > accelerating.gravel);
  assert.ok(accelerating.gravel > accelerating.dirt);
  assert.ok(sliding.dirt.slip < sliding.snow.slip);
  assert.ok(sliding.snow.slip < sliding.ice.slip);
  assert.ok(sliding.dirt.x < sliding.snow.x);
  assert.ok(sliding.snow.x < sliding.ice.x);
  assert.ok(accelerating.dirt > accelerating.snow);
  assert.ok(accelerating.snow > accelerating.ice);
});

test('gravel develops substantially more drift than the previous handling and settles after releasing steering', () => {
  const simulation = running(straightTrack('gravel'));
  simulation.vz = 25;
  simulation.speed = 25;
  frames(simulation, 45, { throttle: true, steer: 0.65 });
  // Recorded with the previous grip=4.0, yaw drift=0.6 tuning, using this exact
  // 25 m/s entry speed and 45-frame manoeuvre: 3.64611298874137 m/s sideways.
  const previousLateralVelocity = 3.64611298874137;
  const drift = Math.abs(simulation.lateralVelocity);
  assert.ok(drift > previousLateralVelocity * 1.8, `Gravel drift should be visibly stronger, got ${drift} m/s`);
  assert.ok(drift < 10, 'The rear slide should remain controllable');
  assert.ok(simulation.heading < 0 && simulation.x < 0, 'The car still follows a right steering input');
  frames(simulation, 90);
  assert.ok(Math.abs(simulation.lateralVelocity) < drift * 0.1, 'Releasing steering must allow grip to settle the car');
  assert.equal(simulation.penalty, 0);
});

test('snow braking is weaker than asphalt and ice needs the longest braking distance', () => {
  const results = {};
  for (const surface of ['asphalt', 'snow', 'ice']) {
    const simulation = running(straightTrack(surface));
    simulation.vz = 22;
    simulation.speed = 22;
    const startZ = simulation.z;
    frames(simulation, 30, { brake: true });
    results[surface] = { distance: simulation.z - startZ, speed: simulation.speed };
  }
  assert.ok(results.asphalt.speed < results.snow.speed);
  assert.ok(results.snow.speed < results.ice.speed);
  assert.ok(results.asphalt.distance < results.snow.distance);
  assert.ok(results.snow.distance < results.ice.distance);
  assert.ok(results.ice.speed - results.asphalt.speed > 6);
});

test('winter snowbanks apply snow traction and stronger drag than the autumn verge', () => {
  const results = {};
  for (const offroadSurface of ['dirt', 'snow']) {
    const stage = straightTrack();
    stage.width = 12;
    stage.offroadSurface = offroadSurface;
    const simulation = running(stage);
    simulation.x = 10;
    simulation.offroad = true;
    simulation.vz = 22;
    simulation.speed = 22;
    frames(simulation, 30);
    results[offroadSurface] = simulation.speed;
    assert.equal(simulation.offroad, true);
  }
  assert.ok(results.snow < results.dirt - 1);
});

test('appearing at the finish without driving through sectors cannot finish the stage', () => {
  const simulation = running();
  simulation.z = simulation.track.length - 5;
  frames(simulation, 10);
  assert.equal(simulation.mode, 'racing');
  assert.equal(simulation.checkpoint, 0);
  assert.equal(simulation.maxS, 14);
  assert.equal(simulation.events.some(event => event.type === 'finish'), false);
});

test('a long verge excursion can rejoin, regain progress and complete the stage', () => {
  const narrowTrack = straightTrack();
  narrowTrack.width = 12;
  const simulation = running(narrowTrack);
  let vergeDistance = 0;
  let maximumLateral = 0;
  let checkedRejoin = false;
  for (let frame = 0; frame < 60 * 90 && simulation.mode !== 'finished'; frame++) {
    const previousS = simulation.s;
    // Steer onto the verge, run parallel to the road, then steer back onto it.
    const targetX = simulation.s > 55 && simulation.s < 170 ? 14 : 0;
    const headingError = wrapAngle(Math.atan2(targetX - simulation.x, 12) - simulation.heading);
    simulation.tick(STEP, {
      steer: clamp(-headingError * 2.6, -1, 1),
      throttle: simulation.speed < 16,
      brake: simulation.speed > 18,
    });
    if (Math.abs(simulation.lateral) > narrowTrack.width * 0.8) {
      vergeDistance += Math.max(0, simulation.s - previousS);
    }
    maximumLateral = Math.max(maximumLateral, Math.abs(simulation.lateral));
    if (!checkedRejoin && simulation.s > 220 && Math.abs(simulation.lateral) < 1) {
      assert.ok(simulation.maxS > 200, `Rejoined at ${simulation.s} m but progress is stuck at ${simulation.maxS} m`);
      assert.equal(simulation.checkpoint, 1);
      checkedRejoin = true;
    }
  }
  assert.ok(vergeDistance > 30, 'The excursion must exceed the old 18 m progress window');
  assert.ok(maximumLateral > narrowTrack.width && maximumLateral < 26);
  assert.equal(simulation.penalty, 0, 'Driving back onto the road must not need manual recovery');
  assert.equal(checkedRejoin, true);
  assert.equal(simulation.checkpoint, 2);
  assert.equal(simulation.mode, 'finished');
});

test('teleporting after the first sector cannot claim the second, and recovery restores valid driving', () => {
  const simulation = running();
  while (simulation.maxS < 210) simulation.tick(STEP, { throttle: true });
  assert.equal(simulation.checkpoint, 1);
  const earned = simulation.maxS;
  simulation.z = simulation.track.length - 5;
  frames(simulation, 10);
  assert.equal(simulation.mode, 'racing');
  assert.equal(simulation.checkpoint, 1);
  assert.equal(simulation.maxS, earned);
  assert.equal(simulation.recover(), true);
  frames(simulation, 120, { throttle: true });
  assert.ok(simulation.maxS > earned, 'Recovery must reset the continuity anchor');
});

test('invalid frame durations cannot move the car or corrupt the clock', () => {
  const simulation = running();
  for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1]) {
    simulation.tick(dt, { throttle: true });
  }
  assert.equal(simulation.elapsed, 0);
  assert.equal(simulation.speed, 0);
  assert.equal(simulation.s, 14);
  assert.equal(formatTime(65.432), '01:05.432');
  assert.ok(Math.abs(wrapAngle(Math.PI * 2 + 0.2) - 0.2) < 1e-12);
});

for (const stage of tracks) test(`${stage.name} is drivable end-to-end through both gates and every surface`, () => {
  const simulation = running(stage);
  const seenSurfaces = new Set();
  const checkpointPositions = [];
  let previousCheckpoint = 0;
  let maximumLateral = 0;
  // A deterministic driver uses only route geometry and the same public inputs
  // as the keyboard. It never changes position, progress, gates, or game mode.
  for (let frame = 0; frame < 60 * 240 && simulation.mode !== 'finished'; frame++) {
    const target = stage.sample(simulation.s + 12);
    const headingError = wrapAngle(Math.atan2(target.x - simulation.x, target.z - simulation.z) - simulation.heading);
    const bend = Math.abs(wrapAngle(stage.sample(simulation.s + 32).heading - simulation.heading));
    // Read the road ahead, brake before ice, and take winter bends more slowly.
    const surfaceSpeeds = { asphalt: 22, gravel: 22, dirt: 20, snow: 18, ice: 14 };
    const safeSpeed = Math.min(surfaceSpeeds[simulation.surface], surfaceSpeeds[stage.surfaceAt(simulation.s + 60)]);
    const targetSpeed = safeSpeed - Math.min(bend, 1) * 6;
    simulation.tick(STEP, {
      steer: clamp(-headingError * 2.6, -1, 1),
      throttle: simulation.speed < targetSpeed,
      brake: simulation.speed > targetSpeed + 2,
    });
    seenSurfaces.add(simulation.surface);
    maximumLateral = Math.max(maximumLateral, Math.abs(simulation.lateral));
    if (simulation.checkpoint !== previousCheckpoint) {
      checkpointPositions.push(simulation.maxS);
      previousCheckpoint = simulation.checkpoint;
    }
  }
  assert.equal(simulation.mode, 'finished', `Car stopped at ${simulation.s.toFixed(1)} / ${stage.length.toFixed(1)} m`);
  assert.equal(simulation.checkpoint, 2);
  assert.equal(checkpointPositions.length, 2);
  assert.ok(checkpointPositions[0] >= stage.length / 3);
  assert.ok(checkpointPositions[0] < stage.length / 3 + 1);
  assert.ok(checkpointPositions[1] >= stage.length * 2 / 3);
  assert.ok(checkpointPositions[1] < stage.length * 2 / 3 + 1);
  assert.deepEqual([...seenSurfaces].sort(), [...new Set(stage.surfaceSegments.map(segment => segment.surface))].sort());
  assert.equal(simulation.penalty, 0, 'The complete route should be drivable without recovery');
  assert.ok(maximumLateral < stage.width / 2, `The driver should stay on the road, max deviation ${maximumLateral}`);
  assert.equal(simulation.events.filter(event => event.type === 'finish').length, 1);
  assert.ok(simulation.elapsed > 60 && simulation.elapsed < 240);
  const result = { time: simulation.totalTime, x: simulation.x, z: simulation.z };
  frames(simulation, 120, { throttle: true });
  assert.deepEqual({ time: simulation.totalTime, x: simulation.x, z: simulation.z }, result);
  assert.equal(simulation.recover(), false);
});
