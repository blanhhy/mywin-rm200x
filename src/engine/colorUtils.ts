// 颜色工具函数

/** 解析 CSS 颜色字符串为 RGB 三元组；仅支持 #RRGGBB / #RGB / rgb(r,g,b) */
export function parseColor(css: string): [number, number, number] | null {
  const s = css.trim().toLowerCase();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        return [r, g, b];
      }
    }
    return null;
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').map((p) => parseInt(p.trim(), 10));
    if (parts.length >= 3) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  return null;
}

/** RGB 三元组转 #RRGGBB */
export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** 推荐一个透明色（深绿或饱和度较低的深蓝） */
export function recommendTransparentColor(): string {
  return '#003300';
}

/**
 * 在 ImageData 中将匹配 transparentRGB 的像素设为 alpha=0
 */
export function applyTransparentColor(
  imageData: ImageData,
  transparentRGB: [number, number, number] | null,
): void {
  if (!transparentRGB) return;
  const [tr, tg, tb] = transparentRGB;
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === tr && data[i + 1] === tg && data[i + 2] === tb) {
      data[i + 3] = 0;
    }
  }
}
