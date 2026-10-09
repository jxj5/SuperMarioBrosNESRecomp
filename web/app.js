/*
 * app.js - browser front end for the NESRecomp cycle-accurate core (smb.wasm).
 *
 * The wasm module only emulates: JS owns the canvas, WebAudio, keyboard,
 * gamepad, touch controls and the requestAnimationFrame loop.
 * Pure helpers (palette, CRC32, zip reader, input mapping) are exported for
 * Node tests at the bottom of the file.
 */
'use strict';

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/* NES controller bits, MSB first: A B Select Start Up Down Left Right. */
const BTN = { A: 0x80, B: 0x40, SELECT: 0x20, START: 0x10, UP: 0x08, DOWN: 0x04, LEFT: 0x02, RIGHT: 0x01 };

const KEYMAP = {
  ArrowUp: BTN.UP, ArrowDown: BTN.DOWN, ArrowLeft: BTN.LEFT, ArrowRight: BTN.RIGHT,
  KeyW: BTN.UP, KeyS: BTN.DOWN, KeyA: BTN.LEFT, KeyD: BTN.RIGHT,
  KeyZ: BTN.A, KeyK: BTN.A,
  KeyX: BTN.B, KeyJ: BTN.B,
  Enter: BTN.START, ShiftRight: BTN.SELECT, ShiftLeft: BTN.SELECT, Backspace: BTN.SELECT,
};

/* Remove impossible combinations (a real D-pad cannot press opposite sides). */
function cleanDpad(b) {
  if ((b & BTN.UP) && (b & BTN.DOWN)) b &= ~(BTN.UP | BTN.DOWN);
  if ((b & BTN.LEFT) && (b & BTN.RIGHT)) b &= ~(BTN.LEFT | BTN.RIGHT);
  return b;
}

/* Same decode as runner/cyc/hw_palette.c (NTSC signal model), plus a hue
 * rotation (degrees). rotDeg = 0 reproduces the core's colors exactly. */
function buildPalette(rotDeg) {
  const low = [0.350, 0.518, 0.962, 1.550], high = [1.094, 1.506, 1.962, 1.962];
  const black = 0.518, white = 1.962, att = 0.746;
  const inPhase = (h, p) => (h + p) % 12 < 6;
  const byte = (c) => (c <= 0 ? 0 : c >= 1 ? 255 : Math.floor(c * 255 + 0.5));
  const rot = (rotDeg * Math.PI) / 180;
  const pal = new Uint32Array(512);
  for (let index = 0; index < 512; index++) {
    const hue = index & 15, emph = index >> 6;
    let level = (index >> 4) & 3;
    if (hue > 13) level = 1;
    let lo = low[level], hi = high[level];
    if (hue === 0) lo = hi;
    if (hue > 12) hi = lo;
    let y = 0, u = 0, v = 0;
    for (let p = 0; p < 12; p++) {
      let s = inPhase(hue, p) ? hi : lo;
      if (((emph & 1) && inPhase(0, p)) || ((emph & 2) && inPhase(4, p)) || ((emph & 4) && inPhase(8, p))) s *= att;
      s = (s - black) / (white - black);
      const a = (Math.PI * (p - 0.5)) / 6 + rot;
      y += s; u += s * Math.cos(a); v -= s * Math.sin(a);
    }
    y /= 12; u *= 2 / 12; v *= 2 / 12;
    const r = byte(y + 1.140 * v), g = byte(y - 0.395 * u - 0.581 * v), b = byte(y + 2.032 * u);
    pal[index] = (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0; /* bytes R,G,B,A in memory */
  }
  return pal;
}

let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* Minimal ZIP reader: returns the bytes of the first .nes entry (or the first
 * entry if none is named .nes). Supports stored and deflate entries. */
async function extractFromZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP inválido (no se encontró el directorio central)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP corrupto');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
    entries.push({ name, method, csize, lho });
    p += 46 + nlen + elen + clen;
  }
  const pick = entries.find((e) => /\.nes$/i.test(e.name)) || entries.find((e) => !e.name.endsWith('/'));
  if (!pick) throw new Error('El ZIP está vacío');
  const lh = pick.lho;
  const dataStart = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
  const raw = u8.subarray(dataStart, dataStart + pick.csize);
  if (pick.method === 0) return new Uint8Array(raw);
  if (pick.method === 8) {
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error('Método de compresión ZIP no soportado: ' + pick.method);
}

