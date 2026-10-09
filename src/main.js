import * as THREE from 'three';
import './style.css';
import { tracks, getTrack } from './track.js';
import { createWorld } from './world.js';
import { RallyAudio } from './audio.js';
import { RallySimulation, SURFACES, formatTime } from './physics.js';

const $ = id => document.getElementById(id);
const canvas = $('game-canvas');
const viewport = canvas.parentElement;
let track = tracks[0];
try { track = getTrack(localStorage.getItem('pocket-rally-selected-stage')); } catch { /* Optional preference. */ }
const sim = new RallySimulation(track);
const audio = new RallyAudio();
try { audio.setMusicEnabled(localStorage.getItem('pocket-rally-music') !== 'off'); } catch { /* Optional preference. */ }
const keys = new Set();
const recordKey = () => `pocket-rally-04-${track.id}-v1`;
let best = Infinity, cameraMode = 0, toastUntil = 0, countdownUntil = 0;
function loadBest() {
  best = Infinity;
  try { const stored = Number(localStorage.getItem(recordKey())); if (stored > 0 && Number.isFinite(stored)) best = stored; } catch { /* Private browsing can block storage. */ }
}
loadBest();
const scene = new THREE.Scene();
scene.background = new THREE.Color('#dee1bb');
scene.fog = new THREE.Fog('#d9dfbc', 110, 620);
const hemisphere = new THREE.HemisphereLight('#fff4d1', '#687b58', 2.6);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight('#fff0ca', 2.4);
sun.position.set(-120, 180, -50); scene.add(sun);
const camera = new THREE.PerspectiveCamera(57, 1, 0.15, 1600);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
} catch {
  $('start-button').disabled = true;
  $('start-button').textContent = 'WEBGL 2 NIEDOSTĘPNY';
  const notice = document.createElement('p'); notice.textContent = 'Włącz akcelerację sprzętową i otwórz grę w aktualnej przeglądarce.';
  $('menu-overlay').append(notice);
  throw new Error('WebGL 2 is required to run Pocket Rally.');
}
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
let world = createWorld(scene, track);
sim.obstacles = world.obstacles || [];
const cameraPosition = new THREE.Vector3(), cameraLook = new THREE.Vector3();
let cameraReady = false;
function resize() {
  const { width, height } = viewport.getBoundingClientRect();
  // A deliberately low-resolution framebuffer: all pixels, no image assets.
  const scale = Math.min(0.8, 1100 / Math.max(1, width));
  renderer.setSize(Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale)), false);
  camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();

