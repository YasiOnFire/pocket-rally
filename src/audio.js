const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const noteFrequency = note => 440 * 2 ** ((note - 69) / 12);

// Original eight-bar A-minor theme. Zero is a rest; notes are MIDI pitches.
const MELODY = [
  [76, 0, 79, 81, 0, 79, 76, 0],
  [72, 0, 76, 77, 0, 76, 72, 69],
  [76, 0, 79, 84, 0, 83, 79, 76],
  [74, 0, 79, 81, 79, 0, 74, 71],
  [76, 79, 81, 0, 84, 0, 81, 79],
  [77, 0, 76, 72, 0, 69, 72, 76],
  [77, 0, 81, 79, 77, 0, 74, 69],
  [76, 0, 80, 83, 0, 80, 76, 0],
];
const HARMONY = [
  [45, 0, 3, 7], [41, 0, 4, 7], [48, 0, 4, 7], [43, 0, 4, 7],
  [45, 0, 3, 7], [41, 0, 4, 7], [50, 0, 3, 7], [40, 0, 4, 7],
];

/** All sound is synthesized locally: no samples, media downloads, or audio files. */
export class RallyAudio {
  constructor() {
    this.muted = false;
    this.musicEnabled = true;
    this.context = null;
    this._sources = [];
    this._oneShots = new Set();
    this._rpm = 1000;
    this._gear = null;
    this._shift = 0;
    this._starting = null;
    this._unavailable = false;
    this._mode = 'menu';
    this._musicActive = false;
    this._musicStep = 0;
    this._musicNextTime = null;
    this._musicTheme = null;
    this._pausedByGame = false;
    this._suspendTask = null;
  }

  /** Call directly from the start/restart button or a keyboard event. */
  async start() {
    if (this._starting) return this._starting;
    if (this._unavailable) return false;
    this._starting = this._start();
    try {
      return await this._starting;
    } finally {
      this._starting = null;
    }
  }

