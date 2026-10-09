import test from 'node:test';
import assert from 'node:assert/strict';
import { RallyAudio } from '../src/audio.js';

// This clocked Web Audio mock checks scheduling and lifecycle, not perceived sound.
class MockParam {
  constructor(context, value = 0) {
    this.context = context;
    this._value = value;
    this.events = [];
    this.scheduled = 0;
    this.positiveEvents = 0;
    context.parameters.push(this);
  }
  get value() { return this._value; }
  set value(value) { assert.ok(Number.isFinite(value), 'Audio parameter must be finite'); this._value = value; }
  cancelScheduledValues(time) {
    assert.ok(Number.isFinite(time));
    this.events = this.events.filter(event => event.time < time);
  }
  record(value, time, kind) {
    assert.ok(Number.isFinite(time) && time >= 0, 'Audio timestamp must be finite and nonnegative');
    this.value = value;
    this.events.push({ value, time, kind });
    this.scheduled++;
    if (value > 0) this.positiveEvents++;
  }
  setTargetAtTime(value, time, duration) {
    assert.ok(Number.isFinite(duration) && duration > 0);
    this.record(value, time, 'target');
  }
  setValueAtTime(value, time) { this.record(value, time, 'value'); }
  linearRampToValueAtTime(value, time) { this.record(value, time, 'linear'); }
  exponentialRampToValueAtTime(value, time) {
    assert.ok(value > 0, 'Exponential ramps cannot target zero');
    this.record(value, time, 'exponential');
  }
}