function showToast(message, duration = 2800) {
  $('toast').textContent = message; $('toast').classList.remove('hidden');
  toastUntil = performance.now() + duration;
}
function updateMode() {
  document.body.dataset.mode = sim.mode;
  $('menu-overlay').classList.toggle('hidden', sim.mode !== 'menu');
  $('result-overlay').classList.toggle('hidden', sim.mode !== 'paused' && sim.mode !== 'finished');
  $('pause-button').disabled = !['racing', 'countdown', 'paused'].includes(sim.mode);
  if ($('stage-status')) $('stage-status').textContent = { menu: 'PRZED STARTEM', countdown: 'GOTOWOŚĆ', racing: 'NA ODCINKU', paused: 'PAUZA', finished: 'META' }[sim.mode];
  if (sim.mode === 'paused') {
    $('result-title').textContent = 'CHWILA W BOKSIE.';
    $('result-subtitle').textContent = `PAUZA / ${track.code}`;
    $('result-time').textContent = formatTime(sim.totalTime);
    $('result-detail').textContent = 'Stoper zatrzymany. Przełęcz poczeka.';
    $('resume-button').classList.remove('hidden'); $('resume-button').textContent = 'WRACAM NA TRASĘ';
    $('restart-button').textContent = 'OD NOWA';
    $('resume-button').focus({ preventScroll: true });
  }
  if (sim.mode === 'finished') {
    const record = sim.totalTime < best;
    if (record) { best = sim.totalTime; try { localStorage.setItem(recordKey(), String(best)); } catch { /* Optional persistence. */ } }
    $('result-title').textContent = record ? 'NOWY REKORD!' : 'JEST META!';
    $('result-subtitle').textContent = `${track.code} / ODCINEK UKOŃCZONY`;
    $('result-time').textContent = formatTime(sim.totalTime);
    $('result-detail').textContent = `${track.name} · ${(track.length / 1000).toFixed(2).replace('.', ',')} km · kary: +${sim.penalty} s`;
    $('resume-button').classList.add('hidden'); $('restart-button').textContent = 'JESZCZE JEDEN PRZEJAZD';
    $('restart-button').focus({ preventScroll: true });
  }
}
function start() {
  keys.clear(); audio.start().catch(() => showToast('Dźwięk niedostępny w tej przeglądarce'));
  sim.start(); world.clearTrails(); cameraReady = false;
  countdownUntil = 0; toastUntil = 0;
  updateMode(); document.activeElement?.blur();
}
function pause() {
  keys.clear(); sim.pause(); updateMode();
  if (sim.mode === 'racing' || sim.mode === 'countdown') audio.start().catch(() => {});
}
function toggleSound() {
  audio.setMuted(!audio.muted);
  const button = $('sound-button'); button.setAttribute('aria-pressed', String(audio.muted));
  button.setAttribute('aria-label', audio.muted ? 'Włącz dźwięk' : 'Wycisz dźwięk');
  button.classList.toggle('is-muted', audio.muted);
  const label = button.querySelector('[data-sound-label]'); if (label) label.textContent = audio.muted ? 'DŹWIĘK OFF' : 'DŹWIĘK ON';
  if (!audio.muted) audio.start().catch(() => {});
  showToast(audio.muted ? 'DŹWIĘK WYŁĄCZONY' : 'DŹWIĘK WŁĄCZONY', 1600);
}
function updateMusicButton() {
  $('music-button').setAttribute('aria-pressed', String(audio.musicEnabled));
  $('music-button').setAttribute('aria-label', audio.musicEnabled ? 'Wyłącz muzykę 8-bit' : 'Włącz muzykę 8-bit');
}
function toggleMusic() {
  audio.setMusicEnabled(!audio.musicEnabled);
  if (audio.musicEnabled) audio.start().catch(() => {});
  try { localStorage.setItem('pocket-rally-music', audio.musicEnabled ? 'on' : 'off'); } catch { /* Optional preference. */ }
  updateMusicButton();
  showToast(audio.musicEnabled ? 'MUZYKA 8-BIT · WŁĄCZONA' : 'MUZYKA 8-BIT · WYŁĄCZONA', 1500);
}
function backToMenu() {
  keys.clear(); sim.reset(); world.clearTrails(); cameraReady = false;
  countdownUntil = 0; toastUntil = 0;
  updateMode(); updateHUD();
  document.querySelector(`[data-stage-id="${track.id}"]`).focus({ preventScroll: true });
}
function updateStagePresentation() {
  const winter = track.theme === 'winter';
  document.body.dataset.theme = track.theme;
  document.title = `Pocket Rally - ${track.name}`;
  document.querySelectorAll('[data-stage-code]').forEach(el => { el.textContent = track.code; });
  document.querySelectorAll('[data-stage-name]').forEach(el => { el.textContent = track.name.toUpperCase(); });
  document.querySelectorAll('[data-stage-id]').forEach(el => { el.setAttribute('aria-pressed', String(el.dataset.stageId === track.id)); });
  const titleFirst = document.createElement('span'); titleFirst.textContent = track.titleLines[0];
  const titlePeriod = document.createElement('span'); titlePeriod.className = 'title-period'; titlePeriod.textContent = '.';
  $('stage-title').replaceChildren(titleFirst, document.createTextNode(track.titleLines[1]), titlePeriod);
  $('stage-description').textContent = track.description;
  $('menu-length').textContent = `${(track.length/1000).toFixed(2).replace('.',',')} KM`;
  const stageIndex = String(tracks.indexOf(track) + 1).padStart(2,'0');
  $('menu-stage-index').textContent = stageIndex;
  $('map-stage-index').textContent = `${stageIndex} / 02`;
  $('surface-icon').textContent = stageIndex;
  $('menu-surfaces').textContent = winter ? 'ŚNIEG / LÓD / ASFALT' : 'ASFALT / SZUTER / ZIEMIA';
  $('stage-weather').textContent = winter ? 'OPAD ŚNIEGU / −9°C' : 'SUCHO / +14°C';
  $('stage-season').textContent = winter ? 'PÓŁNOC / ZIMA' : 'POŁUDNIE / JESIEŃ';
  $('stage-hint').textContent = winter ? 'Na lodzie hamuj wcześniej. Kontruj delikatnie.' : 'Na szutrze pracuj gazem i kontrą.';
  scene.background.set(winter ? '#c2d6e2' : '#dee1bb');
  scene.fog.color.set(winter ? '#c7d8e3' : '#d9dfbc');
  scene.fog.far = winter ? 470 : 620;
  hemisphere.color.set(winter ? '#e7f2ff' : '#fff4d1');
  hemisphere.groundColor.set(winter ? '#7b95b0' : '#687b58');
  hemisphere.intensity = winter ? 2.0 : 2.6;
  sun.color.set(winter ? '#daeaff' : '#fff0ca'); sun.intensity = winter ? 1.55 : 2.4;
}
function selectStage(id) {
  if (sim.mode !== 'menu') return;
  const next = getTrack(id);
  if (next === track) return;
  keys.clear(); world.dispose();
  track = next; sim.track = track; sim.reset();
  world = createWorld(scene, track); sim.obstacles = world.obstacles || [];
  cameraReady = false; lastPaceKey = ''; countdownUntil = 0; toastUntil = 0;
  loadBest(); updateMapBounds(); updateStagePresentation(); updateMode(); updateHUD();
  try { localStorage.setItem('pocket-rally-selected-stage', track.id); } catch { /* Optional preference. */ }
  audio.start().catch(() => {});
}
document.querySelectorAll('[data-stage-id]').forEach(button => button.addEventListener('click', () => selectStage(button.dataset.stageId)));
$('start-button').addEventListener('click', start);
$('restart-button').addEventListener('click', start);
$('resume-button').addEventListener('click', pause);
$('pause-button').addEventListener('click', pause);
$('sound-button').addEventListener('click', toggleSound);
$('music-button').addEventListener('click', toggleMusic);
$('menu-button').addEventListener('click', backToMenu);
$('fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await viewport.requestFullscreen();
  } catch { showToast('Ta przeglądarka nie udostępnia pełnego ekranu.'); }
});
const gameKeys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Space','Enter','Escape','KeyR','KeyC','KeyM','KeyN'];
window.addEventListener('keydown', event => {
  if (!gameKeys.includes(event.code)) return;
  // Keep native link activation available to keyboard users.
  if (event.code === 'Enter' && event.target.closest?.('a[href]')) return;
  // Preserve regular keyboard activation of focused buttons outside a race.
  if (['Enter','Space'].includes(event.code) && document.activeElement?.tagName === 'BUTTON' && ['menu','paused','finished'].includes(sim.mode)) return;
  event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'Enter') {
    if (sim.mode === 'menu' || sim.mode === 'finished') start();
    else if (sim.mode === 'paused') pause();
  }
  if (event.code === 'Escape') pause();
  if (event.code === 'KeyR') sim.recover();
  if (event.code === 'KeyM') toggleSound();
  if (event.code === 'KeyN') toggleMusic();
  if (event.code === 'KeyC') { cameraMode = 1 - cameraMode; showToast(cameraMode ? 'KAMERA · WYSOKA' : 'KAMERA · POŚCIGOWA', 1400); }
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); if (['racing','countdown'].includes(sim.mode)) pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && ['racing','countdown'].includes(sim.mode)) pause(); });

