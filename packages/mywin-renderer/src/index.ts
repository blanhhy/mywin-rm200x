export * from './types/index.js';

export {
  computeWindowSize,
  loadImage,
  loadImageBitmap,
  renderMessageWindow,
  type RenderResult,
  type RenderOptions,
} from './engine/messageWindow.js';
export {
  getSystemImageRenderer,
  InferredImageRenderer,
  SystemImageRenderer,
  type WindowRenderer,
} from './engine/systemImage.js';
export {
  clearBitmapGlyphCache,
  measureBitmapTextBounds,
  parseText,
  renderBitmapText,
  type BitmapFontId,
  type BitmapTextRenderOptions,
  type FillRegion,
  type TextColorSource,
} from './engine/bitmapFontRenderer.js';
export {
  findNativePixelSize,
  measureCustomFontTextBounds,
  renderCustomFontText,
  type CustomFontRenderOptions,
} from './engine/customFontRenderer.js';
export {
  applyTransparentColor,
  parseColor,
  recommendTransparentColor,
  rgbToHex,
} from './engine/colorUtils.js';
export {
  EXFONT_BASE,
  EXFONT_COUNT,
  getExFontGlyphData,
  isExFontCode,
  isExFontLoaded,
  loadExFont,
} from './engine/exfont.js';
export {
  detectImageFormat,
  inferTransparentColor,
  inferTransparentColorFromBuffer,
  parseBMPPalette0,
  parsePNGPalette0,
  parsePalette0,
  type ImageFormat,
  type InferOptions,
} from './engine/transparentColorInference.js';
