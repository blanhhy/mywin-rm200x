// 文字渲染器：解析 \c[N] 控制符，按 RPG Maker 200x 规则绘制文字
// 规则参考 docs/rendering-rules.md 第 5 节
//
// 核心渲染管线（两种模式共用 4x 过采样）：
//
//   48px 字体渲染 → 高质量缩放到 12px → 后处理
//
// 1. 像素模式 (pixel)：阈值化 alpha 通道（>= 128 → 255, else → 0）
//    匹配 EasyRPG 的 FT_LOAD_MONOCHROME | FT_LOAD_TARGET_MONO 行为。
//    锐利、无抗锯齿、1-bit 像素字形。
//
// 2. 平滑模式 (smooth)：保留缩放后的灰度抗锯齿
//    得到自然平滑的字形，适合非像素风格场景。
//
// 为什么使用 4x 过采样：
//   浏览器 Canvas 的字体渲染依赖系统字体引擎（Windows DirectWrite），
//   在 12px 小字号下 hinting 质量差。48px 是字体 hinting 的"甜点"区域，
//   在此分辨率下渲染再高质量降采样到 12px，可获得接近 FreeType 的渲染质量。

import { RPG_CONSTANTS } from '../types';

/** 过采样倍数：4x（48px → 12px） */
const OVERSAMPLE = 4;

/** 过采样常量：在 4x 分辨率下的尺寸 */
const OS_FONT_SIZE = RPG_CONSTANTS.FONT_HEIGHT * OVERSAMPLE;    // 48
const OS_LINE_HEIGHT = RPG_CONSTANTS.LINE_HEIGHT * OVERSAMPLE;   // 64
const OS_BASE_Y_OFFSET = RPG_CONSTANTS.TEXT_START_Y * OVERSAMPLE; // 8

/**
 * 4x 源画布宽度：
 * 半角字符：48px (4x of 12px)，容纳任意半角字形
 * 全角字符：96px (4x of 24px)，容纳任意 CJK 字形
 */
const OS_HALF_SOURCE_W = RPG_CONSTANTS.FULL_WIDTH * OVERSAMPLE;      // 48
const OS_FULL_SOURCE_W = RPG_CONSTANTS.FULL_WIDTH * 2 * OVERSAMPLE;  // 96

/** 渲染模式 */
export type TextRenderMode = 'pixel' | 'smooth';

// === 解析层 ===

interface TextSegment {
  text: string;
  color: number;
}

interface ParsedLine {
  segments: TextSegment[];
}

/**
 * 解析 \c[N] 控制符，将文本拆分为带颜色的段
 * - \c[N] 设置颜色，N=0..19；N>19 回到 0；\c[] 等价 \c[0]
 * - 颜色持续到下一个 \c[...] 为止
 * - 不带 [ 的 \c 退化为颜色 0
 */
export function parseTextWithColors(text: string, defaultColor: number = 0): ParsedLine[] {
  const lines: ParsedLine[] = [];
  const rawLines = text.split('\n');
  for (const rawLine of rawLines) {
    const segments: TextSegment[] = [];
    let currentColor = defaultColor;
    let buf = '';
    let i = 0;
    while (i < rawLine.length) {
      const ch = rawLine[i];
      if (ch === '\\') {
        const next = rawLine[i + 1];
        if (next === 'c' || next === 'C') {
          if (rawLine[i + 2] === '[') {
            const closeIdx = rawLine.indexOf(']', i + 3);
            if (closeIdx !== -1) {
              const numStr = rawLine.slice(i + 3, closeIdx);
              const num = numStr === '' ? 0 : parseInt(numStr, 10);
              const newColor = Number.isNaN(num) || num > 19 ? 0 : num;
              if (buf) {
                segments.push({ text: buf, color: currentColor });
                buf = '';
              }
              currentColor = newColor;
              i = closeIdx + 1;
              continue;
            }
          }
          if (buf) {
            segments.push({ text: buf, color: currentColor });
            buf = '';
          }
          currentColor = 0;
          i += 2;
          continue;
        }
        if (next === '\\') {
          buf += '\\';
          i += 2;
          continue;
        }
      }
      buf += ch;
      i++;
    }
    if (buf) {
      segments.push({ text: buf, color: currentColor });
    }
    lines.push({ segments });
  }
  return lines;
}

/** 判断字符是否为全角（CJK 及全角符号） */
export function isFullWidth(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined) return false;
  if (code < 0x80) return false;
  if (code >= 0x4e00 && code <= 0x9fff) return true;
  if (code >= 0x3400 && code <= 0x4dbf) return true;
  if (code >= 0xf900 && code <= 0xfaff) return true;
  if (code >= 0x3040 && code <= 0x309f) return true;
  if (code >= 0x30a0 && code <= 0x30ff) return true;
  if (code >= 0xac00 && code <= 0xd7af) return true;
  if (code >= 0xff01 && code <= 0xff5e) return true;
  if (code >= 0x3000 && code <= 0x303f) return true;
  if (code >= 0xff00 && code <= 0xffef) return true;
  return false;
}

