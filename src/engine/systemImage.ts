// System 图渲染器：处理 160x80 System 图片，提供配色提取、背景平铺/拉伸、边框绘制
// 规则参考 docs/rendering-rules.md 第 2-4 节

import { RPG_CONSTANTS } from '../types';
import { applyTransparentColor, parseColor } from './colorUtils';
import type { LoadedImage } from '../types';

/** System 图 8 个边框子区域的源矩形 */
type Rect = { x: number; y: number; w: number; h: number };

const BORDER_RECTS = RPG_CONSTANTS.BORDER;

export class SystemImageRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private colors: string[] = [];
  private shadowColor = '#000000';
  private transparentRGB: [number, number, number] | null;
  /** 缓存的边框 tile 画布 */
  private tileCache: Map<string, HTMLCanvasElement> = new Map();

  constructor(source: LoadedImage, transparentColor: string = '#000000') {
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
    for (let n = 0; n < 20; n++) {
      const cx = (n % 10) * 16 + 8; // 块中心
      const cy = 48 + Math.floor(n / 10) * 16 + 8;
      const px = this.ctx.getImageData(cx, cy, 1, 1).data;
      this.colors.push(`rgb(${px[0]}, ${px[1]}, ${px[2]})`);
    }
    // 阴影色块位于 (16, 32)
    const sx = 16 + 8;
    const sy = 32 + 8;
    const sp = this.ctx.getImageData(sx, sy, 1, 1).data;
    this.shadowColor = `rgb(${sp[0]}, ${sp[1]}, ${sp[2]})`;
  }

  /** 获取第 N 个颜色（0-19）的 CSS 字符串；越界返回 color 0 */
  getColor(index: number): string {
    if (index < 0 || index >= 20) return this.colors[0] ?? '#000000';
    return this.colors[index];
  }

  /** 获取文字阴影色 */
  getShadowColor(): string {
    return this.shadowColor;
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

/** 边框厚度上限（参考 RPG Maker 200x System 图边框区域尺寸） */
const MAX_BORDER_THICKNESS = 16;

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
 *   四角直接取图片四个角的 borderThickness×borderThickness 区域。
 *   四条边取对应位置的源像素，按源图边长周期平铺（模拟 System 图行为），
 *   带 t/2 相位偏移使图案对称。
 */
export class InferredImageRenderer {
  private source: LoadedImage;
  private borderThickness: number;
  private tileRect: Rect;
  private transparentRGB: [number, number, number] | null;
  private processedCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private colors: string[] = [];
  private shadowColor = '#000000';
  private bgTile32: HTMLCanvasElement | null = null;

  constructor(
    source: LoadedImage,
    borderThickness: number,
    tileRect: Rect,
    transparentColor: string | null = null,
  ) {
    this.source = source;
    const sw = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const sh = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    const maxT = Math.min(MAX_BORDER_THICKNESS, Math.floor(Math.min(sw, sh) / 2));
    this.borderThickness = Math.max(0, Math.min(borderThickness, maxT));
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
    const t = this.borderThickness;
    const innerX = x + t;
    const innerY = y + t;
    const innerW = Math.max(w - t * 2, 0);
    const innerH = Math.max(h - t * 2, 0);
    if (innerW <= 0 || innerH <= 0) return;
    if (!this.bgTile32) return;

    ctx.imageSmoothingEnabled = false;
    if (stretch) {
      ctx.drawImage(this.bgTile32, 0, 0, 32, 32, innerX, innerY, innerW, innerH);
    } else {
      const pattern = ctx.createPattern(this.bgTile32, 'repeat');
      if (!pattern) return;
      ctx.save();
      ctx.translate(innerX, innerY);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, innerW, innerH);
      ctx.restore();
    }
  }

  /**
   * 绘制窗口边框
   *
   * 四角：直接取源图四个角 borderThickness×borderThickness 像素。
   * 四边：取对应位置的边框像素，按源图边长周期平铺，
   *       带 t/2 相位偏移使图案对称（模仿 System 图的 8px 偏移）。
   */
  drawBorder(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (w <= 0 || h <= 0) return;
    const t = this.borderThickness;
    if (t <= 0) return;
    ctx.imageSmoothingEnabled = false;
    const src = this.processedCanvas;
    const sw = src.width;
    const sh = src.height;

    ctx.drawImage(src, 0, 0, t, t, x, y, t, t);
    ctx.drawImage(src, sw - t, 0, t, t, x + w - t, y, t, t);
    ctx.drawImage(src, 0, sh - t, t, t, x, y + h - t, t, t);
    ctx.drawImage(src, sw - t, sh - t, t, t, x + w - t, y + h - t, t, t);

    const innerW = Math.max(w - t * 2, 0);
    const innerH = Math.max(h - t * 2, 0);

    if (innerW > 0) {
      const edgeW = Math.max(1, sw - t * 2);
      const phase = Math.floor(t / 2);
      this.tileEdge(ctx,
        { x: t, y: 0, w: edgeW, h: t },
        x + t, y, innerW, t,
        phase, 0);
      this.tileEdge(ctx,
        { x: t, y: sh - t, w: edgeW, h: t },
        x + t, y + h - t, innerW, t,
        phase, 0);
    }

    if (innerH > 0) {
      const edgeH = Math.max(1, sh - t * 2);
      const phase = Math.floor(t / 2);
      this.tileEdge(ctx,
        { x: 0, y: t, w: t, h: edgeH },
        x, y + t, t, innerH,
        0, phase);
      this.tileEdge(ctx,
        { x: sw - t, y: t, w: t, h: edgeH },
        x + w - t, y + t, t, innerH,
        0, phase);
    }
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
