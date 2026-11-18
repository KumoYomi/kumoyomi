import { ImageOff, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchImageAsBlobUrl } from '@/src/core/image-loader/blobImageLoader';

interface AntiHotlinkImageProps {
  src?: string;
  referer?: string;
  scopeId?: string;
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
  alt,
  className = '',
  placeholderClassName,
  loadingLabel,
  priority = 'high',
  showRetry = false,
  onImageLoad,
}: AntiHotlinkImageProps) {
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

    fetchImageAsBlobUrl(src, referer, scopeId, { priority })
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
  }, [src, referer, scopeId, priority, attempt]);

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
        className={`relative flex flex-col items-center justify-center gap-3 overflow-hidden border border-zinc-800/70 bg-zinc-900/75 text-zinc-300 ${boxClass}`}
      >
        <div className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-br from-zinc-800/40 via-zinc-900/20 to-rose-950/15" />
        <Loader2 className="relative h-7 w-7 animate-spin text-rose-500" />
        {loadingLabel && (
          <span className="relative px-3 text-center text-xs font-medium text-zinc-300">
            {loadingLabel}
          </span>
        )}
      </div>
    );
  }

  const resolvedSrc = blobSrc ?? (directFallback ? src : null);

  if (error || !resolvedSrc) {
    const isCfHint =
      errorMessage?.toLowerCase().includes('cloudflare') || errorMessage?.includes('403');
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 border border-zinc-800/70 bg-zinc-900/90 p-4 text-center text-xs text-zinc-400 ${boxClass}`}
      >
        <ImageOff className="h-6 w-6 text-zinc-500" />
        <span>Image bloquée ou indisponible</span>
        {isCfHint && showRetry && (
          <span className="max-w-xs text-[11px] text-amber-300/80">
            Session Cloudflare expirée ? Rechargez l’onglet du site (F5) puis cliquez sur
            Réessayer.
          </span>
        )}
        {showRetry && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setAttempt((n) => n + 1);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Réessayer
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
      onLoad={onImageLoad}
      onError={() => setError(true)}
      className={className}
    />
  );
}
