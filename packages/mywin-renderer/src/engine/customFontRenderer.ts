// 自定义字体渲染器
//
// 用户可以选择本机已安装字体或导入字体文件，替代内置的 12px 位图字体。
// 与位图字体渲染的差异：
//   - 字号、字间距、行间距、阴影开关可调
//   - 默认直接 fillText，保留浏览器自身的抗锯齿与微调（适用绝大多数字体）
//   - 可选的"像素完美"模式：超采样栅格化后按源像素块二值化，
//     专门给"设计网格与画布像素对齐"的像素字体用
//     （这类字体在原生字号下会被抗锯齿填平 1px 缝隙）
//   - 只有实际字形为 12px 时能用 System 色盘（\c[n]）；其他尺寸一律白色兜底，
//     想换色只能用 \c[RRGGBB] 扩展语法

import { RPG_CONSTANTS, DEFAULT_TEXT_RGB, type CustomFontConfig } from '../types/index.js';
import { parseText, type FillRegion, type TextColorSource } from './bitmapFontRenderer.js';

/** 解析出的行类型（复用 bitmapFontRenderer 的解析结果，不额外导出内部类型） */
type ParsedLine = ReturnType<typeof parseText>[number];

/** 掩码阈值：覆盖率 ≥ 该值算作被点亮的像素（保证 1-bit 输出） */
const ALPHA_THRESHOLD = 128;

/**
 * 像素完美模式的超采样倍率
 *
 * 8px 这类超小字号下，浏览器会把 1px 宽的缝隙填平（还受 TrueType 微调影响），
 * 必须放大后按源像素块求平均才能还原设计网格。
 *
 * 但 12px 及以上（例如文泉驿点阵 12px：unitsPerEm=1500，正好 12 像素）
 * 原生字号本身就与设计网格对齐，直接按 1:1 二值化即可还原点阵；
 * 再放大反而会被逐 ppem 的微调指令挪动轮廓，导致块均值对不齐、缺笔画。
 * 所以只在字号小于 FONT_HEIGHT(12) 时才超采样。
 */
const SUPERSAMPLE_MIN = 4;
const SUPERSAMPLE_TARGET_PX = 32;

function supersampleOf(size: number): number {
  if (size >= RPG_CONSTANTS.FONT_HEIGHT) return 1;
  return Math.max(SUPERSAMPLE_MIN, Math.ceil(SUPERSAMPLE_TARGET_PX / size));
}

/** 几何参数：渲染与测量共用，保证两者一致 */
interface FontGeometry {
  family: string;
  size: number;
  letterSpacing: number;
  /** 行高 = 字号 + 行间距 */
  lineHeight: number;
  /** 基线到字盒顶部的距离 */
  ascent: number;
  /** 字盒底部到基线的距离 */
  descent: number;
}

/** 落地字形：x 为整数像素位置 */
interface PlacedGlyph {
  ch: string;
  x: number;
  /** 字形步进宽度（System 色盘按像素取色时用来定位字形格） */
  w: number;
  /** 显式颜色（\c[RRGGBB] 或白色兜底）；null = 按 System 色盘逐像素取色 */
  rgb: number | null;
  /** System 色盘索引 */
  colorIndex: number;
}

/** 一行的排版结果 */
interface LineLayout {
  glyphs: PlacedGlyph[];
  /** 行宽（不含最后一个字形之后的字间距） */
  width: number;
  /** 相对行原点的填充区域 */
  fills: { x: number; w: number; expandY: number }[];
}

/** 共享的测量上下文（只用于 measureText） */
let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')!;
  }
  return measureCtx;
}

function fontSpec(geo: FontGeometry): string {
  return `${geo.size}px "${geo.family}"`;
}

