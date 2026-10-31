// System 图渲染器：处理 160x80 System 图片，提供配色提取、背景平铺/拉伸、边框绘制
// 规则参考 docs/rendering-rules.md 第 2-4 节

import { RPG_CONSTANTS } from '../types/index.js';
import { applyTransparentColor, parseColor } from './colorUtils.js';
import type { LoadedImage } from '../types/index.js';

/** System 图 8 个边框子区域的源矩形 */
type Rect = { x: number; y: number; w: number; h: number };

const BORDER_RECTS = RPG_CONSTANTS.BORDER;

let rendererIdCounter = 0;

export class SystemImageRenderer {
  readonly id: number;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private colors: string[] = [];
  /** 与 colors 对应的 0xRRGGBB 值 */
  private colorsRGB: number[] = [];
  private shadowColor = '#000000';
  private shadowRGB = 0x000000;
  private transparentRGB: [number, number, number] | null;
  /** 缓存的边框 tile 画布 */
  private tileCache: Map<string, HTMLCanvasElement> = new Map();

  constructor(source: LoadedImage, transparentColor: string = '#000000') {
    this.id = ++rendererIdCounter;
    this.transparentRGB = parseColor(transparentColor);
    this.canvas = document.createElement('canvas');
    this.canvas.width = RPG_CONSTANTS.SYSTEM_WIDTH;
    this.canvas.height = RPG_CONSTANTS.SYSTEM_HEIGHT;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法获取 2D 上下文');
    this.ctx = ctx;
    this.process(source);
  }

  private process(source: LoadedImage) {
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(source as CanvasImageSource, 0, 0);

    // 应用透明色：将匹配颜色的像素 alpha 设为 0
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    applyTransparentColor(imageData, this.transparentRGB);
    this.ctx.putImageData(imageData, 0, 0);

    // 提取 20 个配色块（每块 16x16，从 y=48 起 10x2 排列）
    this.colors = [];
    this.colorsRGB = [];
    for (let n = 0; n < 20; n++) {
      const cx = (n % 10) * 16 + 8; // 块中心
      const cy = 48 + Math.floor(n / 10) * 16 + 8;
      const px = this.ctx.getImageData(cx, cy, 1, 1).data;
      this.colors.push(`rgb(${px[0]}, ${px[1]}, ${px[2]})`);
      this.colorsRGB.push((px[0] << 16) | (px[1] << 8) | px[2]);
    }
    // 阴影色块位于 (16, 32)
    const sx = 16 + 8;
    const sy = 32 + 8;
    const sp = this.ctx.getImageData(sx, sy, 1, 1).data;
    this.shadowColor = `rgb(${sp[0]}, ${sp[1]}, ${sp[2]})`;
    this.shadowRGB = (sp[0] << 16) | (sp[1] << 8) | sp[2];
  }

  /** 获取第 N 个颜色（0-19）的 CSS 字符串；越界返回 color 0 */
  getColor(index: number): string {
    if (index < 0 || index >= 20) return this.colors[0] ?? '#000000';
    return this.colors[index];
  }

  /** 获取第 N 个颜色（0-19）的 0xRRGGBB 值；越界返回 color 0 */
  getColorRGB(index: number): number {
    if (index < 0 || index >= 20) return this.colorsRGB[0] ?? 0x000000;
    return this.colorsRGB[index];
  }

  /** 获取文字阴影色 */
  getShadowColor(): string {
    return this.shadowColor;
  }

  /** 获取文字阴影色的 0xRRGGBB 值 */
  getShadowRGB(): number {
    return this.shadowRGB;
  }

  /** 获取所有 20 色（用于 UI 展示） */
  getAllColors(): string[] {
    return [...this.colors];
  }

