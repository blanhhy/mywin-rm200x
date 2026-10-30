// 图片参数随图片保存 / 读取
//
// 存在 Picture/.mywin/<完整文件名>.json 中，按图片完整文件名区分。
// 只记录对这张图真正生效的信息：
//   - 内置位图字体（family 为 null）时省略字体参数，此时字号/间距等不可调
//   - 标准窗口时省略宽高与内边距，运行时被锁定
//   - 背景只记录当前模式用到的字段
//   - 未启用（或窗口尺寸下不可用）的脸图槽位省略
// 覆盖图片时同名参数会被一并覆盖；图片被单独删除时参数会成为孤儿，
// 由后续的全量清理功能处理。

import { computeWindowSize, loadImage } from './messageWindow';
import { listAssets, resolveAssetUrl, type AssetCategory } from './assetLoader';
import { ensureFontLoaded } from './fontLoader';
import {
  readPictureDataUrlByName,
  readPictureMetaFile,
  writePictureMetaFile,
  type Workspace,
} from './workspace';
import {
  DEFAULT_CONFIG,
  RPG_CONSTANTS,
  type CustomFontConfig,
  type FaceSlot,
  type MessageWindowConfig,
  type Padding,
  type StretchMode,
  type SystemImageRef,
} from '../types';

const META_VERSION = 2;

// === 序列化结构 ===

/** 素材引用（记录来源与路径，便于在同名消歧后仍能找回原素材） */
export interface SerializedAssetRef {
  name: string | null;
  source: 'builtin' | 'user' | 'workspace' | null;
  path: string;
  /** System 图的透明色 */
  transparentColor?: string;
}

/** 背景参考图片：只有工作区 Picture 里的图能按文件名找回 */
export type SerializedBackgroundImage =
  | { kind: 'workspacePicture'; fileName: string }
  | { kind: 'placeholder' };

export interface SerializedFaceSlot {
  faceSet: SerializedAssetRef;
  faceIndex: number;
  flipX: boolean;
  flipY: boolean;
}

/** 背景：只保留当前模式用得到的字段 */
export type SerializedBackground =
  | { mode: 'transparent' }
  | { mode: 'system'; system: SerializedAssetRef; stretch: StretchMode }
  | {
      mode: 'image';
      image: SerializedBackgroundImage;
      cornerThickness: number;
      edgeThickness: number;
      /** 省略表示沿用默认：角框右下角的 2×2 */
      tileRect?: { x: number; y: number; w: number; h: number };
      /** 仅在启用透明色时记录 */
      transparentColor?: string;
      stretch: StretchMode;
    };

/** 随图片保存的完整参数 */
export interface PictureMeta {
  version: typeof META_VERSION;
  savedAt: number;
  text: string;
  /** 省略表示内置位图字体 */
  customFont?: CustomFontConfig;
  standardWindow: boolean;
  /** 仅非标准窗口时记录（标准窗口下尺寸与内边距被锁定） */
  width?: number;
  height?: number;
  padding?: Padding;
  background: SerializedBackground;
  /** 省略表示该侧未启用 */
  faceLeft?: SerializedFaceSlot;
  faceRight?: SerializedFaceSlot;
  colorSystem: SerializedAssetRef;
}

/** 读取素材来源信息；找不到时 source/path 留空 */
function serializeAssetRef(category: AssetCategory, name: string | null): SerializedAssetRef {
  if (!name) return { name: null, source: null, path: '' };
  const asset = listAssets(category).find((a) => a.name === name);
  return {
    name,
    source: asset?.source ?? null,
    path: asset?.path ?? '',
  };
}

function serializeSystemRef(ref: SystemImageRef): SerializedAssetRef {
  return {
    ...serializeAssetRef('System', ref.name),
    transparentColor: ref.transparentColor,
  };
}

function serializeFaceSlot(slot: FaceSlot): SerializedFaceSlot {
  return {
    faceSet: serializeAssetRef('FaceSet', slot.faceSet.name),
    faceIndex: slot.faceIndex,
    flipX: slot.flipX,
    flipY: slot.flipY,
  };
}