/** 解析字体几何参数（字号取整，字盒高由字体自身度量决定） */
function resolveGeometry(font: CustomFontConfig): FontGeometry {
  const family = font.family ?? '';
  const size = Math.max(1, Math.round(font.size));
  const ctx = getMeasureContext();
  ctx.font = `${size}px "${family}"`;
  const metrics = ctx.measureText('Mg');
  // 像素完美模式按"墨迹顶部"对齐：点阵字体的大写字高往往比字体度量小 1~2px
  // （文泉驿 15px 时 fontBoundingBoxAscent=12，而 CJK 实际墨迹只有 10px），
  // 用字体度量会把字整体压低，二值化后和内置点阵错位。
  const inkAscent = font.pixelPerfect
    ? Math.round(ctx.measureText('永').actualBoundingBoxAscent)
    : 0;
  const ascent =
    inkAscent > 0 ? inkAscent : Math.ceil(metrics.fontBoundingBoxAscent ?? size * 0.8);
  const descent = Math.ceil(metrics.fontBoundingBoxDescent ?? size * 0.2);
  return {
    family,
    size,
    letterSpacing: font.letterSpacing,
    lineHeight: Math.max(1, size + font.lineSpacing),
    ascent,
    descent,
  };
}

/**
 * 字形是否正好是 12px 点阵尺寸
 *
 * System 色盘是按像素位置从 16×16 色块取色的，只有 12px 字形能和内置字体一样
 * 对上色块，所以只允许这个尺寸查色盘。
 *
 * 判断依据是实际字形尺寸，而不是 CSS 字号：点阵字体的 em 常常大于字形本身
 * （"文泉驿点阵宋体 12px"要用 15px 才能落在设计网格上，但字形就是 12px）。
 * 全角字符的步进宽度在 12px 字形下正好是 12，用它来识别最可靠。
 */
function isTwelvePixelGlyph(geo: FontGeometry): boolean {
  const ctx = getMeasureContext();
  ctx.font = fontSpec(geo);
  return Math.abs(ctx.measureText('永').width - RPG_CONSTANTS.FULL_WIDTH) < 0.5;
}

/**
 * 渲染一个样字，返回"中间过渡像素"（alpha 160~223）占全部墨迹像素的比例
 *
 * 点阵字体在原生尺寸下，轮廓边界落在整数像素上，亮度几乎是二值的：
 * 核心 ≥224，抗锯齿虚边 <160，中间过渡像素接近 0。
 * 非原生尺寸下轮廓落在半像素上，过渡像素会大量出现。
 */
function probeMidRatio(family: string, size: number): number {
  const W = size * 2 + 12;
  const H = size * 3 + 12;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.font = `${size}px "${family}"`;
  const ascent = Math.ceil(ctx.measureText('Mg').fontBoundingBoxAscent ?? size * 0.8);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.fillText('永', 4, 4 + ascent);
  const data = ctx.getImageData(0, 0, W, H).data;
  let ink = 0;
  let mid = 0;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a === 0) continue;
    ink++;
    if (a >= 160 && a < 224) mid++;
  }
  return ink === 0 ? 1 : mid / ink;
}

/**
 * 找出字体真正落在像素网格上的字号（点阵字体的原生尺寸）
 *
 * 只返回过渡像素占比接近 0 的候选；普通轮廓字体在任何字号下都达不到这个条件，
 * 因此返回 null，调用方保持用户当前字号即可。
 * 有多个候选时（原生尺寸的整数倍也对齐），取距离当前字号最近的一个。
 */