const mapCanvas = $('minimap'), map = mapCanvas.getContext('2d');
let bounds, mapScale;
function updateMapBounds() {
  bounds = track.samples.reduce((b,p) => ({ minX:Math.min(b.minX,p.x),maxX:Math.max(b.maxX,p.x),minZ:Math.min(b.minZ,p.z),maxZ:Math.max(b.maxZ,p.z) }),{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity});
  mapScale = Math.min((mapCanvas.width-36)/(bounds.maxX-bounds.minX),(mapCanvas.height-30)/(bounds.maxZ-bounds.minZ));
}
updateMapBounds();
// Looking toward +Z, the driver's right lies toward -X.
const mapPoint = p => [mapCanvas.width/2-(p.x-(bounds.minX+bounds.maxX)/2)*mapScale,mapCanvas.height-15-(p.z-bounds.minZ)*mapScale];
function drawMap() {
  map.clearRect(0,0,mapCanvas.width,mapCanvas.height);
  map.lineCap='round'; map.lineJoin='round';
  const line=(limit,color,width) => {
    map.beginPath(); map.lineWidth=width; map.strokeStyle=color;
    for(let i=0;i<track.samples.length;i++){ const p=track.samples[i]; if(p.s>limit)break; const [x,y]=mapPoint(p); if(i===0)map.moveTo(x,y);else map.lineTo(x,y); }
    map.stroke();
  };
  line(track.length,'#252f2e',8); line(track.length,'#afb3a0',3); line(sim.maxS,'#ff8149',3);
  const end=mapPoint(track.sample(track.length)); map.fillStyle='#eeeacb';map.fillRect(end[0]-3,end[1]-3,6,6);
  const p=mapPoint(sim); map.beginPath();map.arc(p[0],p[1],4.5,0,Math.PI*2);map.fillStyle='#ff7840';map.fill();map.strokeStyle='#fff7d9';map.lineWidth=2;map.stroke();
}
const pacenoteShape = (direction,severity) => {
  if(direction==='straight')return '<path d="M24 40V8m-11 11L24 8l11 11"/>';
  const path=severity<=2?'M13 40V20Q13 9 24 9H34V24m0-15L24 19':severity<=4?'M13 40V27Q13 16 25 16H37m-10-10 10 10-10 10':'M14 40V31L34 11m-14 0h14v14';
  return `<g ${direction==='left'?'transform="translate(48 0) scale(-1 1)"':''}><path d="${path}"/></g>`;
};
let lastPaceKey='';
function updateHUD() {
  $('timer').textContent = formatTime(sim.totalTime);
  $('best-time').textContent = Number.isFinite(best) ? formatTime(best) : '- - : - -';
  $('speed').textContent = String(Math.round(sim.speed*3.6)).padStart(3,'0');
  $('gear').textContent = sim.speed<0.4 ? 'N' : String(sim.gear);
  $('rpm-fill').style.width = `${Math.min(100,sim.rpm/7000*100)}%`;
  $('surface-name').textContent = sim.offroad ? 'POBOCZE' : SURFACES[sim.surface].name;
  $('surface-detail').textContent = sim.offroad ? 'WRÓĆ NA TRASĘ · R' : SURFACES[sim.surface].detail;
  const gripBars = sim.offroad ? 1 : { asphalt: 5, gravel: 3, dirt: 3, snow: 2, ice: 1 }[sim.surface];
  document.querySelectorAll('.grip-bars i').forEach((bar,i) => { bar.style.opacity = i < gripBars ? '1' : '0.18'; bar.style.background = '#a9b59b'; });
  $('sector-label').textContent = `SEKTOR ${Math.min(3,sim.checkpoint+1)} / 3`;
  $('stage-distance').textContent = `${(Math.max(0,track.length-sim.maxS)/1000).toFixed(2).replace('.',',')} KM DO METY`;
  const progress=Math.min(100,sim.maxS/track.length*100);
  $('progress-fill').style.width=`${progress}%`; $('progress-text').textContent=`${Math.round(progress)}%`;
  if($('penalty-value'))$('penalty-value').textContent=sim.penalty?`KARA +${sim.penalty} s`:'';
  const note=track.pacenotes.find(n=>n.s>sim.s-12);
  const isFinish=track.length-sim.s<130;
  const visibleNote=note&&note.s-sim.s<180&&!isFinish?note:null;
  const direction=visibleNote?.direction||'straight',severity=visibleNote?.severity||6;
  const paceKey=`${direction}-${severity}-${isFinish}`;
  if(lastPaceKey!==paceKey){
    lastPaceKey=paceKey;
    $('pace-arrow').innerHTML=`<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${pacenoteShape(direction,severity)}</svg>`;
  }
  $('pace-label').textContent=isFinish?'META':visibleNote?`${direction==='left'?'LEWY':'PRAWY'} ${severity}`:'PROSTA';
  $('pace-distance').textContent=isFinish?`${Math.max(0,Math.round(track.length-sim.s))} M`:visibleNote?`${Math.max(0,Math.round((note.s-sim.s)/10)*10)} M`:'GAZ DO DECHY';
  drawMap();
}
updateStagePresentation(); updateMusicButton(); updateMode(); updateHUD();

