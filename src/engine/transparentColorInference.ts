// 透明色推断工具
//
// 当用户导入一张 System 图时，需要指定透明色（即图上哪些颜色应被
// 视为透明）。本工具提供几种自动推断策略，按优先级尝试：
//
//   1. PNG 调色板 index 0（首选）：
//      RTP 标准 System 素材为 8 位索引色 PNG，约定 palette[0] 就是透明色。
//      直接解析 PNG 文件的 PLTE chunk 取第一个颜色。
//   2. System 图右上角单像素 (w-1, 0)：
//      标准 System 图右上角是三角箭头图标，角落通常是透明色填充。
//      注意：之前取 (144,16) 区域中心是错误的，因为该位置可能不是透明的。
//   3. 四角多数色：取四角中出现次数最多的颜色（典型 BMP 透明色处理）。
//   4. 最大连通区域：扫描图像，找到占据面积最大的连通同色区域。
//
// 推荐使用 inferTransparentColorFromBuffer（异步），它能解析 PNG 调色板。
// 同步版本 inferTransparentColor 仅能使用策略 2-4。

import { rgbToHex } from './colorUtils';

export interface InferOptions {
  /** System 图模式：按 160×80 布局取右上角单像素 (w-1, 0) */
  systemLayout?: boolean;
}

/**
 * 从 PNG 文件 buffer 解析调色板 index 0 的颜色
 *
 * 适用于 8 位索引色 PNG（colorType=3）。
 * RTP 标准 System 素材都是这种格式，palette[0] 就是透明色。
 *
 * @returns RGB hex 字符串（如 "#FF9C00"），非索引色 PNG 返回 null
 */
export function parsePNGPalette0(buffer: Uint8Array | ArrayBuffer): string | null {
  const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // 验证 PNG 签名
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== sig[i]) return null;
  }

  let off = 8;
  let colorType = -1;
  let palette: Uint8Array | null = null;

  while (off + 8 <= buf.length) {
    const len = view.getUint32(off);
    off += 4;
    const type = String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
    off += 4;

    if (type === 'IHDR') {
      colorType = buf[off + 9]; // bitDepth=buf[off+8], colorType=buf[off+9]
    } else if (type === 'PLTE') {
      palette = buf.slice(off, off + len);
    } else if (type === 'IDAT' || type === 'IEND') {
      // 遇到图像数据就可以停止了（PLTE 一定在 IDAT 之前）
      break;
    }
    off += len + 4; // 数据 + CRC
  }

  // 仅索引色 PNG 有调色板
  if (colorType !== 3 || !palette || palette.length < 3) return null;

  return rgbToHex(palette[0], palette[1], palette[2]);
}

/**
 * 异步推断透明色（推荐）：优先解析 PNG 调色板 index 0
 *
 * @param src 图片 URL
 * @param source 可选，已加载的图片元素（用于策略 2-4 回退）
 * @returns hex 字符串（如 "#FF9C00"），失败返回 null
 */
export async function inferTransparentColorFromBuffer(
  src: string,
  source?: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  options: InferOptions = {},
): Promise<string | null> {
  // 策略 1：fetch 原始 bytes，解析 PNG 调色板
  try {
    const resp = await fetch(src);
    if (resp.ok) {
      const buffer = new Uint8Array(await resp.arrayBuffer());
      const palette0 = parsePNGPalette0(buffer);
      if (palette0) return palette0;
    }
  } catch {
    // fetch 失败（如 CORS），回退到像素采样
  }

  // 策略 2-4：回退到同步推断
  if (source) {
    return inferTransparentColor(source, options);
  }
  return null;
}

/**
 * 同步推断透明色：返回 hex 字符串（如 "#FF00FF"），失败返回 null。
 *
 * 注意：此函数无法解析 PNG 调色板，仅使用像素采样策略。
 * 推荐使用 inferTransparentColorFromBuffer 以获得准确结果。
 */
