# @mywin/rm200x-renderer

Browser-side RPG Maker 2000/2003 message-window rendering primitives used by MyWin.

The package accepts MyWin renderer configuration and already-loaded resources. It does not read game databases, parse dialogue dump formats, access a project workspace, or depend on React.

```ts
import {
  DEFAULT_CONFIG,
  loadImage,
  loadExFont,
  renderMessageWindow,
  type MessageWindowConfig,
} from '@mywin/rm200x-renderer';

await loadExFont('/assets/exfont.png'); // Needed only for $A-$Z / $a-$z ExFont glyphs.
const systemImage = await loadImage('/game/System2.png');
const config: MessageWindowConfig = {
  ...DEFAULT_CONFIG,
  text: 'A dialogue line',
  backgroundMode: 'system',
  backgroundSystem: { ...DEFAULT_CONFIG.backgroundSystem, image: systemImage },
  colorSystem: { ...DEFAULT_CONFIG.colorSystem, image: systemImage },
};
const { canvas } = renderMessageWindow(config);
```

`MessageWindowConfig` is currently the same resource-bearing configuration used by the MyWin editor; image fields accept `HTMLImageElement` or `ImageBitmap`.

## Local development across repositories

Keep each tool in its own Git repository. While developing a consumer next to the MyWin checkout, add a local dependency such as:

```json
{
  "dependencies": {
    "@mywin/rm200x-renderer": "file:../mywin-rm200x/packages/mywin-renderer"
  }
}
```

The consuming Vite app can use the package source directly, so renderer changes do not need to be published first. The package currently ships TypeScript source and targets browser bundlers.
