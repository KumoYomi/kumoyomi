import { CloudflareBanner } from '@/src/components/CloudflareBanner';
import type { UpdateCheckSummary } from '@/src/core/extension/browserBridge';
import { useTranslation } from '@/src/core/i18n';
import type { InstalledSourceRecord } from '@/src/core/types/manga';

interface UpdateCheckStatusBannerProps {
  progress: { current: number; total: number; title: string } | null;
  summary: UpdateCheckSummary | null;
  sourceById: Map<string, InstalledSourceRecord>;
  onRetry: () => void;
}

export function UpdateCheckStatusBanner({
  progress,
  summary,
  sourceById,
  onRetry,
}: UpdateCheckStatusBannerProps) {
  const { t } = useTranslation();

  // Déduplique les alertes Cloudflare par sourceId lors des vérifications groupées
  const uniqueCfSources = summary
    ? Array.from(
        new Set(summary.errors.filter((e) => e.isCloudflare).map((e) => e.sourceId)),
      )
    : [];

  return (
    <>
      {progress && (
        <div className="rounded-xl border border-zinc-800 bg-[#12121a] px-4 py-3 text-xs text-zinc-300">
          {t('updateBanner.checking', { current: progress.current, total: progress.total })}
          <strong className="text-white">{progress.title}</strong>
        </div>
      )}

      {summary && (
        <div className="space-y-3">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
            {t('updateBanner.done', { checked: summary.checkedMangas })}
            <strong>{t('updateBanner.newCount', { count: summary.newChaptersCount })}</strong>{' '}
            {t('updateBanner.detected')}
          </div>
          {uniqueCfSources.map((sourceId) => {
            const src = sourceById.get(sourceId);
            if (!src) return null;
            return (
              <CloudflareBanner
                key={sourceId}
                sourceName={src.name}
                url={src.baseUrl}
                compact
                onRetry={onRetry}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
