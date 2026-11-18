import { ExternalLink, Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  openExternalTab,
  requestCloudflareVerificationPopup,
} from '@/src/core/extension/browserBridge';
import { useTranslation } from '@/src/core/i18n';

interface CloudflareBannerProps {
  sourceName: string;
  url: string;
  probeUrl?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}

export function CloudflareBanner({
  sourceName,
  url,
  probeUrl,
  onRetry,
  onDismiss,
  compact = false,
}: CloudflareBannerProps) {
  const { t } = useTranslation();
  const [waitingUnlock, setWaitingUnlock] = useState(false);
  const [verifyingPopup, setVerifyingPopup] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  useEffect(() => {
    setDismissed(false);
    setWaitingUnlock(false);
    setVerifyingPopup(false);
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

  async function handleOpenPopup() {
    setVerifyingPopup(true);
    setWaitingUnlock(false);
    try {
      const res = await requestCloudflareVerificationPopup(url, { probeUrl: probeUrl ?? url });
      if (res.unlocked) {
        onRetryRef.current?.();
      }
    } finally {
      setVerifyingPopup(false);
    }
  }

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
              {t('cf.title', { source: sourceName })}
            </p>
            <p className="text-xs leading-relaxed text-amber-200/80">
              {verifyingPopup ? t('cf.descPopup') : waitingUnlock ? t('cf.descTab') : t('cf.descIdle')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={verifyingPopup}
            onClick={() => void handleOpenPopup()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-60"
          >
            {verifyingPopup ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5" />
            )}
            {verifyingPopup ? t('cf.verifying') : t('cf.openPopup')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (onRetry) setWaitingUnlock(true);
              void openExternalTab(url);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-500/20"
            title={t('cf.openTabTitle')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('cf.openTab')}
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
              {t('common.retry')}
            </button>
          )}
          <button
            type="button"
            title={t('cf.dismissAlert')}
            aria-label={t('cf.dismissAlert')}
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
