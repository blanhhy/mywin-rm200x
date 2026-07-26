/**
 * 转换 EasyRPG 位图字体 C++ 头文件为 JS 模块
 *
 * 用法：node scripts/convert-bitmap-fonts.js
 *
 * 输入：.tmp/Player/src/generated/*.h
 * 输出：src/engine/bitmap-fonts/*.ts
 *
 * 数据格式（紧凑 TypedArray）：
 *   codes:  Uint32Array — code | (is_full ? 0x10000 : 0)，按 code 升序
 *   pixels: Uint16Array — 每个字形 12 个值，平铺存储
 *
 * 查找：二分查找 codes 数组
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', '.tmp', 'Player', 'src', 'generated');
const OUT_DIR = path.join(__dirname, '..', 'src', 'engine', 'bitmap-fonts');

// 字体映射：C++ 数组名 → JS 模块名
const FONTS = [
  { file: 'bitmapfont_rmg2000.h', arrayName: 'BITMAPFONT_RMG2000', moduleName: 'rmg2000', displayName: 'RMG2000' },
  { file: 'bitmapfont_ttyp0.h', arrayName: 'BITMAPFONT_TTYP0', moduleName: 'ttyp0', displayName: 'ttyp0' },
  { file: 'shinonome_gothic.h', arrayName: 'SHINONOME_GOTHIC', moduleName: 'shinonomeGothic', displayName: 'Shinonome Gothic' },
  { file: 'shinonome_mincho.h', arrayName: 'SHINONOME_MINCHO', moduleName: 'shinonomeMincho', displayName: 'Shinonome Mincho' },
  { file: 'bitmapfont_wqy.h', arrayName: 'BITMAPFONT_WQY', moduleName: 'wqy', displayName: 'WenQuanYi' },
  { file: 'bitmapfont_baekmuk.h', arrayName: 'BITMAPFONT_BAEKMUK', moduleName: 'baekmuk', displayName: 'Baekmuk' },
];

// 正则匹配单个字形：{ code, is_full, { d0, d1, ..., d11 } }
const GLYPH_RE = /\{\s*(\d+)\s*,\s*(true|false)\s*,\s*\{\s*([\d,\s]+?)\s*\}\s*\}/g;

function parseFontFile(filePath, arrayName) {
  const content = fs.readFileSync(filePath, 'utf-8');

  const glyphs = [];
  let match;
  while ((match = GLYPH_RE.exec(content)) !== null) {
    const code = parseInt(match[1], 10);
    const isFull = match[2] === 'true';
    const data = match[3].split(',').map((s) => parseInt(s.trim(), 10));

    if (data.length !== 12) {
      throw new Error(`字形 ${code} 的数据长度不为 12：${data.length}`);
    }

    glyphs.push({ code, isFull, data });
  }

  // 按码点排序（确保二分查找正确）
  glyphs.sort((a, b) => a.code - b.code);

  return glyphs;
}

function generateTSModule(glyphs, moduleName, displayName) {
  const count = glyphs.length;

  // 生成 codes 数组（code | (is_full ? 0x10000 : 0)）
  const codesLines = [];
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const packed = g.code | (g.isFull ? 0x10000 : 0);
    codesLines.push(packed.toString());
  }

  // 生成 pixels 数组（每字形 12 个值，平铺）
  const pixelsLines = [];
  for (let i = 0; i < glyphs.length; i++) {
    pixelsLines.push(...glyphs[i].data.map((d) => d.toString()));
  }

  return `// ${displayName} 位图字体（自动生成，请勿编辑）
// 来源：EasyRPG Player src/generated/${FONTS.find((f) => f.moduleName === moduleName).file}
// 字形数量：${count}
// 格式：codes[i] = code | (is_full ? 0x10000 : 0)
//       pixels[i*12 .. i*12+11] = 12 行像素位图（LSB = 最左列）

export const ${moduleName}GlyphCount = ${count};

// 使用紧凑的数字数组，由运行时构造 TypedArray
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const _codes: number[] = [${codesLines.join(',')}];

const _pixels: number[] = [${pixelsLines.join(',')}];

export const ${moduleName}Codes: Uint32Array = new Uint32Array(_codes);
export const ${moduleName}Pixels: Uint16Array = new Uint16Array(_pixels);
`;
}

// 确保输出目录存在
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

let totalGlyphs = 0;

for (const font of FONTS) {
  const srcPath = path.join(SRC_DIR, font.file);
  if (!fs.existsSync(srcPath)) {
    console.log(`跳过（文件不存在）：${font.file}`);
    continue;
  }

  console.log(`转换 ${font.displayName} ...`);
  const glyphs = parseFontFile(srcPath, font.arrayName);
  console.log(`  ${glyphs.length} 个字形`);

  const tsContent = generateTSModule(glyphs, font.moduleName, font.displayName);
  const outPath = path.join(OUT_DIR, `${font.moduleName}.ts`);
  fs.writeFileSync(outPath, tsContent);

  const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`  → ${outPath} (${sizeKB} KB)`);

  totalGlyphs += glyphs.length;
}

// 生成索引文件
const indexContent = `// 位图字体索引（自动生成）
// 这些字体来自 EasyRPG Player，与 RPG Maker 200x 内置字体完全一致
// 每个字形为 1-bit 像素位图，渲染效果与 RPG Maker 完全相同

export interface BitmapFontData {
  name: string;
  displayName: string;
  codes: Uint32Array;
  pixels: Uint16Array;
  count: number;
}

import { rmg2000Codes, rmg2000Pixels, rmg2000GlyphCount } from './rmg2000';
import { ttyp0Codes, ttyp0Pixels, ttyp0GlyphCount } from './ttyp0';
import { shinonomeGothicCodes, shinonomeGothicPixels, shinonomeGothicGlyphCount } from './shinonomeGothic';
import { shinonomeMinchoCodes, shinonomeMinchoPixels, shinonomeMinchoGlyphCount } from './shinonomeMincho';
import { wqyCodes, wqyPixels, wqyGlyphCount } from './wqy';
import { baekmukCodes, baekmukPixels, baekmukGlyphCount } from './baekmuk';

export const BITMAP_FONTS: Record<string, BitmapFontData> = {
  rmg2000: { name: 'rmg2000', displayName: 'RMG2000', codes: rmg2000Codes, pixels: rmg2000Pixels, count: rmg2000GlyphCount },
  ttyp0: { name: 'ttyp0', displayName: 'ttyp0', codes: ttyp0Codes, pixels: ttyp0Pixels, count: ttyp0GlyphCount },
  shinonomeGothic: { name: 'shinonomeGothic', displayName: 'Shinonome Gothic', codes: shinonomeGothicCodes, pixels: shinonomeGothicPixels, count: shinonomeGothicGlyphCount },
  shinonomeMincho: { name: 'shinonomeMincho', displayName: 'Shinonome Mincho', codes: shinonomeMinchoCodes, pixels: shinonomeMinchoPixels, count: shinonomeMinchoGlyphCount },
  wqy: { name: 'wqy', displayName: 'WenQuanYi', codes: wqyCodes, pixels: wqyPixels, count: wqyGlyphCount },
  baekmuk: { name: 'baekmuk', displayName: 'Baekmuk', codes: baekmukCodes, pixels: baekmukPixels, count: baekmukGlyphCount },
};
`;

fs.writeFileSync(path.join(OUT_DIR, 'index.ts'), indexContent);
console.log(`\n完成！共转换 ${totalGlyphs} 个字形。`);