/** 获取字符宽度（半角 6px，全角 12px） */
export function getCharWidth(ch: string): number {
  return isFullWidth(ch) ? RPG_CONSTANTS.FULL_WIDTH : RPG_CONSTANTS.HALF_WIDTH;
}

/** 计算一段文本的像素宽度（按固定 6/12 字宽） */
export function getTextWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += getCharWidth(ch);
  }
  return w;
}

/** 获取行像素宽度（所有段之和） */
export function getLineWidth(line: ParsedLine): number {
  let w = 0;
  for (const seg of line.segments) {
    w += getTextWidth(seg.text);
  }
  return w;
}

// === 渲染层 ===

export interface TextRenderOptions {
  ctx: CanvasRenderingContext2D;
  text: string;
  x: number;
  y: number;
  fontFamily: string;
  defaultColor: number;
  getColor: (index: number) => string;
  shadowColor: string;
  drawShadow?: boolean;
  lineHeight?: number;
  maxLines?: number;
  baseYOffset?: number;
  mode?: TextRenderMode;
}

// === 字形缓存 ===
const pixelGlyphCache = new Map<string, HTMLCanvasElement>();
const smoothGlyphCache = new Map<string, HTMLCanvasElement>();

/**
 * 创建一个配置好的 canvas 2D 上下文用于字体渲染
 * 关键设置：启用 fontKerning，使用正确的字体族
 */
function createRenderContext(
  canvas: HTMLCanvasElement,
  fontFamily: string,
  fontSize: number,
): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')!;

  // 启用字体 kerning（如果浏览器支持）
  if ('fontKerning' in ctx) {
    (ctx as any).fontKerning = 'normal';
  }

  // 使用更大的字体尺寸（4x）渲染，获得更好的 hinting
  ctx.font = `${fontSize}px ${fontFamily || 'monospace'}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.imageSmoothingEnabled = false;

  return ctx;
}

/**
 * 4x 过采样渲染核心函数
 *
 * 统一的渲染管线：
 * 1. 在 4x 分辨率下（48px）渲染字符到宽画布
 * 2. 使用高质量降采样缩放到目标 1x 尺寸
 * 3. 根据模式进行后处理（阈值化 / 保留抗锯齿）
 * 4. 裁剪到目标单元格宽度
 */
function renderGlyph4x(
  ch: string,
  color: string,
  fontFamily: string,
  fullWidth: boolean,
  mode: TextRenderMode,
): HTMLCanvasElement {
  const targetW = fullWidth ? RPG_CONSTANTS.FULL_WIDTH : RPG_CONSTANTS.HALF_WIDTH; // 12 or 6
  const targetH = RPG_CONSTANTS.LINE_HEIGHT; // 16
  const osSourceW = fullWidth ? OS_FULL_SOURCE_W : OS_HALF_SOURCE_W; // 96 or 48

  // Step 1: 在 4x 分辨率下渲染到宽画布
  const osCanvas = document.createElement('canvas');
  osCanvas.width = osSourceW;
  osCanvas.height = OS_LINE_HEIGHT; // 64

  const octx = createRenderContext(osCanvas, fontFamily, OS_FONT_SIZE);
  octx.fillStyle = color;
  octx.fillText(ch, 0, OS_BASE_Y_OFFSET);

  // Step 2: 高质量缩放到 1x 目标尺寸
  // 使用 imageSmoothingQuality: 'high' 进行双三次/双线性降采样
  const scaledW = Math.round(osSourceW / OVERSAMPLE); // 24 or 12
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = scaledW;
  tmpCanvas.height = targetH; // 16
  const tmctx = tmpCanvas.getContext('2d')!;
  tmctx.imageSmoothingEnabled = true;
  tmctx.imageSmoothingQuality = 'high';
  tmctx.drawImage(osCanvas, 0, 0, osSourceW, OS_LINE_HEIGHT, 0, 0, scaledW, targetH);

  // Step 3: 后处理
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = targetW;
  targetCanvas.height = targetH;
  const tctx = targetCanvas.getContext('2d')!;
  tctx.imageSmoothingEnabled = false;

  if (mode === 'pixel') {
    // 像素模式：对缩放后的结果进行阈值化
    const imageData = tmctx.getImageData(0, 0, scaledW, targetH);
    const data = imageData.data;
    const THRESHOLD = 128;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      data[i + 3] = alpha >= THRESHOLD ? 255 : 0;
    }
    tmctx.putImageData(imageData, 0, 0);
  }

  // Step 4: 裁剪到目标单元格宽度
  if (fullWidth) {
    // 全角字符：占满 12px 宽度
    tctx.drawImage(tmpCanvas, 0, 0, targetW, targetH, 0, 0, targetW, targetH);
  } else {
    // 半角字符：居中到 6px 宽度
    // 测量字形实际占用宽度
    const imageData = mode === 'pixel'
      ? tmctx.getImageData(0, 0, scaledW, targetH)
      : null;

    let glyphRight = 0;
    if (imageData) {
      // 像素模式：从已阈值化的数据测量
      const srcData = imageData.data;
      for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < scaledW; x++) {
          if (srcData[(y * scaledW + x) * 4 + 3] > 0) {
            glyphRight = Math.max(glyphRight, x + 1);
          }
        }
      }
    } else {
      // 平滑模式：通过临时测量
      const measureCanvas = document.createElement('canvas');
      measureCanvas.width = scaledW;
      measureCanvas.height = targetH;
      const mctx = measureCanvas.getContext('2d')!;
      mctx.drawImage(tmpCanvas, 0, 0);
      const mData = mctx.getImageData(0, 0, scaledW, targetH).data;
      for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < scaledW; x++) {
          if (mData[(y * scaledW + x) * 4 + 3] > 10) {
            glyphRight = Math.max(glyphRight, x + 1);
          }
        }
      }
    }

    const glyphW = Math.min(glyphRight || targetW, targetW);
    const offsetX = Math.floor((targetW - glyphW) / 2);
    tctx.drawImage(tmpCanvas, 0, 0, glyphW, targetH, offsetX, 0, glyphW, targetH);
  }

  return targetCanvas;
}

/**
 * 获取字形（带缓存）
 */
function getGlyph(
  ch: string,
  color: string,
  fontFamily: string,
  fullWidth: boolean,
  mode: TextRenderMode,
): HTMLCanvasElement {
  const cache = mode === 'pixel' ? pixelGlyphCache : smoothGlyphCache;
  const key = `${ch}|${color}|${fontFamily}|${fullWidth ? 'F' : 'H'}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const glyph = renderGlyph4x(ch, color, fontFamily, fullWidth, mode);

  cache.set(key, glyph);
  return glyph;
}