function serializeBackground(
  config: MessageWindowConfig,
  backgroundImageFileName: string | null,
): SerializedBackground {
  if (config.backgroundMode === 'system') {
    return {
      mode: 'system',
      system: serializeSystemRef(config.backgroundSystem),
      stretch: config.backgroundStretch,
    };
  }
  // 选了图片模式但没有图片时，实际渲染与透明一致，按透明记录
  if (config.backgroundMode === 'image' && config.backgroundImage) {
    return {
      mode: 'image',
      image: backgroundImageFileName
        ? { kind: 'workspacePicture', fileName: backgroundImageFileName }
        : { kind: 'placeholder' },
      cornerThickness: config.backgroundImageCornerThickness,
      edgeThickness: config.backgroundImageEdgeThickness,
      ...(config.backgroundImageTileRect
        ? { tileRect: { ...config.backgroundImageTileRect } }
        : {}),
      ...(config.backgroundImageUseTransparentColor && config.backgroundImageTransparentColor
        ? { transparentColor: config.backgroundImageTransparentColor }
        : {}),
      stretch: config.backgroundStretch,
    };
  }
  return { mode: 'transparent' };
}

/**
 * 由当前配置生成要保存的参数
 * @param backgroundImageFileName 背景参考图片若来自工作区 Picture，传入其文件名
 */
export function buildPictureMeta(
  config: MessageWindowConfig,
  backgroundImageFileName: string | null,
): PictureMeta {
  const { width, height } = computeWindowSize(config);
  // 脸图只在窗口实际尺寸等于 RPG 标准 320×80 时参与渲染
  const facesAvailable =
    width === RPG_CONSTANTS.MESSAGE_BOX_WIDTH && height === RPG_CONSTANTS.MESSAGE_BOX_HEIGHT;

  return {
    version: META_VERSION,
    savedAt: Date.now(),
    text: config.text,
    ...(config.customFont.family ? { customFont: { ...config.customFont } } : {}),
    standardWindow: config.standardWindow,
    ...(config.standardWindow ? {} : { width, height, padding: { ...config.padding } }),
    background: serializeBackground(config, backgroundImageFileName),
    ...(facesAvailable && config.faceLeft.enabled
      ? { faceLeft: serializeFaceSlot(config.faceLeft) }
      : {}),
    ...(facesAvailable && config.faceRight.enabled
      ? { faceRight: serializeFaceSlot(config.faceRight) }
      : {}),
    colorSystem: serializeSystemRef(config.colorSystem),
  };
}

// === 保存 / 读取 ===

/** 保存参数文件；失败不抛出（调用方只需知道图片已写入） */
export async function savePictureMeta(
  workspace: Workspace,
  fileName: string,
  meta: PictureMeta,
): Promise<void> {
  await writePictureMetaFile(workspace, fileName, JSON.stringify(meta));
}

/** 该图片是否有随图保存的参数（用于删除前确认是否一并清除） */
export async function pictureMetaExists(
  workspace: Workspace,
  fileName: string,
): Promise<boolean> {
  return (await readPictureMetaFile(workspace, fileName)) !== null;
}

/** 读取参数文件，不存在或格式不符返回 null */
export async function readPictureMeta(
  workspace: Workspace,
  fileName: string,
): Promise<PictureMeta | null> {
  const raw = await readPictureMetaFile(workspace, fileName);
  if (!raw) return null;
  try {
    const meta = JSON.parse(raw) as PictureMeta;
    if (!meta || meta.version !== META_VERSION) return null;
    return meta;
  } catch {
    return null;
  }
}

// === 恢复 ===

export interface RestoredPictureMeta {
  /** 需要合并进 store.config 的字段 */
  config: Partial<MessageWindowConfig>;
  /** 背景参考图片对应的 Picture 文件名（非工作区图片为 null） */
  backgroundImageFileName: string | null;
  /** 恢复过程中遇到的问题（素材缺失等） */
  warnings: string[];
}

/** 在素材列表里按来源/路径优先、其次按名字查找 */
function findAssetByRef(category: AssetCategory, ref: SerializedAssetRef) {
  const list = listAssets(category);
  const bySourceAndPath = list.find(
    (a) => ref.source !== null && a.source === ref.source && ref.path && a.path === ref.path,
  );
  if (bySourceAndPath) return bySourceAndPath;
  const byName = list.find((a) => a.name === ref.name);
  if (byName) return byName;
  // 名字可能带有消歧后缀（如 "System.png"），去掉后缀再试一次
  const base = ref.name?.replace(/\.[^.]+$/, '') ?? '';
  return list.find((a) => a.name === base) ?? null;
}

async function restoreSystemRef(
  ref: SerializedAssetRef,
  warnings: string[],
): Promise<SystemImageRef> {
  const fallback: SystemImageRef = {
    name: ref.name,
    image: null,
    transparentColor: ref.transparentColor ?? '#000000',
  };
  if (!ref.name) return fallback;
  const asset = findAssetByRef('System', ref);
  if (!asset) {
    warnings.push(`未找到素材「${ref.name}」`);
    return fallback;
  }
  try {
    const image = await loadImage(await resolveAssetUrl(asset));
    return { name: asset.name, image, transparentColor: ref.transparentColor ?? '#000000' };
  } catch {
    warnings.push(`无法加载素材「${ref.name}」`);
    return fallback;
  }
}

