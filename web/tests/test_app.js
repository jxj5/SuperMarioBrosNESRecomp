const fs = require('fs'); const path = require('path');
const OUT = process.env.OUT || '.'; const ROM = process.env.ROM; const ZIP = process.env.ZIP; const A = require('../app.js');
const assert = require('assert');
(async () => {
  // 1) palette(rot=0) must equal the core's own colors for every pixel of a real frame
  const idx = new Uint16Array(fs.readFileSync(path.join(OUT, 'idx600.bin')).buffer.slice(0));
  const rgba = new Uint32Array(fs.readFileSync(path.join(OUT, 'rgba600.bin')).buffer.slice(0));
  const pal = A.buildPalette(0);
  let bad = 0; for (let i = 0; i < 61440; i++) if (pal[idx[i] & 511] !== rgba[i]) bad++;
  console.log('palette rot0 vs core: mismatching pixels =', bad, 'of 61440');
  assert.strictEqual(bad, 0);
  // 2) crc32 of the real ROM and extraction from the user's zip
  const zipBuf = (ZIP ? fs.readFileSync(ZIP) : null);
  const rom = await A.normalizeRom(zipBuf || fs.readFileSync(ROM));
  const crc = A.crc32(rom);
  console.log('zip -> rom bytes =', rom.length, ' crc32 =', crc.toString(16), ' matches SMB World:', crc === A.SMB_WORLD_CRC32);
  assert.strictEqual(crc, A.SMB_WORLD_CRC32);
  const raw = fs.readFileSync(ROM);
  assert.deepStrictEqual(Buffer.from(rom), raw);
  assert.strictEqual((await A.normalizeRom(raw)).length, raw.length);
  await assert.rejects(A.normalizeRom(new Uint8Array(100)), /iNES/);
  // 3) input
  assert.strictEqual(A.cleanDpad(A.BTN.UP | A.BTN.DOWN | A.BTN.A), A.BTN.A);
  assert.strictEqual(A.cleanDpad(A.BTN.LEFT | A.BTN.RIGHT | A.BTN.UP), A.BTN.UP);
  assert.strictEqual(A.KEYMAP.Enter, 0x10); assert.strictEqual(A.KEYMAP.KeyZ, 0x80);
  // sky color with the classic palette
  const c = A.buildPalette(28)[0x22]; console.log('classic sky $22 = rgb(%d,%d,%d)', c & 255, (c >> 8) & 255, (c >> 16) & 255);
  console.log('ALL JS TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
