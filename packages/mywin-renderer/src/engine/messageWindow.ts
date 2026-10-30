// 消息窗口渲染编排器：根据配置绘制完整的消息窗口
// 规则参考 docs/rendering-rules.md

import {
  RPG_CONSTANTS,
  type MessageWindowConfig,
  type LoadedImage,
  type FaceSlot,
} from '../types/index.js';
import { SystemImageRenderer, InferredImageRenderer, getSystemImageRenderer, type WindowRenderer } from './systemImage.js';
import { renderBitmapText, measureBitmapTextBounds, type BitmapFontId, type FillRegion, type TextColorSource } from './bitmapFontRenderer.js';
import { renderCustomFontText, measureCustomFontTextBounds } from './customFontRenderer.js';

export type { FillRegion };

/** 渲染结果 */
export interface RenderResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** \r / \p（mywin 专用）标出的区域：覆盖写模式下由调用方从参考图取对应像素填充 */
  fillRegions: FillRegion[];
}

export interface RenderOptions {
  /** 内置位图字体；未指定时按浏览器语言选择。 */
  defaultBitmapFontId?: BitmapFontId;
}

/**
 * 计算窗口实际尺寸（处理 standardWindow / auto / 数值 三种情况）
 */
export function computeWindowSize(
  config: MessageWindowConfig,
  options: RenderOptions = {},
): { width: number; height: number } {
  if (config.standardWindow) {
    return {
      width: RPG_CONSTANTS.MESSAGE_BOX_WIDTH,
      height: RPG_CONSTANTS.MESSAGE_BOX_HEIGHT,
    };
  }
  // 自适应或数值
  const textBounds = config.customFont.family
    ? measureCustomFontTextBounds(config.text, config.customFont)
    : measureBitmapTextBounds(config.text, resolveDefaultFontId(options.defaultBitmapFontId));
  // 左右脸图各自占用的宽度（右侧只有脸图 + 左间距，文字从 0 开始）
  const faceWidth =
    (config.faceLeft.enabled
      ? RPG_CONSTANTS.FACE_LEFT_MARGIN + RPG_CONSTANTS.FACE_SIZE + RPG_CONSTANTS.FACE_RIGHT_MARGIN
      : 0) +
    (config.faceRight.enabled
      ? RPG_CONSTANTS.FACE_SIZE + RPG_CONSTANTS.FACE_LEFT_MARGIN
      : 0);

  const padding = config.standardWindow
    ? { top: 8, right: 8, bottom: 8, left: 8 }
    : config.padding;

  let width: number;
  if (config.width === 'auto') {
    width = textBounds.width + faceWidth + padding.left + padding.right;
  } else {
    width = config.width;
  }

  let height: number;
  if (config.height === 'auto') {
    height = textBounds.height + padding.top + padding.bottom;
  } else {
    height = config.height;
  }

  // 最小尺寸（兜底用，防止极端配置出现 0 尺寸）
  width = Math.max(width, 4);
  height = Math.max(height, 4);
  return { width, height };
}

/**
 * 创建背景渲染器（System 或 推断图片）
 *
 * 透明与纯色模式没有边框，不提供渲染器，背景由 renderMessageWindow 直接处理。
 */
function createBackgroundRenderer(config: MessageWindowConfig): WindowRenderer | null {
  if (config.backgroundMode === 'transparent' || config.backgroundMode === 'solid') return null;
  if (config.backgroundMode === 'system') {
    const ref = config.backgroundSystem;
    if (!ref.image) return null;
    // 复用共享实例：rendererId 稳定，字形缓存才能命中
    return getSystemImageRenderer(ref.image, ref.transparentColor);
  }
  if (config.backgroundMode === 'image' && config.backgroundImage) {
    const corner = config.backgroundImageCornerThickness;
    // 底纹默认取角框右下角、2×2 的最小重复单位
    const tileRect = config.backgroundImageTileRect ?? { x: corner, y: corner, w: 2, h: 2 };
    const transparentColor = config.backgroundImageUseTransparentColor
      ? config.backgroundImageTransparentColor
      : null;
    return new InferredImageRenderer(
      config.backgroundImage,
      corner,
      config.backgroundImageEdgeThickness,
      tileRect,
      transparentColor,
    );
  }
  return null;
}

