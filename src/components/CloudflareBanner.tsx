import { ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import { openExternalTab } from '@/src/core/extension/browserBridge';

interface CloudflareBannerProps {
  sourceName: string;
  url: string;
  onRetry?: () => void;
  compact?: boolean;
}

export function CloudflareBanner({
  sourceName,
  url,
  onRetry,
  compact = false,
}: CloudflareBannerProps) {
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
              Le site bloque temporairement les requêtes automatiques (HTTP 403). Ouvrez le site
              dans un onglet pour valider votre session navigateur, puis revenez cliquer sur
              Réessayer.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void openExternalTab(url)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Ouvrir le site dans un onglet
          </button>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-zinc-900/70 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-zinc-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Réessayer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
