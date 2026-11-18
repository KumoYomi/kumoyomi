import { CloudflareBanner } from '@/src/components/CloudflareBanner';
import type { UpdateCheckSummary } from '@/src/core/extension/browserBridge';
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
  return (
    <>
      {progress && (
        <div className="rounded-xl border border-zinc-800 bg-[#12121a] px-4 py-3 text-xs text-zinc-300">
          Vérification ({progress.current}/{progress.total}) :{' '}
          <strong className="text-white">{progress.title}</strong>
        </div>
      )}

      {summary && (
        <div className="space-y-3">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
            Vérification terminée : {summary.checkedMangas} série(s) vérifiée(s),{' '}
            <strong>{summary.newChaptersCount} nouveau(x) chapitre(s)</strong> détecté(s).
          </div>
          {summary.errors
            .filter((e) => e.isCloudflare)
            .map((e) => {
              const src = sourceById.get(e.sourceId);
              if (!src) return null;
              return (
                <CloudflareBanner
                  key={`${e.sourceId}-${e.mangaTitle}`}
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
