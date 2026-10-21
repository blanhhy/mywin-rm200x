// 自定义字体渲染器
//
// 用户可以选择本机已安装字体或导入字体文件，替代内置的 12px 位图字体。
// 与位图字体渲染的差异：
//   - 字号、字间距、行间距、阴影开关可调
//   - 默认直接 fillText，保留浏览器自身的抗锯齿与微调（适用绝大多数字体）
//   - 可选的"像素完美"模式：超采样栅格化后按源像素块二值化，
//     专门给"设计网格与画布像素对齐"的像素字体用
//     （这类字体在原生字号下会被抗锯齿填平 1px 缝隙）
//   - 只有 12px 能用 System 色盘（\c[n]）；其他字号一律白色兜底，
//     想换色只能用 \c[RRGGBB] 扩展语法

import { RPG_CONSTANTS, DEFAULT_TEXT_RGB, type CustomFontConfig } from '../types';
import { parseText, type FillRegion, type TextColorSource } from './bitmapFontRenderer';

/** 解析出的行类型（复用 bitmapFontRenderer 的解析结果，不额外导出内部类型） */
type ParsedLine = ReturnType<typeof parseText>[number];

/** 掩码阈值：覆盖率 ≥ 该值算作被点亮的像素（保证 1-bit 输出） */
const ALPHA_THRESHOLD = 128;

/**
 * 超采样：把字形放大到至少这么多像素再栅格化
 *
 * 小字号下浏览器是按轮廓栅格化并开抗锯齿的（还会跑 TrueType 微调指令），
 * 1 像素宽的缝隙会被填平成实心块——像素字体在 8px 下直接渲染就是这个下场。
 * 放大到 32px 以上再按源像素块取平均，就能把设计网格还原出来。
 */
const SUPERSAMPLE_MIN = 4;
const SUPERSAMPLE_TARGET_PX = 32;

function supersampleOf(size: number): number {
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

/** 落地字形：x 为整数像素位置，rgb 为已解析好的颜色 */
interface PlacedGlyph {
  ch: string;
  x: number;
  rgb: number;
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
  const ascent = Math.ceil(metrics.fontBoundingBoxAscent ?? size * 0.8);
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
 * 解析某一段文字的颜色
 * \c[RRGGBB] 显式颜色优先；否则只有 12px 能查 System 色盘，其余一律白色
 */
function resolveSegmentColor(
  rgb: number | undefined,
  colorIndex: number,
  geo: FontGeometry,
  colorSource: TextColorSource | null,
): number {
  if (rgb !== undefined) return rgb;
  if (colorSource && geo.size === RPG_CONSTANTS.FONT_HEIGHT) {
    return colorSource.getColorRGB(colorIndex);
  }
  return DEFAULT_TEXT_RGB;
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
    const rgb = resolveSegmentColor(seg.rgb, seg.color, geo, colorSource);
    for (const ch of seg.text) {
      glyphs.push({ ch, x: Math.round(penX), rgb });
      // 逐字符累加小数位置、落地时取整，保证间距均匀且不出现半像素
      penX += ctx.measureText(ch).width + geo.letterSpacing;
      lastWasGlyph = true;
    }
  }
  return {
    glyphs,
    width: Math.max(0, lastWasGlyph ? penX - geo.letterSpacing : penX),
    fills,
  };
}

/** 0xRRGGBB → CSS 颜色 */
function cssOf(rgb: number): string {
  return `rgb(${(rgb >> 16) & 0xff}, ${(rgb >> 8) & 0xff}, ${rgb & 0xff})`;
}

/** 把一组字形放大 ss 倍栅格化，返回超采样掩码 */
function rasterizeHi(
  geo: FontGeometry,
  glyphs: PlacedGlyph[],
  wSrc: number,
  hSrc: number,
  ss: number,
): ImageData {
  const hi = document.createElement('canvas');
  hi.width = wSrc * ss;
  hi.height = hSrc * ss;
  const ctx = hi.getContext('2d', { willReadFrequently: true })!;
  ctx.font = `${geo.size * ss}px "${geo.family}"`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  for (const g of glyphs) ctx.fillText(g.ch, g.x * ss, geo.ascent * ss);
  return ctx.getImageData(0, 0, hi.width, hi.height);
}

/**
 * 把超采样掩码按源像素块求平均并二值化，整块填入同一颜色
 *
 * 只对"设计网格与画布像素整数对齐"的像素字体有意义：这种字体在原生字号下
 * 每个设计像素正好是一个画布像素，但它在小字号下是按轮廓 + 抗锯齿栅格化的，
 * 1 像素宽的缝隙会被填平、笔画会粘连。放大后按块平均才能还原设计网格。
 *
 * 对普通轮廓字体不能这么做——抗锯齿的边缘像素正是字形的一部分，
 * 按 50% 阈值整块丢弃会导致笔画变细、断线、缺像素。
 */
function thresholdMask(hi: ImageData, ss: number, rgb: number): ImageData {
  const w = Math.floor(hi.width / ss);
  const h = Math.floor(hi.height / ss);
  const out = new ImageData(w, h);
  const src = hi.data;
  const dst = out.data;
  const area = ss * ss;
  const hiW = hi.width;
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      let sum = 0;
      for (let dy = 0; dy < ss; dy++) {
        const base = ((py * ss + dy) * hiW + px * ss) * 4 + 3;
        for (let dx = 0; dx < ss; dx++) sum += src[base + dx * 4];
      }
      if (sum / area < ALPHA_THRESHOLD) continue;
      const idx = (py * w + px) * 4;
      dst[idx] = r;
      dst[idx + 1] = g;
      dst[idx + 2] = b;
      dst[idx + 3] = 255;
    }
  }
  return out;
}

