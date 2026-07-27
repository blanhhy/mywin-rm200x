// 位图字体渲染器
//
// 使用 EasyRPG 的 1-bit 位图字体数据，实现与 RPG Maker 200x 完全一致的像素渲染。
// 每个字形直接以像素位图存储，无需任何缩放或抗锯齿处理。
//
// 字体回退链（与 EasyRPG 一致）：
//   RMG2000 → ttyp0 → Shinonome Mincho → Shinonome Gothic → WQY → 替换字符
//   ttyp0 → Shinonome Gothic → WQY → 替换字符
//   Shinonome Gothic → Baekmuk → WQY → 替换字符

import { RPG_CONSTANTS } from '../types';
import { BITMAP_FONTS, type BitmapFontData } from './bitmap-fonts';

/** 位图字体标识符 */
export type BitmapFontId =
  | 'rmg2000'
  | 'ttyp0'
  | 'shinonomeGothic'
  | 'shinonomeMincho'
  | 'wqy'
  | 'baekmuk';

/** 替换字符的字形（找不到时显示的菱形） */
const REPLACEMENT_GLYPH_DATA = new Uint16Array([96, 240, 504, 924, 1902, 3967, 4031, 1982, 1020, 440, 240, 96]);
const REPLACEMENT_IS_FULL = true;

/**
 * 在位图字体中二分查找字形索引
 * 返回找到的索引，或 -1
 */
function findGlyphIndex(font: BitmapFontData, code: number): number {
  const codes = font.codes;
  let lo = 0;
  let hi = codes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midCode = codes[mid] & 0xffff; // 低 16 位为码点
    if (midCode < code) {
      lo = mid + 1;
    } else if (midCode > code) {
      hi = mid - 1;
    } else {
      return mid;
    }
  }
  return -1;
}

/**
 * 字体回退链
 * 与 EasyRPG 的 find_*_glyph 函数完全一致（font.cpp:74-132）
 *
 * EasyRPG 回退层级：
 *   find_fallback_glyph: wqy → 替换字符（最终兜底）
 *   find_baekmuk_glyph: baekmuk → fallback(wqy)
 *   find_gothic_glyph: (CP936 先 wqy) → Shinonome Gothic → baekmuk → fallback(wqy)
 *   find_mincho_glyph: (CP936 先 wqy) → Shinonome Mincho → gothic
 *   find_rmg2000_glyph: rmg2000 → ttyp0 → mincho
 *   find_ttyp0_glyph: ttyp0 → gothic
 *
 * 注意：wqy 不是放在最前面就是放在最后（作为 fallback），不会出现在中间。
 * baekmuk 覆盖一些特殊符号（如罗马数字 Ⅰ-Ⅹ），是 wqy 的重要补充。
 */
const FALLBACK_CHAIN: Record<BitmapFontId, BitmapFontId[]> = {
  rmg2000: ['rmg2000', 'ttyp0', 'shinonomeMincho', 'shinonomeGothic', 'baekmuk', 'wqy'],
  ttyp0: ['ttyp0', 'shinonomeGothic', 'baekmuk', 'wqy'],
  shinonomeGothic: ['shinonomeGothic', 'baekmuk', 'wqy'],
  shinonomeMincho: ['shinonomeMincho', 'shinonomeGothic', 'baekmuk', 'wqy'],
  wqy: ['wqy', 'shinonomeGothic', 'baekmuk'],
  baekmuk: ['baekmuk', 'wqy'],
};

/** 字形查找结果 */
interface GlyphResult {
  /** 像素数据：12 行，每行一个 uint16（bit 0 = 最左列） */
  data: Uint16Array | number[];
  /** 是否全角（true=12px 宽，false=6px 宽） */
  isFull: boolean;
}

/**
 * 查找字形：在回退链中依次查找
 */
function findGlyph(fontId: BitmapFontId, code: number): GlyphResult {
  const chain = FALLBACK_CHAIN[fontId];
  for (const fid of chain) {
    const font = BITMAP_FONTS[fid];
    if (!font) continue;
    const idx = findGlyphIndex(font, code);
    if (idx >= 0) {
      const packed = font.codes[idx];
      const isFull = (packed & 0x10000) !== 0;
      // 提取 12 行像素数据
      const offset = idx * 12;
      const data = font.pixels.subarray(offset, offset + 12);
      return { data, isFull };
    }
  }
  // 回退到替换字符
  return { data: REPLACEMENT_GLYPH_DATA, isFull: REPLACEMENT_IS_FULL };
}

// === 字形缓存 ===
const glyphCache = new Map<string, HTMLCanvasElement>();

/**
 * 渲染单个位图字形为 canvas
 *
 * 与 EasyRPG Font::RenderImpl 完全一致的着色逻辑：
 * 字形位图作为 alpha mask，颜色来自 System 图色块的对应像素位置。
 * 即文字每个点亮像素 (dx, dy) 取 System 图 (srcX + dx, srcY + dy) 的颜色。
 * 色块本身 16×16，每个像素颜色可能不同（渐变/纹理），不能用单色填充。
 *
 * @param ch 字符
 * @param srcX 色块在 System 图中的取样起点 x
 * @param srcY 色块在 System 图中的取样起点 y
 * @param systemCanvas 处理后的 System 图 canvas（透明色已应用）
 * @param fontId 位图字体 ID
 */
