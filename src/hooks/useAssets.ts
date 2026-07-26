// React hook：订阅素材库变化
import { useEffect, useState } from 'react';
import { listAssets, subscribeAssets, type AssetCategory, type AssetEntry } from '../engine/assetLoader';

export function useAssets(category: AssetCategory): AssetEntry[] {
  const [assets, setAssets] = useState<AssetEntry[]>(() => listAssets(category));
  useEffect(() => {
    const unsub = subscribeAssets(() => {
      setAssets(listAssets(category));
    });
    // 同步一次，防止初始状态过期
    setAssets(listAssets(category));
    return unsub;
  }, [category]);
  return assets;
}