/**
 * 创建配色渲染器（用于文字取色）
 * 优先使用 colorSystem；若与 backgroundSystem 相同则复用
 */
function createColorRenderer(config: MessageWindowConfig): SystemImageRenderer | null {
  const ref = config.colorSystem;
  if (!ref.image) return null;
  return getSystemImageRenderer(ref.image, ref.transparentColor);
}

/**
 * 绘制脸图
 *
 * 注意：脸图不处理透明色。因为实际使用的脸图总是一个完整的 48×48 子图，
 * 即使 FaceSet 中有空白位置也不会被选中；未选择脸图时位置留空。
 */
function drawFace(
  ctx: CanvasRenderingContext2D,
  config: MessageWindowConfig,
  contentX: number,
  contentY: number,
  available: boolean,
): void {
  // 非标准窗口（实际尺寸不是 320×80）时脸图不可用，与 UI 的禁用条件保持一致
  if (!available) return;
  drawFaceSlot(ctx, config.faceLeft, 'left', contentX, contentY);
  drawFaceSlot(ctx, config.faceRight, 'right', contentX, contentY);
}

/** 绘制单侧脸图（未启用或未选择素材时留空） */
function drawFaceSlot(
  ctx: CanvasRenderingContext2D,
  slot: FaceSlot,
  position: 'left' | 'right',
  contentX: number,
  contentY: number,
): void {
  if (!slot.enabled) return;
  const faceSet = slot.faceSet;
  if (!faceSet.image) return;

  // 计算脸图目标坐标（contents 内）
  const faceX =
    contentX +
    (position === 'left' ? RPG_CONSTANTS.FACE_LEFT_MARGIN : RPG_CONSTANTS.FACE_RIGHT_X);
  const faceY = contentY + RPG_CONSTANTS.FACE_TOP_MARGIN;

  // 源坐标（4x4 网格，每格 48x48）
  const idx = slot.faceIndex;
  const srcX = (idx % 4) * RPG_CONSTANTS.FACE_SIZE;
  const srcY = Math.floor(idx / 4) * RPG_CONSTANTS.FACE_SIZE;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // 翻转
  if (slot.flipX || slot.flipY) {
    ctx.translate(faceX + RPG_CONSTANTS.FACE_SIZE / 2, faceY + RPG_CONSTANTS.FACE_SIZE / 2);
    ctx.scale(slot.flipX ? -1 : 1, slot.flipY ? -1 : 1);
    ctx.translate(-RPG_CONSTANTS.FACE_SIZE / 2, -RPG_CONSTANTS.FACE_SIZE / 2);
    ctx.drawImage(
      faceSet.image as CanvasImageSource,
      srcX,
      srcY,
      RPG_CONSTANTS.FACE_SIZE,
      RPG_CONSTANTS.FACE_SIZE,
      0,
      0,
      RPG_CONSTANTS.FACE_SIZE,
      RPG_CONSTANTS.FACE_SIZE,
    );
  } else {
    ctx.drawImage(
      faceSet.image as CanvasImageSource,
      srcX,
      srcY,
      RPG_CONSTANTS.FACE_SIZE,
      RPG_CONSTANTS.FACE_SIZE,
      faceX,
      faceY,
      RPG_CONSTANTS.FACE_SIZE,
      RPG_CONSTANTS.FACE_SIZE,
    );
  }
  ctx.restore();
}

/**
 * 计算文字起始 x（contents 内）
 */
function getTextStartX(config: MessageWindowConfig, facesAvailable: boolean): number {
  // 脸图不可用时也不预留脸图宽度，文字从内容区左边缘开始
  if (!facesAvailable) return 0;
  if (!config.faceLeft.enabled) return 0;
  return RPG_CONSTANTS.FACE_LEFT_MARGIN + RPG_CONSTANTS.FACE_SIZE + RPG_CONSTANTS.FACE_RIGHT_MARGIN;
}

/**
 * 渲染完整的消息窗口
 */
