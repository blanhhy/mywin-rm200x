// PNG 导出器：将 canvas 导出为 8 位索引色 PNG（bitDepth=8, colorType=3）
// 确保兼容 RPG Maker 2000/2003 的 PNG 导入要求
// 透明色替换：将 alpha=0 的像素替换为指定的透明色（palette[0]）

import { parseColor, recommendTransparentColor } from './colorUtils';

export interface ExportOptions {
  /** 透明色（CSS 字符串，如 "#003300"）；alpha=0 的像素会被替换为此色 */
  transparentColor: string;
}

// ── CRC32 ──────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ── zlib 压缩（使用浏览器内置 CompressionStream） ──────
async function zlibCompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  // 复制到新 ArrayBuffer 以确保类型兼容
  const buf = new Uint8Array(data.length);
  buf.set(data);
  writer.write(buf);
  writer.close();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// ── PNG chunk 编码 ─────────────────────────────────────
function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crcData = new Uint8Array(4 + data.length);
  crcData.set(typeBytes, 0);
  crcData.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcData));
  return chunk;
}

// ── 颜色量化（简单最近邻） ─────────────────────────────
function quantizeToPalette(
  rgba: Uint8ClampedArray,
  transparentRGB: [number, number, number],
): { palette: Uint8Array; indices: Uint8Array } {
  const n = rgba.length / 4;

  // 收集唯一颜色（RGB，忽略 alpha — 透明色已替换为 transparentColor）
  const colorMap = new Map<number, number>();
  const palette: number[] = [];

  // palette[0] = 透明色
  const tKey = (transparentRGB[0] << 16) | (transparentRGB[1] << 8) | transparentRGB[2];
  palette.push(tKey);
  colorMap.set(tKey, 0);

  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    if (!colorMap.has(key)) {
      if (palette.length >= 256) {
        // 超过 256 色：停止收集，后续用最近邻映射
        break;
      }
      colorMap.set(key, palette.length);
      palette.push(key);
    }
  }

  // 如果颜色 <= 256，直接映射
  if (palette.length <= 256) {
    const indices = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const r = rgba[i * 4];
      const g = rgba[i * 4 + 1];
      const b = rgba[i * 4 + 2];
      const key = (r << 16) | (g << 8) | b;
      indices[i] = colorMap.get(key) ?? 0;
    }
    const palBytes = new Uint8Array(palette.length * 3);
    for (let i = 0; i < palette.length; i++) {
      palBytes[i * 3] = (palette[i] >> 16) & 0xff;
      palBytes[i * 3 + 1] = (palette[i] >> 8) & 0xff;
      palBytes[i * 3 + 2] = palette[i] & 0xff;
    }
    return { palette: palBytes, indices };
  }

  // 颜色超过 256：用中位切分法量化
  return medianCutQuantize(rgba, transparentRGB);
}

// ── 中位切分量化 ───────────────────────────────────────
interface ColorBox {
  pixels: number[]; // [r,g,b, r,g,b, ...]
  minR: number; maxR: number;
  minG: number; maxG: number;
  minB: number; maxB: number;
  volume: number;
}

function medianCutQuantize(
  rgba: Uint8ClampedArray,
  transparentRGB: [number, number, number],
): { palette: Uint8Array; indices: Uint8Array } {
  const n = rgba.length / 4;

  // 收集所有像素颜色（去除透明色后）
  const pixels: number[] = [];
  const tKey = (transparentRGB[0] << 16) | (transparentRGB[1] << 8) | transparentRGB[2];
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    if (key !== tKey) {
      pixels.push(r, g, b);
    }
  }

  // 初始 box
  const boxes: ColorBox[] = [makeBox(pixels)];
  while (boxes.length < 255) {
    // 找体积最大的 box
    let maxIdx = -1;
    let maxVol = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].volume > maxVol) {
        maxVol = boxes[i].volume;
        maxIdx = i;
      }
    }
    if (maxIdx < 0 || boxes[maxIdx].pixels.length === 0) break;
    const box = boxes[maxIdx];
    const [b1, b2] = splitBox(box);
    if (!b1 || !b2) break;
    boxes.splice(maxIdx, 1, b1, b2);
  }

  // 构建调色板
  const palColors: [number, number, number][] = [[transparentRGB[0], transparentRGB[1], transparentRGB[2]]];
  const palMap = new Map<number, number>();
  palMap.set(tKey, 0);

  for (const box of boxes) {
    if (box.pixels.length === 0) continue;
    let sr = 0, sg = 0, sb = 0;
    const count = box.pixels.length / 3;
    for (let i = 0; i < box.pixels.length; i += 3) {
      sr += box.pixels[i];
      sg += box.pixels[i + 1];
      sb += box.pixels[i + 2];
    }
    const r = Math.round(sr / count);
    const g = Math.round(sg / count);
    const b = Math.round(sb / count);
    const key = (r << 16) | (g << 8) | b;
    if (!palMap.has(key)) {
      palMap.set(key, palColors.length);
      palColors.push([r, g, b]);
    }
  }

  // 构建索引（最近邻映射）
  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    if (palMap.has(key)) {
      indices[i] = palMap.get(key)!;
    } else {
      // 最近邻搜索
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let j = 0; j < palColors.length; j++) {
        const dr = r - palColors[j][0];
        const dg = g - palColors[j][1];
        const db = b - palColors[j][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = j;
        }
      }
      indices[i] = bestIdx;
    }
  }

  const palBytes = new Uint8Array(palColors.length * 3);
  for (let i = 0; i < palColors.length; i++) {
    palBytes[i * 3] = palColors[i][0];
    palBytes[i * 3 + 1] = palColors[i][1];
    palBytes[i * 3 + 2] = palColors[i][2];
  }
  return { palette: palBytes, indices };
}