export function inferTransparentColor(
  source: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  options: InferOptions = {},
): string | null {
  const canvas = toCanvas(source);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;

  // 1. System 图布局：取右上角单像素 (w-1, 0)
  //    标准 System 图右上角是三角箭头图标，角落通常是透明色填充
  if (options.systemLayout && width >= 160 && height >= 80) {
    const corner = samplePixel(ctx, width - 1, 0);
    if (corner) return corner;
  }

  // 2. 四角中出现次数最多的颜色
  const cornerColor = sampleCorners(ctx, width, height);
  if (cornerColor) return cornerColor;

  // 3. 最大连通同色区域
  const largest = findLargestColorRegion(ctx, width, height);
  if (largest) return largest;

  return null;
}

function toCanvas(source: HTMLImageElement | ImageBitmap | HTMLCanvasElement): HTMLCanvasElement | null {
  if (source instanceof HTMLCanvasElement) return source;
  const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  if (!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source as CanvasImageSource, 0, 0);
  return c;
}

function samplePixel(ctx: CanvasRenderingContext2D, x: number, y: number): string | null {
  const px = ctx.getImageData(x, y, 1, 1).data;
  if (px[3] === 0) return null; // 已透明
  return rgbToHex(px[0], px[1], px[2]);
}

function sampleCorners(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
): string | null {
  const points = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
  ];
  const counts = new Map<string, number>();
  for (const [x, y] of points) {
    const px = ctx.getImageData(x, y, 1, 1).data;
    if (px[3] === 0) continue;
    const hex = rgbToHex(px[0], px[1], px[2]);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best: string | null = null;
  let bestCount = 0;
  for (const [hex, n] of counts) {
    if (n > bestCount) {
      best = hex;
      bestCount = n;
    }
  }
  return best;
}

/**
 * 找到占据面积最大的同色连通区域，返回其颜色 hex。
 * 用 BFS/DFS 遍历每个像素，跳过已访问的；按 4-邻接连通。
 * 仅扫描不透明的像素。
 *
 * 性能：对 192×192 FaceSet 约 36864 像素，扫描一次约 10ms。
 */
function findLargestColorRegion(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
): string | null {
  if (w <= 0 || h <= 0) return null;
  // 限制最大像素数（防止超大图片卡死）
  const MAX_PIXELS = 256 * 256;
  if (w * h > MAX_PIXELS) {
    // 缩小采样：仅在图像四周 + 中心采样若干点
    return sampleCorners(ctx, w, h);
  }
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const visited = new Uint8Array(w * h);

  let bestColor: string | null = null;
  let bestArea = 0;
  // 阈值：区域必须占总像素至少 0.5% 才视为有效透明色候选
  const minArea = Math.max(8, Math.floor(w * h * 0.005));

  const stack: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (visited[idx]) continue;
      const off = idx * 4;
      if (data[off + 3] === 0) {
        visited[idx] = 1;
        continue;
      }
      const r = data[off], g = data[off + 1], b = data[off + 2];
      // BFS 泛洪填充同色连通区域
      let area = 0;
      stack.length = 0;
      stack.push(idx);
      visited[idx] = 1;
      while (stack.length > 0) {
        const cur = stack.pop()!;
        area++;
        const cx = cur % w;
        const cy = Math.floor(cur / w);
        // 4 邻接
        const neighbors = [
          cx > 0 ? cur - 1 : -1,
          cx < w - 1 ? cur + 1 : -1,
          cy > 0 ? cur - w : -1,
          cy < h - 1 ? cur + w : -1,
        ];
        for (const ni of neighbors) {
          if (ni < 0 || visited[ni]) continue;
          const noff = ni * 4;
          if (data[noff + 3] === 0) {
            visited[ni] = 1;
            continue;
          }
          if (data[noff] === r && data[noff + 1] === g && data[noff + 2] === b) {
            visited[ni] = 1;
            stack.push(ni);
          }
        }
      }
      if (area > bestArea && area >= minArea) {
        bestArea = area;
        bestColor = rgbToHex(r, g, b);
      }
    }
  }
  return bestColor;
}