class MockNode {
  constructor(context, kind) {
    this.context = context;
    this.kind = kind;
    this.connections = [];
    this.started = false;
    this.ended = false;
    this.stopTime = Infinity;
    for (const name of ['gain', 'frequency', 'detune', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release']) {
      this[name] = new MockParam(context);
    }
    context.nodes.push(this);
  }
  connect(node) { this.connections.push(node); }
  disconnect() { this.connections = []; }
  start(time = this.context.currentTime) {
    assert.equal(this.started, false, 'A source may start only once');
    assert.ok(Number.isFinite(time));
    this.started = true;
  }
  stop(time = this.context.currentTime) {
    if (this.ended) throw new Error('Source already ended');
    this.stopTime = time;
    if (time <= this.context.currentTime) this.end();
  }
  end() {
    if (this.ended) return;
    this.ended = true;
    this.onended?.();
  }
}

class MockAudioContext {
  static instances = [];
  constructor() {
    this.nodes = [];
    this.parameters = [];
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.resumeCalls = 0;
    this.suspendCalls = 0;
    this.destination = new MockNode(this, 'destination');
    MockAudioContext.instances.push(this);
  }
  createGain() { return new MockNode(this, 'gain'); }
  createBiquadFilter() { return new MockNode(this, 'filter'); }
  createDynamicsCompressor() { return new MockNode(this, 'compressor'); }
  createOscillator() { return new MockNode(this, 'oscillator'); }
  createBufferSource() { return new MockNode(this, 'bufferSource'); }
  createBuffer(channels, size) { return { getChannelData: () => new Float32Array(size) }; }
  async resume() { this.resumeCalls++; this.state = 'running'; }
  async suspend() { this.suspendCalls++; this.state = 'suspended'; }
  async close() { this.state = 'closed'; for (const node of this.nodes) if (node.started) node.end(); }
  advance(seconds) {
    if (this.state !== 'running') return;
    this.currentTime += seconds;
    for (const node of this.nodes) if (node.started && node.stopTime <= this.currentTime) node.end();
    for (const parameter of this.parameters) parameter.events = parameter.events.filter(event => event.time >= this.currentTime);
  }
}

const originalContext = globalThis.AudioContext;
globalThis.AudioContext = MockAudioContext;
test.after(() => {
  if (originalContext === undefined) delete globalThis.AudioContext;
  else globalThis.AudioContext = originalContext;
});

async function setup(t) {
  const audio = new RallyAudio();
  assert.equal(await audio.start(), true);
  t.after(() => audio.dispose());
  return audio;
}

const race = { running: true, mode: 'racing', theme: 'autumn', speed: 24, throttle: 1, brake: 0, slip: 0.6, rpm: 4600, surface: 'asphalt' };
const noteCount = audio => audio._musicVoices.reduce((sum, voice) => sum + voice.oscillator.frequency.scheduled, 0);

test('audio remains optional, and pre-start mute/music preferences are preserved', async () => {
  delete globalThis.AudioContext;
  const unsupported = new RallyAudio();
  unsupported.setMuted(true);
  unsupported.setMusicEnabled(false);
  unsupported.update(race);
  assert.equal(await unsupported.start(), false);
  unsupported.dispose();
  globalThis.AudioContext = MockAudioContext;
  const audio = new RallyAudio();
  audio.setMuted(true);
  audio.setMusicEnabled(false);
  assert.equal(await audio.start(), true);
  audio.update(race);
  assert.equal(audio.master.gain.value, 0);
  assert.equal(audio.musicEnabled, false);
  assert.equal(noteCount(audio), 0);
  audio.dispose();
});

test('four minutes of looping music reuse three voices with bounded future automation', async t => {
  const audio = await setup(t);
  const context = audio.context;
  const initialNodeCount = context.nodes.length;
  assert.equal(context.nodes.filter(node => node.kind === 'oscillator').length, 8);
  assert.equal(audio._musicVoices.length, 3);
  for (let frame = 0; frame < 2400; frame++) {
    audio.update({ ...race, mode: frame < 100 ? 'menu' : 'racing' }, 0.1);
    for (const voice of audio._musicVoices) {
      assert.ok(voice.envelope.gain.events.length <= 10, 'Only the look-ahead window may remain scheduled');
    }
    assert.ok(audio._musicStep >= 0 && audio._musicStep < 64);
    context.advance(0.1);
  }
  assert.equal(context.nodes.length, initialNodeCount, 'Music loops must not allocate fresh nodes');
  assert.equal(audio._oneShots.size, 0);
  assert.ok(noteCount(audio) > 900, 'The complete melody, bass and arpeggio should loop several times');
  assert.ok(audio._musicDrum.gain.positiveEvents > 200);
  assert.ok(audio.music.gain.value < audio.engine.gain.value, 'Music remains a quiet background layer');
});

test('music can be disabled independently while global mute silences both layers', async t => {
  const audio = await setup(t);
  audio.update(race);
  assert.equal(audio.musicEnabled, true);
  assert.ok(audio.engine.gain.value > 0);
  assert.ok(audio.music.gain.value > 0);
  audio.setMusicEnabled(false);
  const notesAtDisable = noteCount(audio);
  for (let i = 0; i < 120; i++) { audio.context.advance(1 / 60); audio.update(race); }
  assert.equal(noteCount(audio), notesAtDisable);
  assert.equal(audio.music.gain.value, 0);
  assert.ok(audio.engine.gain.value > 0);
  assert.equal(audio.context.state, 'running');
  audio.setMusicEnabled(true);
  audio.update(race);
  assert.ok(noteCount(audio) > notesAtDisable);
  audio.setMuted(true);
  const notesAtMute = noteCount(audio);
  audio.context.advance(1);
  audio.update(race);
  assert.equal(noteCount(audio), notesAtMute);
  assert.equal(audio.master.gain.value, 0);
  assert.equal(audio.musicEnabled, true);
  audio.setMuted(false);
  audio.update(race);
  assert.ok(audio.master.gain.value > 0);
  assert.ok(audio.music.gain.value > 0);
});

test('pause cancels pending music and suspends once; resume and repeated starts allocate no nodes', async t => {
  const audio = await setup(t);
  const context = audio.context;
  audio.update(race);
  const allocated = context.nodes.length;
  audio.update({ ...race, mode: 'paused', running: false });
  await Promise.resolve();
  assert.equal(context.state, 'suspended');
  assert.equal(audio._musicNextTime, null);
  assert.equal(audio.music.gain.value, 0);
  assert.equal(audio.engine.gain.value, 0);
  const pausedNotes = noteCount(audio);
  const pausedTime = context.currentTime;
  for (let i = 0; i < 100; i++) {
    context.advance(1);
    audio.update({ mode: 'paused' });
  }
  assert.equal(noteCount(audio), pausedNotes);
  assert.equal(context.currentTime, pausedTime);
  assert.equal(context.suspendCalls, 1);
  audio.update(race);
  await Promise.resolve();
  audio.update(race);
  assert.equal(context.state, 'running');
  assert.ok(noteCount(audio) > pausedNotes);
  for (let i = 0; i < 3; i++) { await audio.start(); audio.update({ ...race, mode: 'countdown' }); }
  assert.equal(context.nodes.length, allocated);
});

test('returning from a background clock gap schedules a fresh beat without catch-up', async t => {
  const audio = await setup(t);
  audio.update(race);
  const before = noteCount(audio);
  const allocated = audio.context.nodes.length;
  audio.context.advance(300);
  audio.update(race);
  const scheduled = noteCount(audio) - before;
  assert.ok(scheduled >= 1 && scheduled <= 3, `Unexpected catch-up burst of ${scheduled} notes`);
  assert.equal(audio.context.nodes.length, allocated);
  assert.ok(audio._musicNextTime > audio.context.currentTime);
  assert.ok(audio._musicNextTime < audio.context.currentTime + 0.6);
  for (const voice of audio._musicVoices) {
    assert.ok(voice.envelope.gain.events.every(event => event.time >= audio.context.currentTime));
  }
});

test('winter changes arrangement while snow and ice have softer road/tire noise', async t => {
  const audio = await setup(t);
  audio.update(race);
  const autumnPitch = audio._musicVoices[0].oscillator.frequency.value;
  const autumnBeat = audio._musicNextTime;
  const allocated = audio.context.nodes.length;
  audio.update({ ...race, theme: 'winter', surface: 'gravel' });
  const gravelNoise = audio.road.gain.value;
  const gravelTire = audio.tire.gain.value;
  assert.ok(audio._musicNextTime > autumnBeat, 'Winter arrangement uses a slower tempo');
  assert.equal(audio._musicVoices[0].oscillator.frequency.value, autumnPitch / 2);
  assert.ok(audio._musicVoices[0].filter.frequency.value < 1800);
  audio.update({ ...race, theme: 'winter', surface: 'snow' });
  const snowNoise = audio.road.gain.value;
  assert.ok(snowNoise < gravelNoise);
  assert.ok(audio.tire.gain.value < gravelTire);
  assert.equal(audio.squeal.gain.value, 0);
  audio.update({ ...race, theme: 'winter', surface: 'ice' });
  assert.ok(audio.road.gain.value < snowNoise);
  assert.ok(audio.squeal.gain.value < 0.01);
  assert.equal(audio.context.nodes.length, allocated);
});

test('nonfinite driving inputs never reach Web Audio parameters and menu/finish music stays available', async t => {
  const audio = await setup(t);
  for (const mode of ['menu', 'countdown', 'racing', 'finished']) {
    audio.context.advance(0.3);
    audio.update({ mode, speed: Infinity, throttle: NaN, slip: NaN, rpm: Infinity, surface: 'snow' }, NaN);
    assert.ok(audio.music.gain.value > 0);
    assert.equal(audio.engine.gain.value, 0);
  }
});

test('cues release their nodes, disposal closes all sources, and restart creates one fresh graph', async () => {
  const audio = new RallyAudio();
  await audio.start();
  const firstContext = audio.context;
  audio.update(race);
  for (const cue of ['countdown', 'go', 'checkpoint', 'finish', 'recover', 'click']) audio.beep(cue);
  assert.ok(audio._oneShots.size > 0);
  firstContext.advance(2);
  assert.equal(audio._oneShots.size, 0);
  audio.setMusicEnabled(false);
  audio.dispose();
  assert.equal(firstContext.state, 'closed');
  assert.ok(firstContext.nodes.filter(node => node.started).every(node => node.ended));
  assert.equal(audio._sources.length, 0);
  assert.equal(audio.context, null);
  await audio.start();
  assert.notEqual(audio.context, firstContext);
  assert.equal(audio.context.nodes.filter(node => node.kind === 'oscillator').length, 8);
  assert.equal(audio.musicEnabled, false);
  audio.update(race);
  assert.equal(noteCount(audio), 0);
  audio.dispose();
});