/* Accepts a raw .nes or a .zip; returns Uint8Array of the iNES image. */
async function normalizeRom(buf) {
  let u8 = new Uint8Array(buf);
  if (u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4B) u8 = await extractFromZip(u8);
  if (u8.length < 16 || u8[0] !== 0x4E || u8[1] !== 0x45 || u8[2] !== 0x53 || u8[3] !== 0x1A) {
    throw new Error('El archivo no es una ROM iNES (.nes) válida');
  }
  return u8;
}

const SMB_WORLD_CRC32 = 0x3337EC46; /* Super Mario Bros. (World), whole file */

/* ------------------------------------------------------------------ */
/* AudioWorklet (inline module)                                        */
/* ------------------------------------------------------------------ */

const WORKLET_SRC = `
class SmbPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.max(8192, Math.ceil(sampleRate * 0.5));
    this.ring = new Float32Array(this.size);
    this.r = 0; this.w = 0; this.fill = 0; this.last = 0;
    this.max = Math.ceil(sampleRate * 0.12);   // above this much queued audio we drop the oldest
    this.keep = Math.ceil(sampleRate * 0.06);
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d === 'clear') { this.r = this.w = this.fill = 0; return; }
      for (let i = 0; i < d.length; i++) {
        this.ring[this.w] = d[i];
        this.w = (this.w + 1) % this.size;
      }
      this.fill = Math.min(this.size, this.fill + d.length);
      if (this.fill > this.max) {                 // keep latency bounded
        const drop = this.fill - this.keep;
        this.r = (this.r + drop) % this.size;
        this.fill = this.keep;
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const ch0 = out[0];
    for (let i = 0; i < ch0.length; i++) {
      if (this.fill > 0) {
        this.last = this.ring[this.r];
        this.r = (this.r + 1) % this.size;
        this.fill--;
      } else {
        this.last *= 0.995;                        // underrun: fade instead of clicking
      }
      ch0[i] = this.last;
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    return true;
  }
}
registerProcessor('smb-player', SmbPlayer);
`;

/* ------------------------------------------------------------------ */
/* Browser app                                                         */
/* ------------------------------------------------------------------ */

