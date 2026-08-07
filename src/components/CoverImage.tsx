import { useState } from 'react';
import { toAssetUrl } from '../lib/api';
import { CATEGORY_LABELS } from '../lib/constants';
import type { Category } from '../types';

interface Props {
  src: string;
  category: Category;
  title: string;
  className?: string;
}

export default function CoverImage({ src, category, title, className }: Props) {
  const [failed, setFailed] = useState(false);
  const isLocal = src !== '' && !/^https?:\/\//i.test(src);
  const url = src ? (isLocal ? toAssetUrl(src) : src) : '';
  if (!url || failed) {
    return (
      <div className={`cover-placeholder ${className ?? ''}`} aria-label={title}>
        <span>{CATEGORY_LABELS[category]}</span>
      </div>
    );
  }
  return <img className={className} src={url} alt={title} loading="lazy" onError={() => setFailed(true)} />;
}