/** 像素完美模式：把一组字形着色成单色后贴到目标画布 */
function drawPixelGlyphs(
  ctx: CanvasRenderingContext2D,
  geo: FontGeometry,
  glyphs: PlacedGlyph[],
  wSrc: number,
  hSrc: number,
  originX: number,
  lineTop: number,
  rgb: number,
): void {
  const ss = supersampleOf(geo.size);
  const mask = document.createElement('canvas');
  mask.width = wSrc;
  mask.height = hSrc;
  mask
    .getContext('2d')!
    .putImageData(thresholdMask(rasterizeHi(geo, glyphs, wSrc, hSrc, ss), ss, rgb), 0, 0);
  ctx.drawImage(mask, originX, lineTop);
}

/**
 * 绘制一行字形
 *
 * forcedRGB 为 null 时按每个字形自己的颜色绘制（文字层），否则整行统一用该色（阴影层）。
 */
function drawLine(
  ctx: CanvasRenderingContext2D,
  geo: FontGeometry,
  layout: LineLayout,
  originX: number,
  lineTop: number,
  pixelPerfect: boolean,
  forcedRGB: number | null,
): void {
  const glyphs = layout.glyphs;

  if (!pixelPerfect) {
    // 直接绘制：交给浏览器栅格化，保留抗锯齿
    ctx.font = fontSpec(geo);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let current = -1;
    for (const g of glyphs) {
      const rgb = forcedRGB ?? g.rgb;
      if (rgb !== current) {
        ctx.fillStyle = cssOf(rgb);
        current = rgb;
      }
      ctx.fillText(g.ch, originX + g.x, lineTop + geo.ascent);
    }
    return;
  }

  // 像素完美模式：宽高多留 2px 余量，避免最右侧字形或阴影被裁切
  const wSrc = Math.max(1, Math.ceil(layout.width) + 2);
  const hSrc = Math.max(1, geo.ascent + geo.descent + 1);

  if (forcedRGB !== null) {
    drawPixelGlyphs(ctx, geo, glyphs, wSrc, hSrc, originX, lineTop, forcedRGB);
    return;
  }

  // 按连续同色字形分组：一张掩码只能填一种颜色
  let start = 0;
  for (let i = 1; i <= glyphs.length; i++) {
    if (i === glyphs.length || glyphs[i].rgb !== glyphs[start].rgb) {
      drawPixelGlyphs(ctx, geo, glyphs.slice(start, i), wSrc, hSrc, originX, lineTop, glyphs[start].rgb);
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
  if (font.shadow) {
    const shadowRGB = colorSource ? colorSource.shadowRGB : 0x000000;
    for (const { layout, lineTop } of rows) {
      if (layout.glyphs.length === 0) continue;
      drawLine(ctx, geo, layout, x + 1, lineTop + 1, font.pixelPerfect, shadowRGB);
    }
  }

  // 第二趟：文字
  for (const { layout, lineTop } of rows) {
    if (layout.glyphs.length === 0) continue;
    drawLine(ctx, geo, layout, x, lineTop, font.pixelPerfect, null);
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