  /** 获取处理后画布（透明色已应用） */
  getProcessedCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * 获取第 N 个颜色块在 System 图中的取样起点（src_x, src_y）
   *
   * 与 EasyRPG 的 Font::RenderImpl 完全一致（font.cpp:877-878）：
   *   src_x = color % 10 * 16 + 2
   *   src_y = color / 10 * 16 + 48 + 16 - 12 - offset.y
   *
   * 对于 12px 位图字形 offset.y=0，因此 src_y = color / 10 * 16 + 52
   *
   * 文字每个点亮像素 (dx, dy) 对应取 System 图 (src_x + dx, src_y + dy) 的颜色。
   * 色块本身是 16×16 区域，每个像素颜色可能不同（渐变/纹理），
   * 因此必须按像素位置对应取色，不能用单色填充。
   */
  getColorSrcPosition(index: number): { x: number; y: number } {
    const safeIdx = index < 0 || index >= 20 ? 0 : index;
    const col = safeIdx % 10;
    const row = Math.floor(safeIdx / 10);
    return {
      x: col * 16 + 2,
      y: 48 + row * 16 + 4, // 16 - 12 - 0 (offset.y for bitmap fonts)
    };
  }

  /**
   * 获取阴影色块在 System 图中的取样起点
   *
   * 阴影色块位于 System 图 (16, 32)，16×16 区域（font.cpp:830, 874）
   * 与主色块不同，阴影取样无 +2 / +4 偏移
   */
  getShadowSrcPosition(): { x: number; y: number } {
    return { x: 16, y: 32 };
  }