const desiredPosition=new THREE.Vector3(),desiredLook=new THREE.Vector3();
function renderWorld(dt,time) {
  const p=track.sample(sim.s),ahead=track.sample(Math.min(track.length,sim.s+12));
  world.car.position.set(sim.x,sim.y+0.06,sim.z);
  world.car.rotation.set(-Math.atan2(ahead.y-p.y,12),sim.heading,-sim.steer*Math.min(sim.speed/40,1)*0.035,'YXZ');
  world.update(dt,sim);
  const nx=Math.sin(sim.heading),nz=Math.cos(sim.heading);
  if(sim.mode==='menu') {
    const phase=Math.sin(time*0.00012)*1.8;
    desiredPosition.set(sim.x+10+phase,sim.y+6.2,sim.z-13);
    desiredLook.set(sim.x-3,sim.y+1.5,sim.z+10);
  } else {
    const back=cameraMode?15:9.2+sim.speed*0.065,high=cameraMode?10:4.8+sim.speed*0.022;
    desiredPosition.set(sim.x-nx*back,sim.y+high,sim.z-nz*back);
    desiredLook.set(sim.x+nx*12,sim.y+1.7,sim.z+nz*12);
  }
  if(!cameraReady){cameraPosition.copy(desiredPosition);cameraLook.copy(desiredLook);cameraReady=true;}
  const smoothing=1-Math.exp(-dt*6);
  cameraPosition.lerp(desiredPosition,smoothing);cameraLook.lerp(desiredLook,smoothing);
  camera.position.copy(cameraPosition);camera.lookAt(cameraLook);
  camera.fov=57+Math.min(5,sim.speed/10);camera.updateProjectionMatrix();
  renderer.render(scene,camera);
}
let lastTime=performance.now(),accumulator=0,lastHUD=0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt=Math.min((now-lastTime)/1000,0.1);lastTime=now;
  accumulator+=dt;
  const input={throttle:keys.has('ArrowUp')||keys.has('KeyW'),brake:keys.has('ArrowDown')||keys.has('KeyS'),steer:(keys.has('ArrowRight')||keys.has('KeyD')?1:0)-(keys.has('ArrowLeft')||keys.has('KeyA')?1:0),handbrake:keys.has('Space')};
  const before=sim.mode;
  while(accumulator>=1/60){sim.tick(1/60,input);accumulator-=1/60;}
  for(const event of sim.events.splice(0)){
    if(event.type==='countdown'||event.type==='go'){
      $('countdown').classList.remove('hidden');$('countdown').textContent=event.type==='go'?'GAZ!':String(event.count); countdownUntil=now+850; audio.beep(event.type);
    }else if(event.type==='finish'){audio.beep('finish');}
    else {if(event.text)showToast(event.text);audio.beep(event.type==='collision'?'recover':event.type);}
  }
  if(before!==sim.mode)updateMode();
  if(now>countdownUntil)$('countdown').classList.add('hidden');
  if(now>toastUntil)$('toast').classList.add('hidden');
  audio.update({speed:sim.speed,throttle:sim.throttle,brake:sim.brake,slip:sim.slip,surface:sim.offroad?track.offroadSurface:sim.surface,running:sim.mode==='racing'||sim.mode==='countdown',gear:sim.gear,rpm:sim.rpm,mode:sim.mode,theme:track.theme},dt);
  renderWorld(dt,now);
  if(now-lastHUD>40){updateHUD();lastHUD=now;}
}
requestAnimationFrame(frame);
// Read-only diagnostics support repeatable browser verification without cheat controls.
window.__rally = Object.freeze({snapshot:()=>({mode:sim.mode,stage:track.id,x:sim.x,z:sim.z,s:sim.s,speed:sim.speed,time:sim.totalTime,penalty:sim.penalty,surface:sim.surface,steer:sim.steer,slip:sim.slip,checkpoint:sim.checkpoint,length:track.length,muted:audio.muted,musicEnabled:audio.musicEnabled,skidmarks:world.skidmarkCount,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,cameraMode})});
