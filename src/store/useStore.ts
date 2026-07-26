// 全局状态管理（zustand）

import { create } from 'zustand';
import {
  DEFAULT_CONFIG,
  RPG_CONSTANTS,
  type MessageWindowConfig,
  type Padding,
} from '../types';

interface StoreState {
  config: MessageWindowConfig;
  /** 当前激活的设置页 */
  activeTab: 'text' | 'window' | 'background' | 'face';
  /** 是否已初始化（加载默认 System 图等） */
  initialized: boolean;

  /** 更新配置（函数式更新） */
  updateConfig: (updater: (config: MessageWindowConfig) => MessageWindowConfig) => void;
  /** 简单合并更新 */
  patchConfig: (partial: Partial<MessageWindowConfig>) => void;
  /** 设置当前 tab */
  setActiveTab: (tab: StoreState['activeTab']) => void;
  /** 重置为默认配置 */
  resetConfig: () => void;
  /** 还原窗口设置为 RPG Runtime 标准 */
  restoreStandardWindow: () => void;
  /** 标记已初始化 */
  setInitialized: (v: boolean) => void;
}

export const useStore = create<StoreState>((set) => ({
  config: {
    ...DEFAULT_CONFIG,
  },
  activeTab: 'text',
  initialized: false,

  updateConfig: (updater) =>
    set((state) => ({
      config: updater(state.config),
    })),

  patchConfig: (partial) =>
    set((state) => ({
      config: { ...state.config, ...partial },
    })),

  setActiveTab: (tab) => set({ activeTab: tab }),

  resetConfig: () =>
    set({
      config: { ...DEFAULT_CONFIG },
    }),

  restoreStandardWindow: () =>
    set((state) => ({
      config: {
        ...state.config,
        standardWindow: false,
        width: RPG_CONSTANTS.MESSAGE_BOX_WIDTH,
        height: RPG_CONSTANTS.MESSAGE_BOX_HEIGHT,
        padding: {
          top: RPG_CONSTANTS.BORDER_THICKNESS,
          right: RPG_CONSTANTS.BORDER_THICKNESS,
          bottom: RPG_CONSTANTS.BORDER_THICKNESS,
          left: RPG_CONSTANTS.BORDER_THICKNESS,
        } as Padding,
      },
    })),

  setInitialized: (v) => set({ initialized: v }),
}));
