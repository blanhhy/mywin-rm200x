// MyWin RM200X 类型定义

/** 标准 RPG Runtime 常量（来自 EasyRPG options.h） */
export const RPG_CONSTANTS = {
  SCREEN_WIDTH: 320,
  SCREEN_HEIGHT: 240,
  MESSAGE_BOX_WIDTH: 320,
  MESSAGE_BOX_HEIGHT: 80,
  BORDER_THICKNESS: 8, // 四边等厚
  LINE_HEIGHT: 16,
  FONT_HEIGHT: 12,
  HALF_WIDTH: 6,
  FULL_WIDTH: 12,
  TEXT_START_Y: 2, // contents 内首行 y
  MAX_LINES: 4,

  // 脸图相关（window_message.h:39-44）
  FACE_LEFT_MARGIN: 8,
  FACE_SIZE: 48,
  FACE_RIGHT_MARGIN: 16,
  FACE_TOP_MARGIN: 8,
  FACE_RIGHT_X: 248, // contents 内脸图在右的硬编码 x

  // System 图布局（160×80）
  SYSTEM_WIDTH: 160,
  SYSTEM_HEIGHT: 80,
  BG_RECT: { x: 0, y: 0, w: 32, h: 32 },
  SHADOW_COLOR_RECT: { x: 16, y: 32, w: 16, h: 16 },
  COLOR_BLOCK_SIZE: 16,
  COLOR_ROW0_Y: 48,
  COLOR_ROW1_Y: 64,

  // 边框 8 子区域（源 x,y,w,h）
  BORDER: {
    UL: { x: 32, y: 0, w: 8, h: 8 },
    TOP: { x: 40, y: 0, w: 16, h: 8 },
    UR: { x: 56, y: 0, w: 8, h: 8 },
    LEFT: { x: 32, y: 8, w: 8, h: 16 },
    RIGHT: { x: 56, y: 8, w: 8, h: 16 },
    DL: { x: 32, y: 24, w: 8, h: 8 },
    DOWN: { x: 40, y: 24, w: 16, h: 8 },
    DR: { x: 56, y: 24, w: 8, h: 8 },
  },
} as const;

/** 脸图状态 */
export type FaceMode = 'none' | 'face';
/** 'none' = 禁用（不占空间）, 'face' = 选择脸图（占空间，未选择时位置留空） */

export type FacePosition = 'left' | 'right';

export type BackgroundMode = 'transparent' | 'system' | 'image';

export type StretchMode = 'stretch' | 'tile';

export type SizeValue = number | 'auto';

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 已加载的图像资源（HTMLImageElement 或 ImageBitmap） */
export type LoadedImage = HTMLImageElement | ImageBitmap;

/** System 图引用：可以是 RTP 素材名或自定义图片 */
export interface SystemImageRef {
  /** RTP 素材名（如 "System"）或自定义文件名；为 null 表示用内置默认 */
  name: string | null;
  /** 已加载的图像 */
  image: LoadedImage | null;
  /** 透明色（CSS 颜色字符串，如 "#FF00FF"），用于将 System 图中匹配该色的像素视为透明 */
  transparentColor: string;
}

/** FaceSet 图引用 */
export interface FaceSetRef {
  name: string | null;
  image: LoadedImage | null;
}

/** 完整的窗口配置 */
export interface MessageWindowConfig {
  // === 文字设置 ===
  text: string;
  defaultColor: number; // 默认文字色 0-19

  // === 窗口设置 ===
  standardWindow: boolean; // true 时锁定为 RPG Runtime 标准尺寸/内边距
  width: SizeValue;
  height: SizeValue;
  padding: Padding;

  // === 背景设置 ===
  backgroundMode: BackgroundMode;
  /** 当 backgroundMode='system' 时使用 */
  backgroundSystem: SystemImageRef;
  /** 当 backgroundMode='image' 时使用 */
  backgroundImage: LoadedImage | null;
  backgroundImageBorderThickness: number;
  backgroundImageTileRect: { x: number; y: number; w: number; h: number } | null;
  /** 是否对推断图片启用透明色处理 */
  backgroundImageUseTransparentColor: boolean;
  /** 推断图片的透明色（通常为 PNG 调色板 idx-0），null 表示未提取到 */
  backgroundImageTransparentColor: string | null;
  backgroundStretch: StretchMode; // 默认 'stretch'

  // === 脸图设置 ===
  faceMode: FaceMode;
  faceSet: FaceSetRef;
  faceIndex: number; // 0-15
  facePosition: FacePosition;
  faceFlipX: boolean;
  faceFlipY: boolean;

  // === 配色（来自文字设置页的 System 选择器） ===
  colorSystem: SystemImageRef;
}

/** 默认配置 */
export const DEFAULT_CONFIG: MessageWindowConfig = {
  text: '你好，世界！\nHello World!',
  defaultColor: 0,

  standardWindow: true,
  width: RPG_CONSTANTS.MESSAGE_BOX_WIDTH,
  height: RPG_CONSTANTS.MESSAGE_BOX_HEIGHT,
  padding: {
    top: RPG_CONSTANTS.BORDER_THICKNESS,
    right: RPG_CONSTANTS.BORDER_THICKNESS,
    bottom: RPG_CONSTANTS.BORDER_THICKNESS,
    left: RPG_CONSTANTS.BORDER_THICKNESS,
  },

  backgroundMode: 'system',
  backgroundSystem: { name: 'System', image: null, transparentColor: '#000000' },
  backgroundImage: null,
  backgroundImageBorderThickness: 8,
  backgroundImageTileRect: null,
  backgroundImageUseTransparentColor: false,
  backgroundImageTransparentColor: null,
  backgroundStretch: 'stretch',

  faceMode: 'none',
  faceSet: { name: null, image: null },
  faceIndex: 0,
  facePosition: 'left',
  faceFlipX: false,
  faceFlipY: false,

  colorSystem: { name: 'System', image: null, transparentColor: '#000000' },
};

/** RTP 素材目录中的一项 */
export interface AssetEntry {
  name: string;
  /** 相对 assets/ 的路径，如 "RTP/System/System.png" */
  path: string;
  /** URL，可直接用于 img.src */
  url: string;
}
