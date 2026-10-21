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

/** 文字兜底色：白色（没有 System 配色、或字号非 12px 时使用） */
export const DEFAULT_TEXT_RGB = 0xffffff;

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

/**
 * 自定义字体设置
 *
 * family 为 null 时表示未使用自定义字体，改用内置 12px 位图字体。
 * 只有 12px 支持 System 色盘（\c[n]），其他字号一律用白色兜底，
 * 想换色只能用 \c[RRGGBB] 扩展语法。
 */
export interface CustomFontConfig {
  /** 字体来源：本机已安装字体 / 导入的字体文件 */
  source: 'local' | 'file';
  /** 展示名（本机字体为族名，文件字体为文件名） */
  label: string;
  /** CSS font-family 名；null 表示未使用自定义字体 */
  family: string | null;
  /** 字号（像素） */
  size: number;
  /** 字间距（像素，可为负） */
  letterSpacing: number;
  /** 行间距（像素，行高 = 字号 + 行间距） */
  lineSpacing: number;
  /** 是否绘制阴影 */
  shadow: boolean;
  /**
   * 像素完美模式：超采样后按源像素块二值化
   * 只对"设计网格与画布像素整数对齐"的像素字体有用（如 8px 点阵字体），
   * 普通轮廓字体请保持关闭，否则抗锯齿边缘会被整块丢弃，导致缺笔画。
   */
  pixelPerfect: boolean;
}

/** 已添加到字体选择器列表的字体条目 */
export interface CustomFontEntry {
  /** 字体来源：本机已安装字体 / 导入的字体文件 */
  source: 'local' | 'file';
  /** 展示名（本机字体为族名，文件字体为文件名） */
  label: string;
  /** CSS font-family 名 */
  family: string;
}

/** 完整的窗口配置 */
export interface MessageWindowConfig {
  // === 文字设置 ===
  text: string;
  /** 自定义字体设置（family 为 null 时使用内置位图字体） */
  customFont: CustomFontConfig;

  // === 窗口设置 ===
  standardWindow: boolean; // true 时锁定为 RPG Runtime 标准尺寸/内边距
  /** 跟随替换模式的目标图片：宽高记录随选中的图片更新，仅保留内边距可调 */
  followTargetPicture: boolean;
  width: SizeValue;
  height: SizeValue;
  padding: Padding;

  // === 背景设置 ===
  backgroundMode: BackgroundMode;
  /** 当 backgroundMode='system' 时使用 */
  backgroundSystem: SystemImageRef;
  /** 当 backgroundMode='image' 时使用 */
  backgroundImage: LoadedImage | null;
  /** 四角角框的边长（正方形，所有角同步） */
  backgroundImageCornerThickness: number;
  /** 四边边框的厚度（四条边同步） */
  backgroundImageEdgeThickness: number;
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
  customFont: {
    source: 'local',
    label: '',
    family: null,
    size: RPG_CONSTANTS.FONT_HEIGHT,
    letterSpacing: 0,
    lineSpacing: 4,
    shadow: true,
    pixelPerfect: false,
  },

  standardWindow: true,
  followTargetPicture: false,
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
  backgroundImageCornerThickness: 8,
  backgroundImageEdgeThickness: 6,
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
