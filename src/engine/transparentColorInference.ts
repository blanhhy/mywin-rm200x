export {
  detectImageFormat,
  inferTransparentColor,
  inferTransparentColorFromBuffer,
  parseBMPPalette0,
  parsePNGPalette0,
  parsePalette0,
  type ImageFormat,
  type InferOptions,
} from '@mywin/rm200x-renderer';

/** 把 dataURL 解码为字节（用于解析图片格式与调色板） */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
