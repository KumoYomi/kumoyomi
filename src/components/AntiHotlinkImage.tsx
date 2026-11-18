import { ImageOff, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from '@/src/core/i18n';
import { fetchImageAsBlobUrl } from '@/src/core/image-loader/blobImageLoader';

interface AntiHotlinkImageProps {
  src?: string;
  referer?: string;
  scopeId?: string;
  offlineChapterId?: string;
  pageIndex?: number;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  loadingLabel?: string;
  priority?: 'high' | 'normal';
  showRetry?: boolean;
  onImageLoad?: () => void;
}

export function AntiHotlinkImage({
  src,
  referer,
  scopeId = 'covers',
  offlineChapterId,
  pageIndex,
  alt,
  className = '',
  placeholderClassName,
  loadingLabel,
  priority = 'high',
  showRetry = false,
  onImageLoad,
}: AntiHotlinkImageProps) {
  const { t } = useTranslation();
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [directFallback, setDirectFallback] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(Boolean(src));
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<number>(0);

  useEffect(() => {
    let active = true;
    if (!src) {
      setBlobSrc(null);
      setDirectFallback(false);
      setLoading(false);
      setError(false);
      setErrorMessage(null);
      return;
    }

    setLoading(true);
    setDirectFallback(false);
    setError(false);
    setErrorMessage(null);

    fetchImageAsBlobUrl(src, referer, scopeId, { priority, offlineChapterId, pageIndex })
      .then((objectUrl) => {
        if (!active) return;
        setBlobSrc(objectUrl);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setErrorMessage(err instanceof Error ? err.message : null);
        // Dernier repli : balise <img> native (Sec-Fetch-Dest: image, mode no-cors + règle DNR Referer)
        setBlobSrc(null);
        setDirectFallback(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [src, referer, scopeId, priority, offlineChapterId, pageIndex, attempt]);

  const boxClass = placeholderClassName ?? className;

  if (!src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-zinc-900/90 text-zinc-600 ${boxClass}`}
      >
        <ImageOff className="h-6 w-6 opacity-60" />
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className={`relative flex flex-col items-center justify-center gap-3 overflow-hidden border border-[var(--ky-border)] bg-[var(--ky-surface-2)] text-[var(--ky-text-secondary)] ${boxClass}`}
      >
        <div className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-br from-slate-800/35 via-transparent to-[var(--ky-accent-soft)]" />
        <Loader2 className="relative h-7 w-7 animate-spin text-[var(--ky-accent)]" />
        {loadingLabel && (
          <span className="relative px-3 text-center text-xs font-medium text-[var(--ky-text-secondary)]">
            {loadingLabel}
          </span>
        )}
      </div>
    );
  }

  const resolvedSrc = blobSrc ?? (directFallback ? src : null);

  if (error || !resolvedSrc) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 border border-[var(--ky-border)] bg-[var(--ky-surface-2)] p-4 text-center text-xs text-[var(--ky-text-muted)] ${boxClass}`}
      >
        <ImageOff className="h-6 w-6 text-[var(--ky-text-soft)]" />
        <span>{t('image.unavailable')}</span>
        {showRetry && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setAttempt((n) => n + 1);
            }}
            className="ky-btn-secondary inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('common.retry')}
          </button>
        )}
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={onImageLoad}
      onError={() => setError(true)}
      className={className}
    />
  );
}
