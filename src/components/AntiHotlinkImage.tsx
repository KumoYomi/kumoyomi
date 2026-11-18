import { ImageOff, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchImageAsBlobUrl } from '@/src/core/image-loader/blobImageLoader';

interface AntiHotlinkImageProps {
  src?: string;
  referer?: string;
  scopeId?: string;
  alt: string;
  className?: string;
  showRetry?: boolean;
  onImageLoad?: () => void;
}

export function AntiHotlinkImage({
  src,
  referer,
  scopeId = 'covers',
  alt,
  className = '',
  showRetry = false,
  onImageLoad,
}: AntiHotlinkImageProps) {
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [directFallback, setDirectFallback] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(Boolean(src));
  const [error, setError] = useState<boolean>(false);
  const [attempt, setAttempt] = useState<number>(0);

  useEffect(() => {
    let active = true;
    if (!src) {
      setBlobSrc(null);
      setDirectFallback(false);
      setLoading(false);
      setError(false);
      return;
    }

    setLoading(true);
    setDirectFallback(false);
    setError(false);

    fetchImageAsBlobUrl(src, referer, scopeId)
      .then((objectUrl) => {
        if (!active) return;
        setBlobSrc(objectUrl);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        // Dernier repli : balise <img> native (Sec-Fetch-Dest: image, mode no-cors + règle DNR Referer)
        setBlobSrc(null);
        setDirectFallback(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [src, referer, scopeId, attempt]);

  if (!src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-zinc-900/90 text-zinc-600 ${className}`}
      >
        <ImageOff className="h-6 w-6 opacity-60" />
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className={`animate-pulse bg-gradient-to-br from-zinc-800/80 via-zinc-900 to-zinc-800/60 ${className}`}
      />
    );
  }

  const resolvedSrc = blobSrc ?? (directFallback ? src : null);

  if (error || !resolvedSrc) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 bg-zinc-900/90 p-3 text-center text-xs text-zinc-500 ${className}`}
      >
        <ImageOff className="h-6 w-6 text-zinc-600" />
        <span>Image bloquée ou indisponible</span>
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
