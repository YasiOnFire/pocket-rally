export const SURFACES = {
  asphalt: { name: 'ASFALT', detail: 'WYSOKA PRZYCZEPNOŚĆ', grip: 8.5, power: 1, drift: 0.6, braking: 1 },
  gravel: { name: 'SZUTER', detail: 'TYŁ UCIEKA · ŁAP KONTRĘ', grip: 2.6, power: 0.9, drift: 0.95, braking: 0.85 },
  dirt: { name: 'ZIEMIA', detail: 'UWAŻAJ NA POŚLIZG', grip: 2.3, power: 0.78, drift: 0.9, braking: 0.75 },
  snow: { name: 'ŚNIEG', detail: 'MIĘKKO · HAMUJ WCZEŚNIEJ', grip: 1.8, power: 0.7, drift: 0.95, braking: 0.55 },
  ice: { name: 'LÓD', detail: 'ŚLISKO · DELIKATNIE Z GAZEM', grip: 0.9, power: 0.52, drift: 1, braking: 0.28 },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
export function formatTime(seconds) {
  const ms = Math.floor(Math.max(0, seconds) * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

export class RallySimulation {
  constructor(track) { this.track = track; this.obstacles = []; this.reset(); }
  reset() {
    const p = this.track.sample(14);
    Object.assign(this, { mode: 'menu', previousMode: 'racing', x: p.x, y: p.y, z: p.z,
      heading: p.heading, vx: 0, vz: 0, speed: 0, steer: 0, s: 14, maxS: 14, validatedS: 14,
      elapsed: 0, penalty: 0, countdown: 3, lastCount: 4, surface: this.track.surfaceAt(p.s),
      lateral: 0, lateralVelocity: 0, slip: 0, offroad: false, nearestIndex: 0, checkpoint: 0,
      recoverCooldown: 0, collisionCooldown: 0, gear: 1, rpm: 1000,
      throttle: 0, brake: 0, handbrake: false, events: [] });
  }
  start() { this.reset(); this.mode = 'countdown'; }
  pause() {
    if (this.mode === 'racing' || this.mode === 'countdown') {
      this.previousMode = this.mode; this.mode = 'paused';
    } else if (this.mode === 'paused') this.mode = this.previousMode;
  }
  recover() {
    if (this.mode !== 'racing' || this.recoverCooldown > 0) return false;
    const p = this.track.sample(Math.max(14, this.maxS - 4));
    this.x = p.x; this.z = p.z; this.y = p.y; this.s = p.s; this.validatedS = p.s;
    this.heading = p.heading; this.vx = this.vz = this.speed = this.steer = 0;
    this.surface = this.track.surfaceAt(p.s); this.offroad = false;
    this.lateral = this.lateralVelocity = this.slip = 0;
    this.penalty += 5; this.recoverCooldown = 1.5;
    this.events.push({ type: 'recover', text: 'POWRÓT NA TRASĘ · +5 SEKUND' });
    return true;
  }
  tick(dt, input = {}) {
    if (dt <= 0 || dt > 0.05 || !Number.isFinite(dt)) return;
    if (this.mode === 'countdown') {
      this.countdown -= dt;
      const count = Math.ceil(this.countdown);
      if (count !== this.lastCount) {
        this.lastCount = count;
        this.events.push({ type: count <= 0 ? 'go' : 'countdown', count });
      }
      if (this.countdown <= 0) this.mode = 'racing';
      return;
    }
    if (this.mode !== 'racing') return;
    this.elapsed += dt;
    this.recoverCooldown = Math.max(0, this.recoverCooldown - dt);
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    this.throttle = input.throttle ? 1 : 0;
    this.brake = input.brake ? 1 : 0;
    this.handbrake = !!input.handbrake;
    this.steer += ((input.steer || 0) - this.steer) * Math.min(1, dt * 6.5);
    const offroadSurface = this.track.offroadSurface || 'dirt';
    const data = SURFACES[this.offroad ? offroadSurface : this.surface];
    const forwardX = Math.sin(this.heading), forwardZ = Math.cos(this.heading);
    let forwardSpeed = this.vx * forwardX + this.vz * forwardZ;
    const magnitude = Math.hypot(this.vx, this.vz);
    let force = -Math.sign(forwardSpeed) * (0.35 + magnitude * magnitude * 0.0018);
    if (this.throttle) force += (forwardSpeed < -0.5 ? 18 : 15 * Math.max(0, 1 - forwardSpeed / 58)) * data.power;
    if (this.brake) force -= (forwardSpeed > 0.5 ? 22 : (forwardSpeed > -7 ? 4 : 0)) * data.braking;
    if (this.handbrake) force -= Math.sign(forwardSpeed) * 13 * data.braking;
    if (this.offroad) force -= forwardSpeed * (offroadSurface === 'snow' ? 1.3 : 0.9);
    const oldSpeed = forwardSpeed;
    forwardSpeed += force * dt;
    if (!this.throttle && !this.brake && oldSpeed * forwardSpeed < 0) forwardSpeed = 0;
    if (this.handbrake && oldSpeed * forwardSpeed < 0) forwardSpeed = 0;
    // Positive input means the driver's right. With +Z forward and +Y up,
    // that is a negative rotation around Y (world +X appears to the left).
    const yaw = -this.steer * forwardSpeed * 0.29 / (2.6 + Math.abs(forwardSpeed) * 0.11);
    this.heading = wrapAngle(this.heading + yaw * (this.handbrake ? 1.65 : 1) * dt);
    let lateralSpeed = this.vx * forwardZ - this.vz * forwardX;
    const grip = data.grip * (this.handbrake ? 0.24 : 1);
    lateralSpeed *= Math.exp(-grip * dt);
    // Rear end takes longer to follow the nose on loose surfaces.
    lateralSpeed -= yaw * magnitude * dt * (this.handbrake ? Math.max(1.6, data.drift * 1.8) : data.drift);
    const nx = Math.sin(this.heading), nz = Math.cos(this.heading);
    this.vx = nx * forwardSpeed + nz * lateralSpeed;
    this.vz = nz * forwardSpeed - nx * lateralSpeed;
    this.x += this.vx * dt; this.z += this.vz * dt;
    const near = this.track.nearest(this.x, this.z, this.nearestIndex);
    this.nearestIndex = near.index;
    this.s = near.s; this.lateral = near.lateral;
    this.y = near.point.y;
    this.offroad = Math.abs(near.lateral) > this.track.width / 2;
    this.surface = this.track.surfaceAt(this.s);
    this.speed = Math.hypot(this.vx, this.vz);
    this.lateralVelocity = lateralSpeed;
    this.slip = clamp(Math.abs(lateralSpeed) / 7 + (this.handbrake && this.speed > 3 ? 0.5 : 0), 0, 1);
    // Follow continuous route movement across the verge as well as the road.
    // Award progress only near the road, but do not strand a driver who rejoins
    // farther ahead. A large jump never moves this anchor, even on later ticks.
    if (near.distance <= 26 && this.s < this.validatedS + 18) {
      this.validatedS = this.s;
      if (near.distance < this.track.width * 0.8) this.maxS = Math.max(this.maxS, this.s);
    }
    const gates = [this.track.length / 3, this.track.length * 2 / 3];
    if (this.checkpoint < gates.length && this.maxS >= gates[this.checkpoint]) {
      this.checkpoint++;
      this.events.push({ type: 'checkpoint', text: `SEKTOR ${this.checkpoint} · ${formatTime(this.elapsed + this.penalty)}` });
    }
    if (this.collisionCooldown <= 0) {
      for (const obstacle of this.obstacles) {
        const dx = this.x - obstacle.x, dz = this.z - obstacle.z;
        const distance = Math.hypot(dx, dz), radius = obstacle.radius + 1;
        if (distance < radius) {
          const divisor = Math.max(distance, 0.01);
          this.x = obstacle.x + dx / divisor * (radius + 0.1);
          this.z = obstacle.z + dz / divisor * (radius + 0.1);
          this.vx *= -0.18; this.vz *= -0.18;
          this.collisionCooldown = 0.8;
          this.events.push({ type: 'collision', text: 'UWAŻAJ NA POBOCZE · R - POWRÓT NA TRASĘ' });
          break;
        }
      }
    }
    if (near.distance > 26) this.recover();
    const signed = this.vx * nx + this.vz * nz;
    this.gear = signed < -0.5 ? 'R' : Math.min(5, Math.floor(this.speed / 9.5) + 1);
    this.rpm = 1100 + (this.speed % 9.5) / 9.5 * 4800 + this.throttle * 600;
    if (this.checkpoint === 2 && this.maxS >= this.track.length - 8 && near.distance < this.track.width / 2 + 1) {
      this.mode = 'finished'; this.events.push({ type: 'finish' });
    }
  }
  get totalTime() { return this.elapsed + this.penalty; }
}