export function renderMessageWindow(
  config: MessageWindowConfig,
  options: RenderOptions = {},
): RenderResult {
  const { width, height } = computeWindowSize(config, options);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  // 清空（透明）
  ctx.clearRect(0, 0, width, height);

  // 1. 绘制背景
  const bgRenderer = createBackgroundRenderer(config);
  if (config.backgroundMode === 'solid') {
    // 纯色背景：整窗填充单一 RGB 颜色，不绘制边框
    ctx.fillStyle = config.backgroundColor;
    ctx.fillRect(0, 0, width, height);
  } else if (bgRenderer) {
    bgRenderer.drawBackground(ctx, 0, 0, width, height, config.backgroundStretch === 'stretch');
  }

  // 2. 绘制边框
  if (bgRenderer) {
    bgRenderer.drawBorder(ctx, 0, 0, width, height);
  }

  // 3. 客户区
  const padding = config.standardWindow
    ? { top: 8, right: 8, bottom: 8, left: 8 }
    : config.padding;
  const contentX = padding.left;
  const contentY = padding.top;

  // 4. 绘制脸图
  // 脸图仅在窗口实际尺寸等于 RPG 标准 320×80 时可用（与脸图页的禁用判定一致）
  const facesAvailable =
    width === RPG_CONSTANTS.MESSAGE_BOX_WIDTH && height === RPG_CONSTANTS.MESSAGE_BOX_HEIGHT;
  drawFace(ctx, config, contentX, contentY, facesAvailable);

  // 5. 绘制文字
  const fillRegions: FillRegion[] = [];
  const colorRenderer = createColorRenderer(config);
  // 没有 System 配色时传 null：文字用白色兜底、阴影用黑色
  const colorSource: TextColorSource | null = colorRenderer
    ? {
        systemCanvas: colorRenderer.getProcessedCanvas(),
        rendererId: colorRenderer.id,
        getColorSrcPos: (idx) => colorRenderer.getColorSrcPosition(idx),
        shadowSrcPos: colorRenderer.getShadowSrcPosition(),
        getColorRGB: (idx) => colorRenderer.getColorRGB(idx),
        shadowRGB: colorRenderer.getShadowRGB(),
      }
    : null;

  const textX = contentX + getTextStartX(config, facesAvailable);
  const textY = contentY;

  if (config.customFont.family) {
    // 自定义字体：字号/间距/阴影可调，12px 才用 System 色盘
    renderCustomFontText({
      ctx,
      text: config.text,
      x: textX,
      y: textY,
      font: config.customFont,
      colorSource,
      onFillRegion: (region) => fillRegions.push(region),
    });
  } else {
    // 内置位图字体：与 RPG Maker 200x 完全一致的像素渲染
    // 着色与 EasyRPG 一致：按像素位置从 System 图色块取色（非单色填充）
    renderBitmapText({
      ctx,
      text: config.text,
      x: textX,
      y: textY,
      colorSource,
      fontId: resolveDefaultFontId(options.defaultBitmapFontId),
      onFillRegion: (region) => fillRegions.push(region),
    });
  }

  return { canvas, width, height, fillRegions };
}

/**
 * 根据浏览器语言推断默认位图字体 ID
 *
 * 使用 EasyRPG 位图字体，与 RPG Maker 200x 渲染效果完全一致：
 * - 日文：Shinonome Gothic（兼容 MS Gothic）
 * - 中文：WenQuanYi（文泉驿，覆盖 CJK）
 * - 韩文：Baekmuk
 * - 其他：ttyp0（RM2000 兼容）
 */
function resolveDefaultFontId(fontId?: BitmapFontId): BitmapFontId {
  if (fontId) return fontId;
  const lang = typeof navigator === 'undefined' ? 'en' : navigator.language;

  if (lang.startsWith('ja')) {
    return 'shinonomeGothic'; // 日文：Shinonome Gothic（兼容 MS Gothic）
  }
  if (lang.startsWith('zh')) {
    return 'wqy'; // 中文：WenQuanYi（覆盖 CJK 字符集）
  }
  if (lang.startsWith('ko')) {
    return 'baekmuk'; // 韩文：Baekmuk
  }
  return 'ttyp0'; // 其他：ttyp0（RM2000 兼容，西文等宽）
}

/**
 * 异步加载图像
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

/**
 * 异步加载图像（返回 LoadedImage，优先 ImageBitmap）
 */
export async function loadImageBitmap(src: string): Promise<LoadedImage> {
  try {
    const response = await fetch(src);
    const blob = await response.blob();
    return await createImageBitmap(blob);
  } catch {
    // 回退到 HTMLImageElement
    return loadImage(src);
  }
}