function emptyFaceSlot(): FaceSlot {
  return { ...DEFAULT_CONFIG.faceLeft, faceSet: { ...DEFAULT_CONFIG.faceLeft.faceSet } };
}

async function restoreFaceSlot(
  slot: SerializedFaceSlot,
  warnings: string[],
): Promise<FaceSlot> {
  const base: FaceSlot = {
    ...emptyFaceSlot(),
    enabled: true,
    faceSet: { name: slot.faceSet.name, image: null },
    faceIndex: slot.faceIndex,
    flipX: slot.flipX,
    flipY: slot.flipY,
  };
  if (!slot.faceSet.name) return base;
  const asset = findAssetByRef('FaceSet', slot.faceSet);
  if (!asset) {
    warnings.push(`未找到脸图集「${slot.faceSet.name}」`);
    return base;
  }
  try {
    const image = await loadImage(await resolveAssetUrl(asset));
    return { ...base, faceSet: { name: asset.name, image } };
  } catch {
    warnings.push(`无法加载脸图集「${slot.faceSet.name}」`);
    return base;
  }
}

/**
 * 把保存的参数还原成可直接合并进 config 的字段
 * 需要工作区来读取背景参考图片
 */
export async function buildConfigFromMeta(
  meta: PictureMeta,
  workspace: Workspace,
): Promise<RestoredPictureMeta> {
  const warnings: string[] = [];

  // 字体：省略时即内置位图字体；导入的字体文件需要重新注册
  let customFont: CustomFontConfig = DEFAULT_CONFIG.customFont;
  if (meta.customFont) {
    customFont = { ...DEFAULT_CONFIG.customFont, ...meta.customFont };
    if (customFont.family && customFont.source === 'file') {
      try {
        await ensureFontLoaded(customFont.family);
      } catch {
        warnings.push(`无法加载字体「${customFont.label || customFont.family}」`);
        customFont = { ...customFont, family: null };
      }
    }
  }

  // 背景
  const background: Partial<MessageWindowConfig> = {};
  let backgroundImageFileName: string | null = null;
  if (meta.background.mode === 'system') {
    background.backgroundMode = 'system';
    background.backgroundSystem = await restoreSystemRef(meta.background.system, warnings);
    background.backgroundStretch = meta.background.stretch;
  } else if (meta.background.mode === 'image') {
    background.backgroundMode = 'image';
    background.backgroundImageCornerThickness = meta.background.cornerThickness;
    background.backgroundImageEdgeThickness = meta.background.edgeThickness;
    background.backgroundImageTileRect = meta.background.tileRect ?? null;
    background.backgroundImageUseTransparentColor = meta.background.transparentColor !== undefined;
    background.backgroundImageTransparentColor = meta.background.transparentColor ?? null;
    background.backgroundStretch = meta.background.stretch;

    if (meta.background.image.kind === 'workspacePicture') {
      const fileName = meta.background.image.fileName;
      const dataUrl = await readPictureDataUrlByName(workspace, fileName);
      if (dataUrl) {
        try {
          background.backgroundImage = await loadImage(dataUrl);
          backgroundImageFileName = fileName;
        } catch {
          background.backgroundImage = null;
          warnings.push(`无法加载背景参考 ${fileName}`);
        }
      } else {
        background.backgroundImage = null;
        warnings.push(`未找到背景参考 ${fileName}`);
      }
    } else {
      background.backgroundImage = null;
      warnings.push('背景参考需要重新选择');
    }
  } else {
    background.backgroundMode = 'transparent';
  }

  const [faceLeft, faceRight, colorSystem] = await Promise.all([
    meta.faceLeft ? restoreFaceSlot(meta.faceLeft, warnings) : emptyFaceSlot(),
    meta.faceRight ? restoreFaceSlot(meta.faceRight, warnings) : emptyFaceSlot(),
    restoreSystemRef(meta.colorSystem, warnings),
  ]);

  return {
    config: {
      text: meta.text,
      customFont,
      standardWindow: meta.standardWindow,
      followTargetPicture: false,
      // 标准窗口下宽高与内边距被锁定，保存时已省略
      ...(meta.standardWindow
        ? {}
        : {
            width: meta.width ?? DEFAULT_CONFIG.width,
            height: meta.height ?? DEFAULT_CONFIG.height,
            padding: meta.padding ?? { ...DEFAULT_CONFIG.padding },
          }),
      ...background,
      faceLeft,
      faceRight,
      colorSystem,
    },
    backgroundImageFileName,
    warnings,
  };
}
