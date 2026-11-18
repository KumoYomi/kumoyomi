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

  // Deduplicate Cloudflare alerts by sourceId while keeping first probeUrl
  const uniqueCfErrors = summary
    ? Array.from(
        summary.errors
          .filter((e) => e.isCloudflare)
          .reduce((map, err) => {
            if (!map.has(err.sourceId)) map.set(err.sourceId, err);
            return map;
          }, new Map<string, UpdateCheckSummary['errors'][number]>())
          .values(),
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
          {uniqueCfErrors.map((err) => {
            const src = sourceById.get(err.sourceId);
            if (!src) return null;
            return (
              <CloudflareBanner
                key={err.sourceId}
                sourceName={src.name}
                url={src.baseUrl}
                probeUrl={err.probeUrl}
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
