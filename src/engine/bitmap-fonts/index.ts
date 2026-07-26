// 位图字体索引（自动生成）
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
