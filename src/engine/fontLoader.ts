// 字体文件注册
//
// 用户导入的字体文件（ttf / otf / woff / woff2）通过 FontFace API 注册到
// document.fonts，之后就能像本机字体一样用 font-family 引用。
// 注册完成后调用方才把 family 写进配置，保证随后的渲染一定用得上该字体。

let fontFaceCounter = 0;

/**
 * 把字体文件注册为可用的 font-family
 * @returns 生成的 font-family 名
 */
export async function registerFontFile(file: File): Promise<string> {
  const family = `mywin-font-${++fontFaceCounter}`;
  const face = new FontFace(family, await file.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  return family;
}