function getBitmapGlyph(
  ch: string,
  srcX: number,
  srcY: number,
  systemCanvas: HTMLCanvasElement,
  fontId: BitmapFontId,
): HTMLCanvasElement {
  const cacheKey = `${ch}|${srcX},${srcY}|${fontId}`;
  const cached = glyphCache.get(cacheKey);
  if (cached) return cached;

  const code = ch.codePointAt(0) || 0;
  const { data, isFull } = findGlyph(fontId, code);

  const width = isFull ? RPG_CONSTANTS.FULL_WIDTH : RPG_CONSTANTS.HALF_WIDTH; // 12 or 6
  const height = RPG_CONSTANTS.FONT_HEIGHT; // 12

  // 从 System 图取出对应区域的像素数据（width × 12，起点 (srcX, srcY)）
  const sysCtx = systemCanvas.getContext('2d', { willReadFrequently: true })!;
  const sysData = sysCtx.getImageData(srcX, srcY, width, height).data;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = RPG_CONSTANTS.LINE_HEIGHT; // 16，但字形只占上方 12px
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // 直接操作像素数据，性能最优
  const imageData = ctx.createImageData(width, height);
  const pixels = imageData.data;

  for (let y = 0; y < height; y++) {
    const row = data[y] || 0;
    for (let x = 0; x < width; x++) {
      const bit = row & (1 << x);
      const idx = (y * width + x) * 4;
      if (bit) {
        // 按位置对应取 System 图色块的像素颜色
        const sIdx = (y * width + x) * 4;
        pixels[idx] = sysData[sIdx];
        pixels[idx + 1] = sysData[sIdx + 1];
        pixels[idx + 2] = sysData[sIdx + 2];
        pixels[idx + 3] = 255;
      }
      // 透明像素 alpha=0（已由 createImageData 初始化）
    }
  }

  ctx.putImageData(imageData, 0, 0);

  glyphCache.set(cacheKey, canvas);
  return canvas;
}

/** 清空位图字形缓存 */
export function clearBitmapGlyphCache(): void {
  glyphCache.clear();
}

/**
 * 计算位图字体文本绘制后的总尺寸（用于自适应窗口大小）
 * 与 renderBitmapText 使用相同的字形宽度逻辑（基于 findGlyph 的实际 isFull）
 */
export function measureBitmapTextBounds(
  text: string,
  fontId: BitmapFontId,
  lineHeight: number = RPG_CONSTANTS.LINE_HEIGHT,
): { width: number; height: number } {
  const lines = parseText(text, 0);
  let maxW = 0;
  for (const line of lines) {
    let w = 0;
    for (const seg of line.segments) {
      for (const ch of seg.text) {
        const code = ch.codePointAt(0) || 0;
        const { isFull } = findGlyph(fontId, code);
        w += isFull ? RPG_CONSTANTS.FULL_WIDTH : RPG_CONSTANTS.HALF_WIDTH;
      }
    }
    if (w > maxW) maxW = w;
  }
  // 最后一行只需 FONT_HEIGHT（12px），不需整行 lineHeight（16px）的行间距
  // 这样自适应高度在 padding=0 时文字能紧贴边缘，无尾部空白
  return {
    width: maxW,
    height: (lines.length - 1) * lineHeight + RPG_CONSTANTS.FONT_HEIGHT,
  };
}

export interface BitmapTextRenderOptions {
  ctx: CanvasRenderingContext2D;
  text: string;
  x: number;
  y: number;
  defaultColor: number;
  /** System 图处理后的 canvas（用于按像素位置取色） */
  systemCanvas: HTMLCanvasElement;
  /** 根据颜色索引返回色块在 System 图中的取样起点 */
  getColorSrcPos: (index: number) => { x: number; y: number };
  /** 阴影色块在 System 图中的取样起点 */
  shadowSrcPos: { x: number; y: number };
  drawShadow?: boolean;
  lineHeight?: number;
  fontId: BitmapFontId;
}

/**
 * 绘制位图字体文字
 * 每行高度 16px，字形高度 12px
 * 阴影：右下偏移 1px
 *
 * 着色逻辑与 EasyRPG Font::RenderImpl 一致：
 * 字形作为 alpha mask，颜色按位置对应取自 System 图的 16×16 色块
 */
export function renderBitmapText(opts: BitmapTextRenderOptions): void {
  const {
    ctx,
    text,
    x,
    y,
    defaultColor,
    systemCanvas,
    getColorSrcPos,
    shadowSrcPos,
    drawShadow = true,
    lineHeight = RPG_CONSTANTS.LINE_HEIGHT,
    fontId,
  } = opts;

  // 解析颜色控制符（复用 textRenderer 的解析逻辑）
  const lines = parseText(text, defaultColor);
  ctx.imageSmoothingEnabled = false;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineY = y + li * lineHeight;
    let curX = x;
    for (const seg of line.segments) {
      const srcPos = getColorSrcPos(seg.color);
      for (const ch of seg.text) {
        const mainGlyph = getBitmapGlyph(ch, srcPos.x, srcPos.y, systemCanvas, fontId);
        const w = mainGlyph.width; // 字形实际宽度（全角 12px / 半角 6px）
        if (drawShadow) {
          const shadowGlyph = getBitmapGlyph(ch, shadowSrcPos.x, shadowSrcPos.y, systemCanvas, fontId);
          ctx.drawImage(shadowGlyph, curX + 1, lineY + 1);
        }
        ctx.drawImage(mainGlyph, curX, lineY);
        curX += w;
      }
    }
  }
}

// === 文本解析（从 textRenderer 复制，避免循环依赖） ===

interface TextSegment {
  text: string;
  color: number;
}

interface ParsedLine {
  segments: TextSegment[];
}

function parseText(text: string, defaultColor: number = 0): ParsedLine[] {
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