/**
 * 绘制多行文字（含颜色控制符）
 * 每行高度 16px，字形高度 12px，行内 y 偏移 2px
 * 阴影：右下偏移 1px
 *
 * 支持两种模式：
 * - pixel: 像素模式（4x 过采样 + 阈值化，匹配 RPG Maker 渲染）
 * - smooth: 平滑模式（4x 过采样 + 抗锯齿）
 */
export function renderText(opts: TextRenderOptions): void {
  const {
    ctx,
    text,
    x,
    y,
    fontFamily,
    defaultColor,
    getColor,
    shadowColor,
    drawShadow = true,
    lineHeight = RPG_CONSTANTS.LINE_HEIGHT,
    baseYOffset = RPG_CONSTANTS.TEXT_START_Y,
    mode = 'pixel',
  } = opts;

  const lines = parseTextWithColors(text, defaultColor);
  ctx.imageSmoothingEnabled = false;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineY = y + li * lineHeight + baseYOffset;
    let curX = x;
    for (const seg of line.segments) {
      const color = getColor(seg.color);
      for (const ch of seg.text) {
        const fw = isFullWidth(ch);
        const w = fw ? RPG_CONSTANTS.FULL_WIDTH : RPG_CONSTANTS.HALF_WIDTH;
        if (drawShadow && shadowColor) {
          const shadowGlyph = getGlyph(ch, shadowColor, fontFamily, fw, mode);
          ctx.drawImage(shadowGlyph, curX + 1, lineY - baseYOffset + 1);
        }
        const mainGlyph = getGlyph(ch, color, fontFamily, fw, mode);
        ctx.drawImage(mainGlyph, curX, lineY - baseYOffset);
        curX += w;
      }
    }
  }
}

/** 清空字形缓存 */
export function clearGlyphCache(): void {
  pixelGlyphCache.clear();
  smoothGlyphCache.clear();
}

/**
 * 计算文本绘制后的总尺寸（用于自适应窗口大小）
 */
export function measureTextBounds(
  text: string,
  lineHeight: number = RPG_CONSTANTS.LINE_HEIGHT,
): { width: number; height: number } {
  const lines = parseTextWithColors(text, 0);
  let maxW = 0;
  for (const line of lines) {
    const w = getLineWidth(line);
    if (w > maxW) maxW = w;
  }
  return {
    width: maxW,
    height: lines.length * lineHeight,
  };
}
