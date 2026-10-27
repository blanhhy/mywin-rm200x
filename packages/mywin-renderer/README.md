# @mywin/rm200x-renderer

Browser-side RPG Maker 2000/2003 message-window rendering primitives used by MyWin.

The package accepts a render configuration plus already-loaded resources. It does not read game
databases, parse dialogue dump formats, access a project workspace, depend on React, or ship RTP
assets.

## Boundary

In scope (all of it is `renderMessageWindow`'s dependency graph):

- 320×80 standard / custom-size message window: System image background, border, tile modes
- built-in 12px bitmap fonts (ttyp0 / Shinonome / WQY / Baekmuk) and `$A`–`$z` ExFont glyphs
- custom font rendering (size / letter spacing / line spacing / shadow / pixel perfect)
- face graphic drawing
- `\c[n]` System palette lookup plus the `\c[RRGGBB]` extension
- color helpers and transparent-color inference (`parsePalette0` for indexed PNG/BMP)

Out of scope (stays in the host app):

- picking / loading assets (RTP library, user imports, workspace folders, File System Access API)
- font registration and persistence
- project files, databases, event data
- PNG/BMP export
- React components and state

## Usage

```ts
import {
  DEFAULT_CONFIG,
  loadExFont,
  loadImage,
  parsePalette0,
  renderMessageWindow,
  type MessageWindowConfig,
} from '@mywin/rm200x-renderer';

await loadExFont('/assets/exfont.png'); // Needed only for $A-$Z / $a-$z ExFont glyphs.
const systemImage = await loadImage('/game/System/System.png');
const config: MessageWindowConfig = {
  ...DEFAULT_CONFIG,
  text: 'A dialogue line',
  backgroundSystem: { ...DEFAULT_CONFIG.backgroundSystem, image: systemImage },
  colorSystem: { ...DEFAULT_CONFIG.colorSystem, image: systemImage },
};
const { canvas } = renderMessageWindow(config);
```

`MessageWindowConfig` is resource-bearing: image fields accept `HTMLImageElement` or `ImageBitmap`.
A host that reads files itself (for example through the File System Access API) can hand over
`createImageBitmap(blob)` directly; no URL is required.

### System image transparency

`backgroundSystem.transparentColor` is the color dropped from the System image. For indexed
PNG/BMP assets the correct value is palette index 0, which the package can extract from raw bytes:

```ts
const bytes = new Uint8Array(await file.arrayBuffer());
const transparentColor = parsePalette0(bytes) ?? '#000000';
```

## Local development across repositories

Keep each tool in its own Git repository. While developing a consumer next to the MyWin checkout,
add a local dependency such as:

```json
{
  "dependencies": {
    "@mywin/rm200x-renderer": "file:../mywin-rm200x/packages/mywin-renderer"
  }
}
```

The consuming Vite app can use the package source directly, so renderer changes do not need to be
published first. The package currently ships TypeScript source and targets browser bundlers.
