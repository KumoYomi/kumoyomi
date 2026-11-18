import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'public', 'icon');
const SIZES = [16, 32, 48, 128];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter None
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function roundedRectSignedDistance(nx, ny, halfW, halfH, radius) {
  const dx = Math.abs(nx) - (halfW - radius);
  const dy = Math.abs(ny) - (halfH - radius);
  const outDist = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inDist = Math.min(Math.max(dx, dy), 0);
  return outDist + inDist - radius;
}

function cloudDensity(u, v) {
  // Normalized coordinates [-1, 1] centered slightly above middle
  const cy = v + 0.04;
  const circles = [
    { x: -0.25, y: 0.08, r: 0.24 },
    { x: 0.0, y: -0.06, r: 0.30 },
    { x: 0.27, y: 0.09, r: 0.22 },
  ];
  let minDist = 1;
  for (const c of circles) {
    const d = Math.hypot(u - c.x, cy - c.y) - c.r;
    if (d < minDist) minDist = d;
  }
  // Flat base bar uniting the cloud lobes
  const baseDist = roundedRectSignedDistance(u, cy - 0.14, 0.44, 0.16, 0.12);
  minDist = Math.min(minDist, baseDist);
  return minDist;
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 2.0 / size;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = ((y + 0.5) / size) * 2 - 1;

      const bgDist = roundedRectSignedDistance(u, v, 0.92, 0.92, 0.36);
      const bgAlpha = Math.max(0, Math.min(1, 0.5 - bgDist / aa));

      // Diagonal crimson-to-violet dark badge gradient
      const t = (u + v + 2) / 4;
      let r = 18 + (38 - 18) * t;
      let g = 16 + (16 - 16) * t;
      let b = 26 + (34 - 26) * t;

      // Subtle glowing crimson border inside edge
      const ringDist = Math.abs(bgDist + 0.045);
      if (ringDist < 0.03) {
        const ringMix = (1 - ringDist / 0.03) * 0.55;
        r = r * (1 - ringMix) + 225 * ringMix;
        g = g * (1 - ringMix) + 29 * ringMix;
        b = b * (1 - ringMix) + 72 * ringMix;
      }

      // Inner crimson glow behind the cloud
      const glow = Math.max(0, 1 - Math.hypot(u, v) * 1.15);
      r += glow * 64;
      g += glow * 8;
      b += glow * 26;

      // Cloud glyph (white-warm tint with crimson accent crescent)
      const cDist = cloudDensity(u, v);
      const cloudAlpha = Math.max(0, Math.min(1, 0.5 - cDist / (aa * 1.1)));

      // Small crimson moon/book notch in cloud center
      const bookDist = roundedRectSignedDistance(u, v - 0.08, 0.11, 0.13, 0.03);
      const bookAlpha = Math.max(0, Math.min(1, 0.5 - bookDist / (aa * 1.1)));

      if (cloudAlpha > 0) {
        const cr = 248;
        const cg = 246;
        const cb = 252;
        r = r * (1 - cloudAlpha) + cr * cloudAlpha;
        g = g * (1 - cloudAlpha) + cg * cloudAlpha;
        b = b * (1 - cloudAlpha) + cb * cloudAlpha;
      }

      if (bookAlpha > 0 && cloudAlpha > 0.2) {
        r = r * (1 - bookAlpha) + 225 * bookAlpha;
        g = g * (1 - bookAlpha) + 29 * bookAlpha;
        b = b * (1 - bookAlpha) + 72 * bookAlpha;
      }

      const idx = (y * size + x) * 4;
      rgba[idx] = Math.max(0, Math.min(255, Math.round(r)));
      rgba[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      rgba[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      rgba[idx + 3] = Math.max(0, Math.min(255, Math.round(bgAlpha * 255)));
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const outPath = resolve(OUT_DIR, `${size}.png`);
  writeFileSync(outPath, renderIcon(size));
  console.log(`Generated ${outPath} (${size}x${size})`);
}