  /**
   * 绘制窗口背景到目标 ctx
   * @param stretch true=拉伸 32x32 到全窗口；false=32 周期平铺
   */
  drawBackground(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    stretch: boolean,
  ): void {
    if (w <= 0 || h <= 0) return;
    const bg = RPG_CONSTANTS.BG_RECT;
    ctx.imageSmoothingEnabled = false;
    if (stretch) {
      // 拉伸：将 32x32 整体缩放到 w x h
      ctx.drawImage(this.canvas, bg.x, bg.y, bg.w, bg.h, x, y, w, h);
    } else {
      // 平铺：32 周期重复
      const tile = this.getTile('bg', bg);
      const pattern = ctx.createPattern(tile, 'repeat');
      if (!pattern) return;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  /**
   * 绘制窗口边框到目标 ctx
   * 4 个角直接 Blit；4 条边以 16 像素为周期平铺，带 8 像素相位偏移
   */
  drawBorder(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (w <= 0 || h <= 0) return;
    ctx.imageSmoothingEnabled = false;
    const B = BORDER_RECTS;

    // 4 个角直接 Blit
    ctx.drawImage(this.canvas, B.UL.x, B.UL.y, B.UL.w, B.UL.h, x, y, B.UL.w, B.UL.h);
    ctx.drawImage(this.canvas, B.UR.x, B.UR.y, B.UR.w, B.UR.h, x + w - 8, y, B.UR.w, B.UR.h);
    ctx.drawImage(this.canvas, B.DL.x, B.DL.y, B.DL.w, B.DL.h, x, y + h - 8, B.DL.w, B.DL.h);
    ctx.drawImage(this.canvas, B.DR.x, B.DR.y, B.DR.w, B.DR.h, x + w - 8, y + h - 8, B.DR.w, B.DR.h);

    // 4 条边平铺（带 8px 相位偏移，使图案关于窗口中线对称）
    const innerW = Math.max(w - 16, 0);
    const innerH = Math.max(h - 16, 0);
    if (innerW > 0) {
      this.tileEdge(ctx, B.TOP, x + 8, y, innerW, 8, 8, 0);
      this.tileEdge(ctx, B.DOWN, x + 8, y + h - 8, innerW, 8, 8, 0);
    }
    if (innerH > 0 && h > 16) {
      this.tileEdge(ctx, B.LEFT, x, y + 8, 8, innerH, 0, 8);
      this.tileEdge(ctx, B.RIGHT, x + w - 8, y + 8, 8, innerH, 0, 8);
    }
  }

  /**
   * 平铺一条边
   * @param srcRect 源矩形（16x8 或 8x16）
   * @param dx dy dw dh 目标矩形
   * @param ox oy 相位偏移（源坐标空间）
   */
  private tileEdge(
    ctx: CanvasRenderingContext2D,
    srcRect: Rect,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    ox: number,
    oy: number,
  ): void {
    if (dw <= 0 || dh <= 0) return;
    const tile = this.getTile(`edge_${srcRect.x}_${srcRect.y}`, srcRect);
    const pattern = ctx.createPattern(tile, 'repeat');
    if (!pattern) return;
    ctx.save();
    // 平铺相位：使源 (ox, oy) 对齐到目标 (dx, dy)
    ctx.translate(dx - ox, dy - oy);
    ctx.fillStyle = pattern;
    ctx.fillRect(ox, oy, dw, dh);
    ctx.restore();
  }

  /** 获取（或创建并缓存）一个 tile 画布 */
  private getTile(key: string, rect: Rect): HTMLCanvasElement {
    let tile = this.tileCache.get(key);
    if (tile) return tile;
    tile = document.createElement('canvas');
    tile.width = rect.w;
    tile.height = rect.h;
    const tctx = tile.getContext('2d')!;
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(this.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    this.tileCache.set(key, tile);
    return tile;
  }
}

/**
 * 推断式背景渲染器：根据一张完整窗口图片推断边框与底纹
 * 用于"根据图片推断"模式（翻译需求场景）
 *
 * 底纹处理：
 *   用户选择一个"最小重复区域"（tileRect），
 *   先将其平铺扩展为 System 图标准的 32×32 底纹单元，
 *   再按正常 System 图的"平铺/拉伸"逻辑绘制到窗口内容区。
 *
 * 边框处理：
 *   四角取图片四个角的 cornerThickness×cornerThickness 区域；
 *   四边取角框之间的条带（厚度 edgeThickness），
 *   按条带长度周期平铺，填满两角之间的窗口边缘。
 */
export class InferredImageRenderer {
  private source: LoadedImage;
  /** 角框边长（四个角同步） */
  private cornerThickness: number;
  /** 边框厚度（四条边同步） */
  private edgeThickness: number;
  private tileRect: Rect;
  private transparentRGB: [number, number, number] | null;
  private processedCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private colors: string[] = [];
  private shadowColor = '#000000';
  private bgTile32: HTMLCanvasElement | null = null;

  constructor(
    source: LoadedImage,
    cornerThickness: number,
    edgeThickness: number,
    tileRect: Rect,
    transparentColor: string | null = null,
  ) {
    this.source = source;
    const sw = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const sh = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    const half = Math.floor(Math.min(sw, sh) / 2);
    this.cornerThickness = Math.max(
      0,
      Math.min(cornerThickness, RPG_CONSTANTS.BORDER_THICKNESS, half),
    );
    // 角框会占用两端的空间，剩余部分才是可用的边条长度
    const maxEdge = Math.max(
      0,
      Math.min(
        RPG_CONSTANTS.BORDER_THICKNESS,
        Math.min(sw, sh) - this.cornerThickness * 2,
      ),
    );
    this.edgeThickness = Math.max(0, Math.min(edgeThickness, maxEdge));
    this.tileRect = tileRect;
    this.transparentRGB = transparentColor ? parseColor(transparentColor) : null;
    this.processedCanvas = document.createElement('canvas');
    this.processedCanvas.width = sw;
    this.processedCanvas.height = sh;
    const ctx = this.processedCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法获取 2D 上下文');
    this.ctx = ctx;
    this.process();
  }

  private process() {
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, this.processedCanvas.width, this.processedCanvas.height);
    this.ctx.drawImage(this.source as CanvasImageSource, 0, 0);
    if (this.transparentRGB) {
      const imageData = this.ctx.getImageData(0, 0, this.processedCanvas.width, this.processedCanvas.height);
      applyTransparentColor(imageData, this.transparentRGB);
      this.ctx.putImageData(imageData, 0, 0);
    }
    for (let i = 0; i < 20; i++) {
      this.colors.push('#ffffff');
    }
    this.buildBgTile32();
  }

  /**
   * 将最小重复区域平铺扩展为 32×32 的底纹单元
   * 与 System 图中 BG_RECT (32x32) 尺寸一致，便于后续使用相同的平铺/拉伸逻辑
   */
  private buildBgTile32() {
    const r = this.tileRect;
    const tw = Math.max(1, r.w);
    const th = Math.max(1, r.h);
    const tile32 = document.createElement('canvas');
    tile32.width = 32;
    tile32.height = 32;
    const tctx = tile32.getContext('2d')!;
    tctx.imageSmoothingEnabled = false;

    const tile = document.createElement('canvas');
    tile.width = tw;
    tile.height = th;
    const tileCtx = tile.getContext('2d')!;
    tileCtx.imageSmoothingEnabled = false;
    tileCtx.drawImage(this.processedCanvas, r.x, r.y, tw, th, 0, 0, tw, th);

    const pattern = tctx.createPattern(tile, 'repeat');
    if (!pattern) {
      this.bgTile32 = tile32;
      return;
    }
    tctx.fillStyle = pattern;
    tctx.fillRect(0, 0, 32, 32);
    this.bgTile32 = tile32;
  }

  getColor(index: number): string {
    return this.colors[index] ?? '#ffffff';
  }

  getShadowColor(): string {
    return this.shadowColor;
  }

  getAllColors(): string[] {
    return [...this.colors];
  }

  /**
   * 绘制窗口背景底纹
   *
   * 先将用户选中的最小 tile 平铺扩展为 32×32 单元（模拟 System 图底纹区域），
   * 再按 System 图的规则进行拉伸或平铺。
   * 这样无论最小 tile 多大，最终行为与 System 图完全一致。
   */
  drawBackground(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    stretch: boolean,
  ): void {
    if (w <= 0 || h <= 0) return;
    if (!this.bgTile32) return;

    // 与 System 图完全一致：底纹从窗口左上角开始铺满整个窗口，
    // 随后由边框覆盖在上层。不能内缩到边框内部才开始绘制，
    // 否则 tile 的首行像素会露在边框内侧，看起来像是底纹画在了边框下面。
    ctx.imageSmoothingEnabled = false;
    if (stretch) {
      ctx.drawImage(this.bgTile32, 0, 0, 32, 32, x, y, w, h);
    } else {
      const pattern = ctx.createPattern(this.bgTile32, 'repeat');
      if (!pattern) return;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  /**
   * 绘制窗口边框
   *
   * 四角：直接取源图四个角 cornerThickness×cornerThickness 像素。
   * 四边：取两角之间的条带（厚度 edgeThickness），按源条带长度周期平铺，
   *       目标长度 = 窗口边长 - 2×角框边长。
   * 先画四边、后画四角，接缝处由角覆盖，避免出现缝隙。
   */
  drawBorder(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (w <= 0 || h <= 0) return;
    const c = this.cornerThickness;
    const e = this.edgeThickness;
    if (c <= 0 && e <= 0) return;
    ctx.imageSmoothingEnabled = false;
    const src = this.processedCanvas;
    const sw = src.width;
    const sh = src.height;

    const innerW = Math.max(w - c * 2, 0);
    const innerH = Math.max(h - c * 2, 0);

    if (e > 0 && innerW > 0 && sw > c * 2) {
      // 上下边：源条带位于两角之间，高度为边厚
      this.tileEdge(ctx, { x: c, y: 0, w: sw - c * 2, h: e },
        x + c, y, innerW, e, 0, 0);
      this.tileEdge(ctx, { x: c, y: sh - e, w: sw - c * 2, h: e },
        x + c, y + h - e, innerW, e, 0, 0);
    }

    if (e > 0 && innerH > 0 && sh > c * 2) {
      // 左右边：源条带位于两角之间，宽度为边厚
      this.tileEdge(ctx, { x: 0, y: c, w: e, h: sh - c * 2 },
        x, y + c, e, innerH, 0, 0);
      this.tileEdge(ctx, { x: sw - e, y: c, w: e, h: sh - c * 2 },
        x + w - e, y + c, e, innerH, 0, 0);
    }

    if (c > 0) {
      ctx.drawImage(src, 0, 0, c, c, x, y, c, c);
      ctx.drawImage(src, sw - c, 0, c, c, x + w - c, y, c, c);
      ctx.drawImage(src, 0, sh - c, c, c, x, y + h - c, c, c);
      ctx.drawImage(src, sw - c, sh - c, c, c, x + w - c, y + h - c, c, c);
    }
  }

  /**
   * 以当前推断参数生成 160×80 的 System 图
   *
   * 只包含背景推断结果，遵循 RPG Maker 200x 的 System 图约定：
   *   (0, 0, 32, 32)    底纹
   *   (32, 0, 32, 32)   边框层（四角 + 四边）
   * 文字阴影块与文字配色区保持透明，不参与合成。
   *
   * 底纹与边框都直接复用推断引擎自己的绘制（drawBackground / drawBorder），
   * 分别画到两个 32×32 区域：底纹区就是 32×32 的底纹单元，边框区就是
   * 32×32 窗口的边框层。因此角框 / 边厚小于 8 时，边会平铺延伸到角框与
   * 8px 边界之间，空出来的只有远离窗口边缘的内侧部分。
   */
  buildSystemImage(): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = RPG_CONSTANTS.SYSTEM_WIDTH;
    out.height = RPG_CONSTANTS.SYSTEM_HEIGHT;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('无法获取 2D 上下文');
    ctx.imageSmoothingEnabled = false;

    // 底纹层：复用推断引擎的底纹绘制，铺满 System 的 32×32 底纹单元
    const bg = document.createElement('canvas');
    bg.width = 32;
    bg.height = 32;
    const bgCtx = bg.getContext('2d');
    if (!bgCtx) throw new Error('无法获取 2D 上下文');
    this.drawBackground(bgCtx, 0, 0, 32, 32, true);
    ctx.drawImage(bg, 0, 0);

    // 边框层：复用推断引擎的边框绘制，画到 32×32（System 边框区的大小）。
    // 角框 / 边厚小于 8 时，边会自动平铺延伸到角框与 8px 边界之间的空隙。
    const border = document.createElement('canvas');
    border.width = 32;
    border.height = 32;
    const borderCtx = border.getContext('2d');
    if (!borderCtx) throw new Error('无法获取 2D 上下文');
    this.drawBorder(borderCtx, 0, 0, 32, 32);
    ctx.drawImage(border, BORDER_RECTS.UL.x, 0);

    return out;
  }

  /** 平铺一条边（与 SystemImageRenderer.tileEdge 逻辑一致） */
  private tileEdge(
    ctx: CanvasRenderingContext2D,
    srcRect: Rect,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    ox: number,
    oy: number,
  ): void {
    if (dw <= 0 || dh <= 0) return;
    const tile = document.createElement('canvas');
    tile.width = srcRect.w;
    tile.height = srcRect.h;
    const tctx = tile.getContext('2d')!;
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(
      this.processedCanvas,
      srcRect.x, srcRect.y, srcRect.w, srcRect.h,
      0, 0, srcRect.w, srcRect.h,
    );
    const pattern = ctx.createPattern(tile, 'repeat');
    if (!pattern) return;
    ctx.save();
    ctx.translate(dx - ox, dy - oy);
    ctx.fillStyle = pattern;
    ctx.fillRect(ox, oy, dw, dh);
    ctx.restore();
  }
}

/** 渲染器联合类型 */
export type WindowRenderer = SystemImageRenderer | InferredImageRenderer;

/**
 * 共享 System 图渲染器实例
 *
 * 同一个 (图片引用, 透明色) 只创建一次渲染器。rendererId 稳定之后，位图字形缓存的
 * 键才能被复用；否则每渲染一趟都新建渲染器（rendererId 单调自增），
 * 缓存会以「每趟新增一整批、永不命中」的方式无界增长。
 */
const sharedSystemRenderers = new WeakMap<LoadedImage, Map<string, SystemImageRenderer>>();

export function getSystemImageRenderer(
  image: LoadedImage,
  transparentColor: string,
): SystemImageRenderer {
  let byColor = sharedSystemRenderers.get(image);
  if (!byColor) {
    byColor = new Map<string, SystemImageRenderer>();
    sharedSystemRenderers.set(image, byColor);
  }
  let renderer = byColor.get(transparentColor);
  if (!renderer) {
    renderer = new SystemImageRenderer(image, transparentColor);
    byColor.set(transparentColor, renderer);
  }
  return renderer;
}
