// ExFont（RPG Maker 200x 表情符号）支持
//
// RPG Maker 2000/2003 使用 $A-$Z、$a-$z 转义序列来显示特殊符号（剑、盾、笑脸等）。
// 这些符号存储在 exfont.png 中（156×48 像素，13 列 × 4 行 = 52 个 12×12 字形）。
//
// 编码方式：将 $X 转义符映射到 Unicode 私用区码点 U+F000..U+F033，
// 在渲染时从 exfont.png 提取对应的 12×12 像素区域作为 1-bit mask。
//
// 参考：EasyRPG Player src/utils.cpp:412-465 (ExFontNext)、src/font.cpp:202-210 (ExFont)

const EXFONT_URL = './exfont.png';
const EXFONT_COLS = 13;
const EXFONT_ROWS = 4;
const GLYPH_SIZE = 12; // 每个字形 12×12 像素

let exfontCanvas: HTMLCanvasElement | null = null;
let exfontCtx: CanvasRenderingContext2D | null = null;
let loadingPromise: Promise<void> | null = null;

/** ExFont 基础码点（Unicode 私用区） */
export const EXFONT_BASE = 0xf000;
/** ExFont 字形总数（26 大写 + 26 小写） */
export const EXFONT_COUNT = 52;

/** 加载 exfont.png 到内部 canvas */
export async function loadExFont(): Promise<void> {
  if (exfontCanvas) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      exfontCanvas = document.createElement('canvas');
      exfontCanvas.width = EXFONT_COLS * GLYPH_SIZE; // 156
      exfontCanvas.height = EXFONT_ROWS * GLYPH_SIZE; // 48
      exfontCtx = exfontCanvas.getContext('2d', { willReadFrequently: true })!;
      exfontCtx.imageSmoothingEnabled = false;
      exfontCtx.drawImage(img, 0, 0);
      resolve();
    };
    img.onerror = () => reject(new Error('exfont.png 加载失败'));
    img.src = EXFONT_URL;
  });

  return loadingPromise;
}

/** 检查 exfont 是否已加载 */
export function isExFontLoaded(): boolean {
  return exfontCtx !== null;
}

/** 判断码点是否为 ExFont 字形 */
export function isExFontCode(code: number): boolean {
  return code >= EXFONT_BASE && code < EXFONT_BASE + EXFONT_COUNT;
}

/**
 * 从 exfont.png 提取指定字形的 1-bit 像素数据
 *
 * @param code ExFont 码点（U+F000..U+F033）
 * @returns 12 行 × uint16 的位图数据（bit 0 = 最左列），与位图字体格式一致；未加载时返回 null
 */
export function getExFontGlyphData(code: number): Uint16Array | null {
  if (!exfontCtx || !isExFontCode(code)) return null;

  const index = code - EXFONT_BASE;
  const col = index % EXFONT_COLS;
  const row = Math.floor(index / EXFONT_COLS);
  const sx = col * GLYPH_SIZE;
  const sy = row * GLYPH_SIZE;

  const imageData = exfontCtx.getImageData(sx, sy, GLYPH_SIZE, GLYPH_SIZE);
  const pixels = imageData.data;

  const data = new Uint16Array(GLYPH_SIZE); // 12 行
  for (let y = 0; y < GLYPH_SIZE; y++) {
    let rowBits = 0;
    for (let x = 0; x < GLYPH_SIZE; x++) {
      const idx = (y * GLYPH_SIZE + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];
      // 像素"点亮"条件：不透明且偏亮
      // exfont.png 为黑底白字（黑色背景，白色字形）
      if (a > 128 && r + g + b > 384) {
        rowBits |= 1 << x;
      }
    }
    data[y] = rowBits;
  }

  return data;
}

// 模块加载时自动拉取 exfont.png（静默失败，不影响主流程）
if (typeof document !== 'undefined') {
  loadExFont().catch(() => {
    // exfont 加载失败时，$ 转义符会回退到替换字符
  });
}