  async _start() {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) {
      this._unavailable = true;
      return false;
    }
    try {
      if (!this.context || this.context.state === 'closed') {
        this.context = new Context({ latencyHint: 'interactive' });
        this._buildGraph();
      }
      if (this.context.state === 'suspended') await this.context.resume();
      return this.context.state === 'running';
    } catch {
      // Browsers can deny audio; the rally remains playable without it.
      return false;
    }
  }

  _buildGraph() {
    const ctx = this.context;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.68;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -19;
    compressor.knee.value = 20;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.18;
    compressor.connect(this.master);
    this.master.connect(ctx.destination);
    this._mix = compressor;

    this.engine = ctx.createGain();
    this.engine.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 900;
    this.engineFilter.Q.value = 0.65;
    this.engineFilter.connect(this.engine);
    this.engine.connect(compressor);
    this._voices = [
      { type: 'triangle', ratio: 1, level: 0.57, detune: -3 },
      { type: 'sawtooth', ratio: 2, level: 0.13, detune: 3 },
      { type: 'triangle', ratio: 3, level: 0.11, detune: -1 },
      { type: 'sawtooth', ratio: 0.5, level: 0.075, detune: 1 },
    ].map(({ type, ratio, level, detune }) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.value = 22 * ratio;
      oscillator.detune.value = detune;
      gain.gain.value = level;
      oscillator.connect(gain);
      gain.connect(this.engineFilter);
      oscillator.start();
      this._sources.push(oscillator);
      return { oscillator, ratio };
    });

    // A seeded, two-second noise loop supplies road grit and tire friction.
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    let seed = 0x5eeda11;
    for (let i = 0; i < samples.length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      samples[i] = (seed >>> 0) / 0x100000000 * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'lowpass';
    this.roadFilter.frequency.value = 450;
    this.roadFilter.Q.value = 0.6;
    this.road = ctx.createGain();
    this.road.gain.value = 0;
    noise.connect(this.roadFilter);
    this.roadFilter.connect(this.road);
    this.road.connect(compressor);

    this.tireFilter = ctx.createBiquadFilter();
    this.tireFilter.type = 'bandpass';
    this.tireFilter.frequency.value = 1600;
    this.tireFilter.Q.value = 0.85;
    this.tire = ctx.createGain();
    this.tire.gain.value = 0;
    noise.connect(this.tireFilter);
    this.tireFilter.connect(this.tire);
    this.tire.connect(compressor);

    this.squeal = ctx.createGain();
    this.squeal.gain.value = 0;
    this.squealOscillator = ctx.createOscillator();
    this.squealOscillator.type = 'triangle';
    this.squealOscillator.frequency.value = 490;
    this.squealOscillator.connect(this.squeal);
    this.squeal.connect(compressor);
    this.squealOscillator.start();
    noise.start();
    this._sources.push(noise, this.squealOscillator);
    this._buildMusic(noise);
  }

  _buildMusic(noise) {
    const ctx = this.context;
    this.music = ctx.createGain();
    this.music.gain.value = 0;
    this.music.connect(this._mix);
    this._musicVoices = ['square', 'triangle', 'square'].map((type, index) => {
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      oscillator.type = type;
      oscillator.frequency.value = 220;
      envelope.gain.value = 0;
      filter.type = 'lowpass';
      filter.frequency.value = [1800, 700, 1400][index];
      filter.Q.value = 0.45;
      oscillator.connect(filter);
      filter.connect(envelope);
      envelope.connect(this.music);
      oscillator.start();
      this._sources.push(oscillator);
      return { oscillator, envelope, filter };
    });
    this._musicDrum = ctx.createGain();
    this._musicDrum.gain.value = 0;
    const drumFilter = ctx.createBiquadFilter();
    drumFilter.type = 'bandpass';
    drumFilter.frequency.value = 3400;
    drumFilter.Q.value = 0.65;
    noise.connect(drumFilter);
    drumFilter.connect(this._musicDrum);
    this._musicDrum.connect(this.music);
  }

  setMusicEnabled(enabled) {
    this.musicEnabled = Boolean(enabled);
    if (!this.musicEnabled) this._stopMusic();
  }

  _stopMusic() {
    if (this.context && this.context.state !== 'closed' && this.music) {
      const now = this.context.currentTime;
      for (const voice of this._musicVoices) {
        voice.oscillator.frequency.cancelScheduledValues(now);
        voice.envelope.gain.cancelScheduledValues(now);
        voice.envelope.gain.setValueAtTime(0, now);
      }
      this._musicDrum.gain.cancelScheduledValues(now);
      this._musicDrum.gain.setValueAtTime(0, now);
      this.music.gain.cancelScheduledValues(now);
      this.music.gain.setValueAtTime(0, now);
    }
    this._musicActive = false;
    this._musicNextTime = null;
  }

  _musicEnvelope(parameter, start, length, level) {
    parameter.cancelScheduledValues(start);
    parameter.setValueAtTime(0, start);
    parameter.linearRampToValueAtTime(level, start + 0.007);
    parameter.exponentialRampToValueAtTime(0.0001, start + length);
    parameter.setValueAtTime(0, start + length + 0.008);
  }

  _musicNote(voice, note, start, length, level) {
    voice.oscillator.frequency.setValueAtTime(noteFrequency(note), start);
    this._musicEnvelope(voice.envelope.gain, start, length, level);
  }

  _scheduleMusicStep(start, stepDuration, winter) {
    const step = this._musicStep % 8;
    const bar = Math.floor(this._musicStep / 8) % MELODY.length;
    const melody = MELODY[bar][step];
    const [root, ...chord] = HARMONY[bar];
    if (melody && !(winter && step === 3)) {
      this._musicNote(this._musicVoices[0], melody - (winter ? 12 : 0), start, stepDuration * 0.82, winter ? 0.10 : 0.11);
    }
    if (step === 0 || step === 4) {
      this._musicNote(this._musicVoices[1], root + (step === 4 ? 12 : 0), start, stepDuration * 3.2, 0.15);
    }
    if (step % 2 === 1 && (!winter || step === 1 || step === 5)) {
      const pitch = root + 24 + chord[Math.floor(step / 2) % chord.length];
      this._musicNote(this._musicVoices[2], pitch, start, stepDuration * 0.45, winter ? 0.025 : 0.035);
    }
    if (step % 2 === 0 && (!winter || step === 2 || step === 6)) {
      this._musicEnvelope(this._musicDrum.gain, start, step === 2 || step === 6 ? 0.075 : 0.028, winter ? 0.035 : 0.055);
    }
    this._musicStep = (this._musicStep + 1) % (MELODY.length * 8);
  }

  _updateMusic(state) {
    if (!this.musicEnabled || this.muted || this._mode === 'paused') {
      if (this._musicActive) this._stopMusic();
      return;
    }
    const theme = state.theme === 'winter' ? 'winter' : 'autumn';
    const winter = theme === 'winter';
    const now = this.context.currentTime;
    if (this._musicTheme !== theme) {
      this._stopMusic();
      this._musicTheme = theme;
      this._musicStep = 0;
      this._target(this._musicVoices[0].filter.frequency, winter ? 1000 : 1800);
      this._target(this._musicVoices[2].filter.frequency, winter ? 1100 : 1400);
    }
    if (!this._musicActive) {
      this._musicActive = true;
      this._musicNextTime = now + 0.025;
    }
    // A background tab may skip minutes of frames: continue from one fresh beat,
    // never allocate or schedule a burst of all the notes that were missed.
    if (this._musicNextTime < now - 0.05) this._musicNextTime = now + 0.025;
    const level = this._mode === 'racing' ? 0.12 : this._mode === 'countdown' ? 0.09 : 0.17;
    this._target(this.music.gain, level * (winter ? 0.88 : 1), 0.08);
    const stepDuration = 60 / (winter ? 102 : 106) / 2;
    let scheduled = 0;
    while (this._musicNextTime < now + 0.18 && scheduled < 2) {
      this._scheduleMusicStep(this._musicNextTime, stepDuration, winter);
      this._musicNextTime += stepDuration;
      scheduled++;
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted) this._stopMusic();
    if (this.context && this.master && this.context.state !== 'closed') {
      this._target(this.master.gain, this.muted ? 0 : 0.68, 0.025);
    }
  }

  _target(parameter, value, duration = 0.055) {
    const now = this.context.currentTime;
    parameter.cancelScheduledValues(now);
    parameter.setTargetAtTime(value, now, duration);
  }

  /** speed: metres/second; inputs: 0..1; rpm optional; running false silences motion. */
  update(state = {}, dt = 1 / 60) {
    this._mode = state.mode || (state.running ? 'racing' : 'menu');
    if (this.context && this.context.state !== 'closed' && this._mode === 'paused') {
      if (this._musicActive) this._stopMusic();
      if (this.context.state === 'running') {
        for (const gain of [this.engine, this.road, this.tire, this.squeal]) {
          if (gain) this._target(gain.gain, 0, 0.015);
        }
      }
      this._pausedByGame = true;
      // Stop the audio clock while the entire game is paused. The music toggle
      // alone never suspends the context, so engine and UI sounds still work.
      if (this.context.state === 'running' && !this._suspendTask && this.context.suspend) {
        const ctx = this.context;
        this._suspendTask = ctx.suspend().catch(() => {}).finally(() => {
          this._suspendTask = null;
          if (ctx === this.context && !this._pausedByGame && ctx.state === 'suspended') ctx.resume().catch(() => {});
        });
      }
      return;
    }
    if (this._pausedByGame) {
      this._pausedByGame = false;
      if (this.context?.state === 'suspended') this.context.resume().catch(() => {});
    }
    if (!this.context || !this.engine || this.context.state !== 'running') return;
    this._updateMusic(state);
    const timeStep = clamp(finite(dt, 1 / 60), 0, 0.1);
    const speed = Math.abs(finite(state.speed));
    const throttle = clamp(finite(Number(state.throttle)), 0, 1);
    const brake = clamp(finite(Number(state.brake)), 0, 1);
    const slip = clamp(Math.abs(finite(state.slip)), 0, 1);
    const running = Boolean(state.running);
    const surface = String(state.surface || 'asphalt').toLowerCase();
    const loose = /gravel|dirt|grass|szuter|żwir|ziemi|traw/.test(surface);
    const asphalt = /asphalt|asfalt|tarmac|road/.test(surface);
    const snow = /snow|śnieg|snieg/.test(surface);
    const ice = /ice|lód|lod/.test(surface);
    const gear = Number.isFinite(state.gear) ? state.gear : Math.max(1, Math.ceil(speed / 11));
    if (this._gear !== null && gear !== this._gear && running) this._shift = 0.14;
    this._gear = gear;
    this._shift = Math.max(0, this._shift - timeStep);

    const estimatedRpm = 1000 + (speed / Math.max(1, Math.abs(gear))) * 420 + throttle * 950;
    const requestedRpm = clamp(finite(state.rpm, estimatedRpm), 750, 8200);
    const targetRpm = running ? requestedRpm : 900;
    this._rpm += (targetRpm - this._rpm) * (1 - Math.exp(-timeStep * 9));
    const fundamental = this._rpm / 60 * (this._shift > 0 ? 0.88 : 1);
    for (const { oscillator, ratio } of this._voices) {
      this._target(oscillator.frequency, fundamental * ratio, 0.035);
    }
    this._target(this.engineFilter.frequency, 420 + this._rpm * 0.15 + throttle * 580);
    const motorVolume = 0.08 + throttle * 0.08 + Math.min(speed / 50, 1) * 0.018;
    this._target(this.engine.gain, running ? motorVolume * (this._shift > 0 ? 0.58 : 1) : 0);

    const rolling = running ? clamp(speed / 36, 0, 1.4) : 0;
    this._target(this.roadFilter.frequency, snow ? 380 + rolling * 220 : ice ? 180 + rolling * 210 : loose ? 820 + rolling * 650 : 290 + rolling * 430);
    this._target(this.road.gain, Math.sqrt(rolling) * (snow ? 0.041 : ice ? 0.012 : loose ? 0.10 : 0.028));
    const friction = clamp(slip * 0.9 + brake * Math.min(speed / 22, 1) * 0.25 - 0.13, 0, 1);
    const movingFriction = friction * clamp(speed / 7, 0, 1) * (running ? 1 : 0);
    this._target(this.tire.gain, movingFriction * (snow ? 0.044 : ice ? 0.032 : loose ? 0.075 : 0.105));
    this._target(this.tireFilter.frequency, snow ? 650 : ice ? 1800 : loose ? 880 : 1450 + slip * 800);
    this._target(this.squeal.gain, movingFriction * (asphalt ? 0.025 : ice ? 0.006 : 0), 0.08);
    this._target(this.squealOscillator.frequency, 450 + slip * 180 + Math.min(speed, 55) * 2, 0.1);
  }

  beep(kind = 'countdown') {
    const ctx = this.context;
    if (!ctx || !this._mix || ctx.state !== 'running') return;
    const cues = {
      countdown: { notes: [660], step: 0.15, length: 0.105, level: 0.11 },
      go: { notes: [660, 990], step: 0.085, length: 0.23, level: 0.115 },
      checkpoint: { notes: [880, 1109], step: 0.07, length: 0.09, level: 0.065 },
      finish: { notes: [523, 659, 784, 1047], step: 0.12, length: 0.24, level: 0.11 },
      recover: { notes: [392, 294], step: 0.095, length: 0.12, level: 0.075 },
      click: { notes: [740], step: 0.05, length: 0.035, level: 0.055 },
    };
    const cue = cues[kind] || cues.click;
    cue.notes.forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      const start = ctx.currentTime + index * cue.step;
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(cue.level, start + 0.006);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + cue.length);
      oscillator.connect(envelope);
      envelope.connect(this._mix);
      this._oneShots.add(oscillator);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
        this._oneShots.delete(oscillator);
      };
      oscillator.start(start);
      oscillator.stop(start + cue.length + 0.02);
    });
  }

  dispose() {
    this._stopMusic();
    for (const source of [...this._sources, ...this._oneShots]) {
      try { source.stop(); } catch { /* Already ended. */ }
      try { source.disconnect(); } catch { /* Context may already be closed. */ }
    }
    this._sources = [];
    this._oneShots.clear();
    if (this.context && this.context.state !== 'closed') {
      this.context.close().catch(() => {});
    }
    this.context = null;
    this.master = null;
    this.engine = null;
    this._mix = null;
    this._gear = null;
    this._shift = 0;
    this.music = null;
    this._musicVoices = [];
    this._musicDrum = null;
    this._musicStep = 0;
    this._musicTheme = null;
    this._pausedByGame = false;
    this._suspendTask = null;
  }
}