export function findNativePixelSize(font: CustomFontConfig): number | null {
  const family = font.family;
  if (!family) return null;

  const requested = Math.max(1, Math.round(font.size));
  const lo = Math.max(4, Math.floor(requested * 0.5));
  const hi = Math.min(96, Math.ceil(requested * 2));
  let best: number | null = null;
  let bestScore = Infinity;
  for (let n = lo; n <= hi; n++) {
    if (probeMidRatio(family, n) >= 0.05) continue;
    const score = Math.abs(n - requested);
    if (score < bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

/**
 * 解析某一段文字的着色方式
 * \c[RRGGBB] 显式颜色优先；否则只有 12px 字形能查 System 色盘，其余一律白色
 */
function resolveSegmentPaint(
  seg: ParsedLine['segments'][number],
  geo: FontGeometry,
  colorSource: TextColorSource | null,
): { rgb: number | null; colorIndex: number } {
  if (seg.rgb !== undefined) return { rgb: seg.rgb, colorIndex: seg.color };
  // rgb = null：交给绘制阶段按 System 色盘逐像素取色（与内置位图字体一致）
  if (colorSource && isTwelvePixelGlyph(geo)) return { rgb: null, colorIndex: seg.color };
  return { rgb: DEFAULT_TEXT_RGB, colorIndex: seg.color };
}

/** 按逐字符整数位置排版一行 */
function layoutLine(
  line: ParsedLine,
  geo: FontGeometry,
  colorSource: TextColorSource | null,
): LineLayout {
  const ctx = getMeasureContext();
  ctx.font = fontSpec(geo);
  const glyphs: PlacedGlyph[] = [];
  const fills: LineLayout['fills'] = [];
  let penX = 0;
  let lastWasGlyph = false;
  for (const seg of line.segments) {
    // 填充分隔：\r 占半字号宽、\p 占 1px 宽，不画字形
    if (seg.fillKind !== undefined) {
      const w = seg.fillKind === 'half' ? Math.round(geo.size / 2) : 1;
      fills.push({ x: Math.round(penX), w, expandY: seg.fillExpandY ?? 0 });
      penX += w;
      lastWasGlyph = false;
      continue;
    }
    const paint = resolveSegmentPaint(seg, geo, colorSource);
    for (const ch of seg.text) {
      // 逐字符累加小数位置、落地时取整，保证间距均匀且不出现半像素
      const advance = ctx.measureText(ch).width;
      glyphs.push({
        ch,
        x: Math.round(penX),
        w: Math.max(1, Math.round(advance)),
        rgb: paint.rgb,
        colorIndex: paint.colorIndex,
      });
      penX += advance + geo.letterSpacing;
      lastWasGlyph = true;
    }
  }
  return {
    glyphs,
    width: Math.max(0, lastWasGlyph ? penX - geo.letterSpacing : penX),
    fills,
  };
}

/**
 * 栅格化一组字形，返回每个源像素的覆盖率（0..255）
 *
 * 像素完美模式下会先放大到 4 倍以上再按源像素块求平均，
 * 这样 8px 这类小字号里被抗锯齿填平的 1px 缝隙才能还原。
 * 普通模式按原生尺寸栅格化，保留浏览器自己的抗锯齿。
 */
function coverageOf(
  geo: FontGeometry,
  glyphs: PlacedGlyph[],
  wSrc: number,
  hSrc: number,
  pixelPerfect: boolean,
): { cov: Uint8ClampedArray; ss: number } {
  const ss = pixelPerfect ? supersampleOf(geo.size) : 1;
  const cv = document.createElement('canvas');
  cv.width = wSrc * ss;
  cv.height = hSrc * ss;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.font = `${geo.size * ss}px "${geo.family}"`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  for (const g of glyphs) ctx.fillText(g.ch, g.x * ss, geo.ascent * ss);
  const src = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const cov = new Uint8ClampedArray(wSrc * hSrc);

  if (ss === 1) {
    for (let i = 0; i < cov.length; i++) cov[i] = src[i * 4 + 3];
    return { cov, ss };
  }

  const area = ss * ss;
  const hiW = wSrc * ss;
  for (let py = 0; py < hSrc; py++) {
    for (let px = 0; px < wSrc; px++) {
      let sum = 0;
      for (let dy = 0; dy < ss; dy++) {
        const base = ((py * ss + dy) * hiW + px * ss) * 4 + 3;
        for (let dx = 0; dx < ss; dx++) sum += src[base + dx * 4];
      }
      cov[py * wSrc + px] = sum / area;
    }
  }
  return { cov, ss };
}

/** 读取 System 图里一个 16×16 色块的像素 */
function readColorBlock(
  systemCanvas: HTMLCanvasElement,
  x: number,
  y: number,
): Uint8ClampedArray {
  const ctx = systemCanvas.getContext('2d', { willReadFrequently: true })!;
  return ctx.getImageData(x, y, 16, 16).data;
}

/**
 * 找到覆盖某个像素的字形格，返回格内坐标（0..15）
 *
 * EasyRPG 是按"字形内像素位置"从 16×16 色块取色的，这里保持同样的规则；
 * 抗锯齿溢出的像素夹到最近的格边缘，避免取到色块外。
 */
function cellCoord(glyphs: PlacedGlyph[], px: number, py: number): { dx: number; dy: number } {
  let target = glyphs[0];
  let bestDist = Infinity;
  for (const g of glyphs) {
    if (px >= g.x && px < g.x + g.w) {
      target = g;
      bestDist = 0;
      break;
    }
    const dist = px < g.x ? g.x - px : px - (g.x + g.w - 1);
    if (dist < bestDist) {
      bestDist = dist;
      target = g;
    }
  }
  return {
    dx: Math.min(15, Math.max(0, px - target.x)),
    dy: Math.min(15, Math.max(0, py)),
  };
}

/** 一层的着色方式 */
interface LayerPaint {
  /** 显式颜色；null = 按 System 色盘逐像素取色 */
  rgb: number | null;
  /** 色块在 System 图中的取样起点（rgb 为 null 时有效） */
  src: { x: number; y: number } | null;
}

/**
 * 绘制一层字形（阴影层或文字层）
 *
 * 覆盖率决定 alpha；颜色可以整层统一，也可以按像素位置从 System 色块取，
 * 和内置位图字体的着色方式完全一致。
 */
function drawLayer(
  ctx: CanvasRenderingContext2D,
  geo: FontGeometry,
  glyphs: PlacedGlyph[],
  wSrc: number,
  hSrc: number,
  originX: number,
  lineTop: number,
  pixelPerfect: boolean,
  paint: LayerPaint,
  colorSource: TextColorSource | null,
): void {
  const { cov, ss } = coverageOf(geo, glyphs, wSrc, hSrc, pixelPerfect);
  // 原生尺寸下只保留"实心核心"像素：网格对齐的点阵字体在 15px 时，
  // 核心笔画 alpha 在 224 以上，而笔画外还挂着一圈 alpha 80~140 的虚边
  // （Chrome 的抗锯齿），阈值 128 会把它们也点亮，看起来就是"字外多了像素"。
  const threshold = pixelPerfect ? (ss === 1 ? 224 : ALPHA_THRESHOLD) : 0;

  const block =
    paint.rgb === null && paint.src && colorSource
      ? readColorBlock(colorSource.systemCanvas, paint.src.x, paint.src.y)
      : null;

  const solidR = paint.rgb !== null ? (paint.rgb >> 16) & 0xff : 0;
  const solidG = paint.rgb !== null ? (paint.rgb >> 8) & 0xff : 0;
  const solidB = paint.rgb !== null ? paint.rgb & 0xff : 0;

  const out = new ImageData(wSrc, hSrc);
  const dst = out.data;
  for (let py = 0; py < hSrc; py++) {
    for (let px = 0; px < wSrc; px++) {
      let alpha = cov[py * wSrc + px];
      if (alpha === 0) continue;
      if (pixelPerfect) {
        if (alpha < threshold) continue;
        alpha = 255;
      }
      const idx = (py * wSrc + px) * 4;
      if (block) {
        const { dx, dy } = cellCoord(glyphs, px, py);
        const si = (dy * 16 + dx) * 4;
        dst[idx] = block[si];
        dst[idx + 1] = block[si + 1];
        dst[idx + 2] = block[si + 2];
      } else {
        dst[idx] = solidR;
        dst[idx + 1] = solidG;
        dst[idx + 2] = solidB;
      }
      dst[idx + 3] = alpha;
    }
  }

  const layer = document.createElement('canvas');
  layer.width = wSrc;
  layer.height = hSrc;
  layer.getContext('2d')!.putImageData(out, 0, 0);
  ctx.drawImage(layer, originX, lineTop);
}

/**
 * 绘制一行字形
 *
 * paintOf 返回每个字形的着色方式（阴影层统一、文字层逐字形）；
 * 连续相同着色的字形合成一层，避免相邻不同颜色互相串色。
 */
function drawLine(
  ctx: CanvasRenderingContext2D,
  geo: FontGeometry,
  layout: LineLayout,
  originX: number,
  lineTop: number,
  pixelPerfect: boolean,
  paintOf: (g: PlacedGlyph) => LayerPaint,
  colorSource: TextColorSource | null,
): void {
  const glyphs = layout.glyphs;
  if (glyphs.length === 0) return;
  // 阴影右下偏移 1px，多留 2px 余量避免最右侧字形被裁切
  const wSrc = Math.max(1, Math.ceil(layout.width) + 2);
  const hSrc = Math.max(1, geo.ascent + geo.descent + 1);

  const samePaint = (a: PlacedGlyph, b: PlacedGlyph) =>
    a.rgb === b.rgb && a.colorIndex === b.colorIndex;

  let start = 0;
  for (let i = 1; i <= glyphs.length; i++) {
    if (i === glyphs.length || !samePaint(glyphs[i], glyphs[start])) {
      drawLayer(
        ctx,
        geo,
        glyphs.slice(start, i),
        wSrc,
        hSrc,
        originX,
        lineTop,
        pixelPerfect,
        paintOf(glyphs[start]),
        colorSource,
      );
      start = i;
    }
  }
}

export interface CustomFontRenderOptions {
  ctx: CanvasRenderingContext2D;
  text: string;
  x: number;
  y: number;
  /** 字体设置（family 为 null 时直接返回，不绘制） */
  font: CustomFontConfig;
  /** 文字取色来源；null 时一律白色兜底、阴影黑色 */
  colorSource: TextColorSource | null;
  /** 收集 \r / \p 标出的填充区域（画布坐标） */
  onFillRegion?: (region: FillRegion) => void;
}

/** 用自定义字体绘制文字（阴影先画、文字后画，避免阴影盖住字形内部像素） */
export function renderCustomFontText(opts: CustomFontRenderOptions): void {
  const { ctx, text, x, y, font, colorSource, onFillRegion } = opts;
  if (!font.family) return;

  const geo = resolveGeometry(font);
  const lines = parseText(text);
  ctx.imageSmoothingEnabled = false;

  // 先排版所有行，顺便收集填充区域
  const rows = lines.map((line, li) => {
    const lineTop = y + li * geo.lineHeight;
    const layout = layoutLine(line, geo, colorSource);
    for (const f of layout.fills) {
      onFillRegion?.({
        x: x + f.x,
        y: lineTop - f.expandY,
        w: f.w,
        h: geo.size + f.expandY * 2,
      });
    }
    return { layout, lineTop };
  });

  // 第一趟：阴影（右下偏移 1px）
  // 有 System 配色时阴影也按像素从阴影色块取色（与内置位图字体一致）
  if (font.shadow) {
    const shadowPaint: LayerPaint = colorSource
      ? { rgb: null, src: colorSource.shadowSrcPos }
      : { rgb: 0x000000, src: null };
    for (const { layout, lineTop } of rows) {
      if (layout.glyphs.length === 0) continue;
      drawLine(ctx, geo, layout, x + 1, lineTop + 1, font.pixelPerfect, () => shadowPaint, colorSource);
    }
  }

  // 第二趟：文字
  const textPaintOf = (g: PlacedGlyph): LayerPaint =>
    g.rgb === null
      ? { rgb: null, src: colorSource ? colorSource.getColorSrcPos(g.colorIndex) : null }
      : { rgb: g.rgb, src: null };
  for (const { layout, lineTop } of rows) {
    if (layout.glyphs.length === 0) continue;
    drawLine(ctx, geo, layout, x, lineTop, font.pixelPerfect, textPaintOf, colorSource);
  }
}

/**
 * 计算自定义字体文本绘制后的总尺寸（用于自适应窗口大小）
 * 最后一行只占字盒高度（ascent + descent），不留尾部空行
 */
export function measureCustomFontTextBounds(
  text: string,
  font: CustomFontConfig,
): { width: number; height: number } {
  if (!font.family) return { width: 0, height: 0 };

  const geo = resolveGeometry(font);
  const lines = parseText(text);
  let maxW = 0;
  for (const line of lines) {
    maxW = Math.max(maxW, Math.ceil(layoutLine(line, geo, null).width));
  }
  return {
    width: maxW,
    height: (lines.length - 1) * geo.lineHeight + geo.ascent + geo.descent,
  };
}
