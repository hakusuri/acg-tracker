import { useEffect, useState } from 'react';
import { pathExists, toAssetUrl } from '../lib/api';
import { CATEGORY_LABELS } from '../lib/constants';
import type { Category } from '../types';

interface Props {
  src: string;
  fallbackUrl?: string;
  category: Category;
  title: string;
  className?: string;
}

/**
 * 封面展示逻辑：
 * - 远程 URL：直接显示
 * - 本地路径：文件存在则显示本地图片；不存在或加载失败时回退到在线 URL（fallbackUrl）
 * - 都没有时显示类别占位图
 */
export default function CoverImage({ src, fallbackUrl, category, title, className }: Props) {
  const [localState, setLocalState] = useState<'checking' | 'exists' | 'missing'>('checking');
  const [failed, setFailed] = useState(false);

  const isRemote = src !== '' && /^https?:\/\//i.test(src);
  const isLocal = !isRemote && src !== '';

  useEffect(() => {
    setLocalState('checking');
    setFailed(false);
    if (!isLocal) return;
    let cancelled = false;
    void pathExists(src)
      .then((ok) => {
        if (!cancelled) setLocalState(ok ? 'exists' : 'missing');
      })
      .catch(() => {
        if (!cancelled) setLocalState('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [src, isLocal]);

  let url = '';
  if (isRemote) url = src;
  else if (isLocal && localState === 'exists') url = toAssetUrl(src);
  else if (fallbackUrl) url = fallbackUrl;

  // 本地文件加载失败时回退到在线 URL
  if (failed && fallbackUrl && url !== fallbackUrl) {
    return <img className={className} src={fallbackUrl} alt={title} loading="lazy" onError={() => setFailed(true)} />;
  }

  if (!url || failed) {
    return (
      <div className={`cover-placeholder ${className ?? ''}`} aria-label={title}>
        <span>{CATEGORY_LABELS[category]}</span>
      </div>
    );
  }
  return <img className={className} src={url} alt={title} loading="lazy" onError={() => setFailed(true)} />;
}