// 消息窗口渲染编排器：根据配置绘制完整的消息窗口
// 规则参考 docs/rendering-rules.md

import {
  RPG_CONSTANTS,
  type MessageWindowConfig,
  type LoadedImage,
} from '../types';
import { SystemImageRenderer, InferredImageRenderer, type WindowRenderer } from './systemImage';
import { renderBitmapText, measureBitmapTextBounds, type BitmapFontId } from './bitmapFontRenderer';

/** 渲染结果 */
export interface RenderResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * 计算窗口实际尺寸（处理 standardWindow / auto / 数值 三种情况）
 */
export function computeWindowSize(config: MessageWindowConfig): { width: number; height: number } {
  if (config.standardWindow) {
    return {
      width: RPG_CONSTANTS.MESSAGE_BOX_WIDTH,
      height: RPG_CONSTANTS.MESSAGE_BOX_HEIGHT,
    };
  }
  // 自适应或数值
  const textBounds = measureBitmapTextBounds(config.text, inferDefaultFontId());
  const hasFaceSpace = config.faceMode === 'face';
  const faceWidth = hasFaceSpace
    ? config.facePosition === 'left'
      ? RPG_CONSTANTS.FACE_LEFT_MARGIN + RPG_CONSTANTS.FACE_SIZE + RPG_CONSTANTS.FACE_RIGHT_MARGIN
      : RPG_CONSTANTS.FACE_SIZE + RPG_CONSTANTS.FACE_LEFT_MARGIN
    : 0;

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

  // 最小尺寸
  width = Math.max(width, 16);
  height = Math.max(height, 16);
  return { width, height };
}

/**
 * 创建背景渲染器（System 或 推断图片）
 */
function createBackgroundRenderer(config: MessageWindowConfig): WindowRenderer | null {
  if (config.backgroundMode === 'transparent') return null;
  if (config.backgroundMode === 'system') {
    const ref = config.backgroundSystem;
    if (!ref.image) return null;
    return new SystemImageRenderer(ref.image, ref.transparentColor);
  }
  if (config.backgroundMode === 'image' && config.backgroundImage) {
    const tileRect = config.backgroundImageTileRect ?? { x: 0, y: 0, w: 32, h: 32 };
    const transparentColor = config.backgroundImageUseTransparentColor
      ? config.backgroundImageTransparentColor
      : null;
    return new InferredImageRenderer(
      config.backgroundImage,
      config.backgroundImageBorderThickness,
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
  return new SystemImageRenderer(ref.image, ref.transparentColor);
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
): void {
  if (config.faceMode !== 'face') return;
  const faceSet = config.faceSet;
  if (!faceSet.image) return;

  // 计算脸图目标坐标（contents 内）
  let faceX: number;
  let faceY: number;
  if (config.facePosition === 'left') {
    faceX = contentX + RPG_CONSTANTS.FACE_LEFT_MARGIN;
    faceY = contentY + RPG_CONSTANTS.FACE_TOP_MARGIN;
  } else {
    faceX = contentX + RPG_CONSTANTS.FACE_RIGHT_X;
    faceY = contentY + RPG_CONSTANTS.FACE_TOP_MARGIN;
  }

  // 源坐标（4x4 网格，每格 48x48）
  const idx = config.faceIndex;
  const srcX = (idx % 4) * RPG_CONSTANTS.FACE_SIZE;
  const srcY = Math.floor(idx / 4) * RPG_CONSTANTS.FACE_SIZE;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // 翻转
  if (config.faceFlipX || config.faceFlipY) {
    ctx.translate(faceX + RPG_CONSTANTS.FACE_SIZE / 2, faceY + RPG_CONSTANTS.FACE_SIZE / 2);
    ctx.scale(config.faceFlipX ? -1 : 1, config.faceFlipY ? -1 : 1);
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
function getTextStartX(config: MessageWindowConfig): number {
  if (config.faceMode === 'none') return 0;
  if (config.facePosition === 'left') {
    return RPG_CONSTANTS.FACE_LEFT_MARGIN + RPG_CONSTANTS.FACE_SIZE + RPG_CONSTANTS.FACE_RIGHT_MARGIN;
  }
  // 脸图在右：文字从 0 开始
  return 0;
}

/**
 * 渲染完整的消息窗口
 */
export function renderMessageWindow(config: MessageWindowConfig): RenderResult {
  const { width, height } = computeWindowSize(config);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  // 清空（透明）
  ctx.clearRect(0, 0, width, height);

  // 1. 绘制背景
  const bgRenderer = createBackgroundRenderer(config);
  if (bgRenderer) {
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
  drawFace(ctx, config, contentX, contentY);

  // 5. 绘制文字
  const colorRenderer = createColorRenderer(config);
  if (colorRenderer) {
    const textX = contentX + getTextStartX(config);
    const textY = contentY;

    // 始终使用位图字体（与 RPG Maker 200x 完全一致的像素渲染）
    // 着色与 EasyRPG 一致：按像素位置从 System 图色块取色（非单色填充）
    renderBitmapText({
      ctx,
      text: config.text,
      x: textX,
      y: textY,
      defaultColor: config.defaultColor,
      systemCanvas: colorRenderer.getProcessedCanvas(),
      getColorSrcPos: (idx) => colorRenderer.getColorSrcPosition(idx),
      shadowSrcPos: colorRenderer.getShadowSrcPosition(),
      fontId: inferDefaultFontId(),
    });
  }

  return { canvas, width, height };
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
function inferDefaultFontId(): BitmapFontId {
  const lang = navigator.language;

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
