import { ExternalLink, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { openExternalTab } from '@/src/core/extension/browserBridge';

interface CloudflareBannerProps {
  sourceName: string;
  url: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}

export function CloudflareBanner({
  sourceName,
  url,
  onRetry,
  onDismiss,
  compact = false,
}: CloudflareBannerProps) {
  const [waitingUnlock, setWaitingUnlock] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  useEffect(() => {
    setDismissed(false);
    setWaitingUnlock(false);
  }, [url, sourceName]);

  useEffect(() => {
    if (!waitingUnlock || !onRetryRef.current) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let fired = false;

    const scheduleAutoRetry = () => {
      if (fired || document.visibilityState !== 'visible') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (fired) return;
        fired = true;
        setWaitingUnlock(false);
        onRetryRef.current?.();
      }, 300);
    };

    window.addEventListener('focus', scheduleAutoRetry);
    document.addEventListener('visibilitychange', scheduleAutoRetry);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', scheduleAutoRetry);
      document.removeEventListener('visibilitychange', scheduleAutoRetry);
    };
  }, [waitingUnlock]);

  if (dismissed) return null;

  return (
    <div
      className={`rounded-xl border border-amber-500/30 bg-amber-500/10 ${
        compact ? 'p-3' : 'p-4'
      } text-amber-100`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-amber-500/20 p-2 text-amber-300">
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-200">
              Vérification Cloudflare requise sur {sourceName}
            </p>
            <p className="text-xs leading-relaxed text-amber-200/80">
              {waitingUnlock
                ? 'Onglet ouvert : validez/chargez la page dans cet onglet, gardez-le ouvert, puis revenez ici — KumoYomi relancera automatiquement.'
                : 'Ouvrez ou rechargez le site (F5) dans un onglet pour valider la session Cloudflare et gardez cet onglet ouvert.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (onRetry) setWaitingUnlock(true);
              void openExternalTab(url);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Ouvrir le site dans un onglet
          </button>
          {onRetry && (
            <button
              type="button"
              onClick={() => {
                setWaitingUnlock(false);
                onRetry();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-zinc-900/70 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-zinc-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Réessayer
            </button>
          )}
          <button
            type="button"
            title="Fermer cette alerte"
            aria-label="Fermer cette alerte"
            onClick={() => {
              setWaitingUnlock(false);
              setDismissed(true);
              onDismiss?.();
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-amber-400/20 text-amber-200/70 transition hover:bg-amber-500/20 hover:text-amber-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