function makeBox(pixels: number[]): ColorBox {
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (let i = 0; i < pixels.length; i += 3) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    if (r < minR) minR = r; if (r > maxR) maxR = r;
    if (g < minG) minG = g; if (g > maxG) maxG = g;
    if (b < minB) minB = b; if (b > maxB) maxB = b;
  }
  return {
    pixels,
    minR, maxR, minG, maxG, minB, maxB,
    volume: (maxR - minR + 1) * (maxG - minG + 1) * (maxB - minB + 1),
  };
}

function splitBox(box: ColorBox): [ColorBox | null, ColorBox | null] {
  if (box.pixels.length < 6) return [box, null];
  const rRange = box.maxR - box.minR;
  const gRange = box.maxG - box.minG;
  const bRange = box.maxB - box.minB;
  let axis: 0 | 1 | 2;
  if (rRange >= gRange && rRange >= bRange) axis = 0;
  else if (gRange >= bRange) axis = 1;
  else axis = 2;

  // 按最长轴排序
  const indices = Array.from({ length: box.pixels.length / 3 }, (_, i) => i);
  indices.sort((a, b) => box.pixels[a * 3 + axis] - box.pixels[b * 3 + axis]);
  const mid = Math.floor(indices.length / 2);

  const p1: number[] = [];
  const p2: number[] = [];
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const target = i < mid ? p1 : p2;
    target.push(box.pixels[idx * 3], box.pixels[idx * 3 + 1], box.pixels[idx * 3 + 2]);
  }
  return [makeBox(p1), makeBox(p2)];
}

// ── PNG 编码（8 位索引色） ────────────────────────────
async function encodeIndexedPNG(
  indices: Uint8Array,
  width: number,
  height: number,
  palette: Uint8Array,
): Promise<Uint8Array> {
  // PNG signature
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bitDepth = 8
  ihdr[9] = 3; // colorType = 3 (indexed)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT: 每行前加 filter byte (0 = None)
  const rawData = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) {
    rawData[y * (width + 1)] = 0; // filter = None
    rawData.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const compressed = await zlibCompress(rawData);

  // 构建最终 PNG
  const chunks = [
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('PLTE', palette),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', new Uint8Array(0)),
  ];
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png;
}

// ── 公共 API ───────────────────────────────────────────

/**
 * 将 canvas 导出为 8 位索引色 PNG（bitDepth=8, colorType=3）
 * - 透明像素（alpha=0）被替换为 transparentColor
 * - 调色板 palette[0] = 透明色
 * - 不输出 tRNS chunk（RPG Maker 约定 palette[0] 即透明色）
 */
export async function canvasTo8bitPNG(
  canvas: HTMLCanvasElement,
  options: ExportOptions,
): Promise<Uint8Array> {
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const transparentRGB = parseColor(options.transparentColor);
  if (!transparentRGB) {
    throw new Error(`无效的透明色: ${options.transparentColor}`);
  }
  const [tr, tg, tb] = transparentRGB;

  // 将透明像素替换为透明色（alpha 设为 255）
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      data[i] = tr;
      data[i + 1] = tg;
      data[i + 2] = tb;
      data[i + 3] = 255;
    }
  }

  // 颜色量化
  const { palette, indices } = quantizeToPalette(data, [tr, tg, tb]);

  // 编码 PNG
  return encodeIndexedPNG(indices, canvas.width, canvas.height, palette);
}

/**
 * 触发浏览器下载
 */
export function downloadPNG(pngData: Uint8Array, filename: string): void {
  const buf = new ArrayBuffer(pngData.byteLength);
  const view = new Uint8Array(buf);
  view.set(pngData);
  const blob = new Blob([buf], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 导出 canvas 为 8 位 PNG 并下载
 */
export async function exportCanvasAsPNG(
  canvas: HTMLCanvasElement,
  filename: string,
  options: ExportOptions,
): Promise<void> {
  const pngData = await canvasTo8bitPNG(canvas, options);
  downloadPNG(pngData, filename);
}

export { recommendTransparentColor };