function startApp() {
  const $ = (id) => document.getElementById(id);
  const canvas = $('screen'), ctx = canvas.getContext('2d', { alpha: false });
  const img = new ImageData(256, 240);
  const img32 = new Uint32Array(img.data.buffer);
  const statusEl = $('status');
  const setStatus = (t, cls) => { statusEl.textContent = t; statusEl.className = cls || ''; };

  let M = null;               // emscripten module
  let running = false, started = false, paused = false;
  let romBytes = null;
  let palette = buildPalette(28);
  let frameMs = 1000 / 60.0988;
  let audio = null;           // { ctx, node, gain, rate, resamplePos, lastSample }
  let muted = false, volume = 0.7;

  /* ---- wasm helpers ---- */
  const heapBuffer = () => (M.HEAPU8 ? M.HEAPU8.buffer : M.wasmMemory.buffer);

  async function loadWasm() {
    setStatus('Cargando emulador…');
    M = await createSmb();
    frameMs = M._smb_frame_seconds() * 1000 || frameMs;
  }

  function bootRom(bytes) {
    const ptr = M._malloc(bytes.length);
    new Uint8Array(heapBuffer(), ptr, bytes.length).set(bytes);
    const ok = M._smb_init(ptr, bytes.length);
    M._free(ptr);
    return !!ok;
  }

  /* ---- input ---- */
  let kbBits = 0, padBits = 0, touchBits = 0;
  const touches = new Map(); // pointerId -> bit

  window.addEventListener('keydown', (e) => {
    const bit = KEYMAP[e.code];
    if (bit === undefined) {
      if (e.code === 'KeyP' && started) togglePause();
      if (e.code === 'KeyM') toggleMute();
      return;
    }
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    kbBits |= bit; e.preventDefault(); wakeAudio();
  });
  window.addEventListener('keyup', (e) => {
    const bit = KEYMAP[e.code];
    if (bit !== undefined) { kbBits &= ~bit; e.preventDefault(); }
  });
  window.addEventListener('blur', () => { kbBits = 0; touches.clear(); touchBits = 0; });

  function pollGamepad() {
    let b = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const pr = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      if (pr(0) || pr(3)) b |= BTN.A;       // bottom / top face button
      if (pr(2) || pr(1)) b |= BTN.B;       // left / right face button
      if (pr(8)) b |= BTN.SELECT;
      if (pr(9)) b |= BTN.START;
      if (pr(12)) b |= BTN.UP;
      if (pr(13)) b |= BTN.DOWN;
      if (pr(14)) b |= BTN.LEFT;
      if (pr(15)) b |= BTN.RIGHT;
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (ax < -0.5) b |= BTN.LEFT; else if (ax > 0.5) b |= BTN.RIGHT;
      if (ay < -0.5) b |= BTN.UP; else if (ay > 0.5) b |= BTN.DOWN;
      break; // first connected pad only
    }
    padBits = b;
  }

  /* touch buttons: <button data-btn="A"> etc. */
  document.querySelectorAll('[data-btn]').forEach((el) => {
    const bit = BTN[el.dataset.btn];
    const down = (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); touches.set(e.pointerId, bit); el.classList.add('on'); wakeAudio(); recalcTouch(); };
    const up = (e) => { touches.delete(e.pointerId); el.classList.remove('on'); recalcTouch(); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  });
  function recalcTouch() { let b = 0; for (const v of touches.values()) b |= v; touchBits = b; }

  /* ---- audio ---- */
  async function wakeAudio() {
    if (audio) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      let actx;
      try { actx = new AC({ sampleRate: 48000, latencyHint: 'interactive' }); } catch (_) { actx = new AC({ latencyHint: 'interactive' }); }
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }));
      await actx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(actx, 'smb-player', { numberOfInputs: 0, outputChannelCount: [2] });
      const gain = actx.createGain();
      gain.gain.value = muted ? 0 : volume;
      node.connect(gain).connect(actx.destination);
      audio = { ctx: actx, node, gain, rate: actx.sampleRate, pos: 0, prev: 0 };
      if (actx.state === 'suspended') await actx.resume();
    } catch (err) {
      console.warn('Audio no disponible:', err);
      audio = null;
    }
  }

  function pushAudio(n) {
    if (!audio || n <= 0) return;
    const src = new Int16Array(heapBuffer(), M._smb_audio(), n);
    const inRate = M._smb_audio_rate();
    let out;
    if (audio.rate === inRate) {
      out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = src[i] / 32768;
    } else { // linear resampler for contexts that refused 48 kHz
      const step = inRate / audio.rate;
      const res = [];
      let pos = audio.pos;
      while (pos < n) {
        const i = Math.floor(pos), f = pos - i;
        const a = i === 0 ? audio.prev : src[i - 1], b = src[i];
        res.push(((a + (b - a) * f)) / 32768);
        pos += step;
      }
      audio.pos = pos - n;
      audio.prev = src[n - 1];
      out = Float32Array.from(res);
    }
    audio.node.port.postMessage(out, [out.buffer]);
  }

  function toggleMute() {
    muted = !muted;
    if (audio) audio.gain.gain.value = muted ? 0 : volume;
    $('mute').textContent = muted ? '🔇 Silenciado' : '🔊 Sonido';
  }

  /* ---- main loop ---- */
  let last = 0, acc = 0, frames = 0, fpsT = 0, fps = 0;
  function runOne() {
    M._smb_set_input(0, cleanDpad(kbBits | padBits | touchBits));
    pushAudio(M._smb_frame());
  }
  function draw() {
    const idx = new Uint16Array(heapBuffer(), M._smb_video_index(), 256 * 240);
    for (let i = 0; i < 61440; i++) img32[i] = palette[idx[i] & 511];
    ctx.putImageData(img, 0, 0);
  }
  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    if (paused) { last = now; return; }
    pollGamepad();
    acc += Math.min(now - last, 100);
    last = now;
    let n = 0;
    while (acc >= frameMs && n < 4) { runOne(); acc -= frameMs; n++; }
    if (acc > frameMs * 4) acc = 0;   // way behind: don't try to catch up forever
    if (n) {
      draw();
      frames += n;
      if (now - fpsT > 1000) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; $('fps').textContent = fps + ' fps'; }
    }
  }

  function togglePause() {
    paused = !paused;
    $('pause').textContent = paused ? '▶ Continuar' : '⏸ Pausa';
    if (audio) { if (paused) { audio.node.port.postMessage('clear'); audio.ctx.suspend(); } else audio.ctx.resume(); }
  }

  function begin() {
    $('overlay').hidden = true;
    started = true; paused = false;
    last = performance.now(); acc = 0; fpsT = last; frames = 0;
    if (!running) { running = true; requestAnimationFrame(tick); }
    wakeAudio();
  }

  /* ---- ROM loading ---- */
  async function loadRomBuffer(buf, remember) {
    try {
      const rom = await normalizeRom(buf);
      const crc = crc32(rom);
      if (!bootRom(rom)) throw new Error('El emulador no pudo cargar esa ROM (mapper no soportado?)');
      romBytes = rom;
      $('reset').disabled = false;
      if (crc === SMB_WORLD_CRC32) setStatus('ROM verificada: Super Mario Bros. (World) ✔', 'ok');
      else setStatus('ROM cargada, pero no es Super Mario Bros. (World) — CRC32 ' + crc.toString(16).padStart(8, '0') + '. Pruebo igual.', 'warn');
      if (remember) saveRom(rom);
      begin();
    } catch (err) {
      setStatus(err.message, 'err');
    }
  }

  /* remember the ROM in this browser only (IndexedDB), never uploaded */
  function idb() {
    return new Promise((resolve, reject) => {
      const rq = indexedDB.open('smbweb', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('rom');
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  async function saveRom(rom) {
    try {
      const db = await idb();
      db.transaction('rom', 'readwrite').objectStore('rom').put(rom.slice().buffer, 'last');
    } catch (_) { /* private mode etc. */ }
  }
  async function loadSavedRom() {
    try {
      const db = await idb();
      return await new Promise((res) => {
        const rq = db.transaction('rom').objectStore('rom').get('last');
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => res(null);
      });
    } catch (_) { return null; }
  }
  async function forgetRom() {
    try { const db = await idb(); db.transaction('rom', 'readwrite').objectStore('rom').delete('last'); } catch (_) {}
    setStatus('ROM olvidada de este navegador.');
  }

  $('romfile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) await loadRomBuffer(await f.arrayBuffer(), $('remember').checked);
    e.target.value = '';
  });
  ['dragover', 'drop'].forEach((t) => window.addEventListener(t, async (e) => {
    e.preventDefault();
    if (t === 'drop' && e.dataTransfer.files[0]) await loadRomBuffer(await e.dataTransfer.files[0].arrayBuffer(), $('remember').checked);
  }));

  /* ---- buttons ---- */
  $('reset').addEventListener('click', () => { if (started) { M._smb_reset(); if (audio) audio.node.port.postMessage('clear'); } });
  $('pause').addEventListener('click', () => { if (started) togglePause(); });
  $('mute').addEventListener('click', toggleMute);
  $('forget').addEventListener('click', forgetRom);
  $('vol').addEventListener('input', (e) => { volume = e.target.value / 100; if (audio && !muted) audio.gain.gain.value = volume; });
  $('fs').addEventListener('click', () => {
    const el = $('stage');
    if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen();
  });
  $('aspect').addEventListener('change', (e) => { $('stage').dataset.aspect = e.target.value; });
  $('palette').addEventListener('change', (e) => { palette = buildPalette(Number(e.target.value)); if (started) draw(); });
  $('go').addEventListener('click', begin);

  /* ---- start ---- */
  (async () => {
    try {
      await loadWasm();
    } catch (err) {
      setStatus('No se pudo cargar smb.wasm: ' + err.message + ' (¿abriste la página con un servidor HTTP?)', 'err');
      return;
    }
    setStatus('Listo. Arrastrá tu ROM (.nes o .zip) a la página o elegí un archivo.');
    $('romfile').disabled = false;
    const saved = await loadSavedRom();
    if (saved) {
      const rom = await normalizeRom(saved).catch(() => null);
      if (rom && bootRom(rom)) {
        romBytes = rom; $('reset').disabled = false;
        setStatus('ROM recordada en este navegador. Tocá “Jugar” para empezar.', 'ok');
        $('overlay').hidden = false; draw();
      }
    }
  })();
}

if (typeof document !== 'undefined') window.addEventListener('DOMContentLoaded', startApp);
if (typeof module !== 'undefined') module.exports = { BTN, KEYMAP, cleanDpad, buildPalette, crc32, extractFromZip, normalizeRom, SMB_WORLD_CRC32 };
