import { useLiveQuery } from 'dexie-react-hooks';
import { BookMarked, Compass, Loader2, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { navigate } from '@/src/app/router';
import { AntiHotlinkImage } from '@/src/components/AntiHotlinkImage';
import { CloudflareBanner } from '@/src/components/CloudflareBanner';
import { db } from '@/src/core/db/db';
import type { UpdateCheckSummary } from '@/src/core/extension/browserBridge';
import type { LibraryStatus } from '@/src/core/types/manga';
import { checkLibraryUpdates } from '@/src/core/updater/updateChecker';

const FILTER_TABS: Array<{ key: 'all' | LibraryStatus; label: string }> = [
  { key: 'all', label: 'Tous' },
  { key: 'reading', label: 'En lecture' },
  { key: 'plan_to_read', label: 'À lire' },
  { key: 'completed', label: 'Terminés' },
  { key: 'on_hold', label: 'En pause' },
];

export function LibraryPage() {
  const favorites =
    useLiveQuery(
      () =>
        db.mangas
          .filter((m) => m.favorite)
          .toArray()
          .then((list) => list.sort((a, b) => b.updatedAt - a.updatedAt)),
      [],
      [],
    ) ?? [];

  const allSources = useLiveQuery(() => db.sources.toArray(), [], []) ?? [];
  const sourceById = useMemo(() => new Map(allSources.map((s) => [s.id, s])), [allSources]);

  const [statusFilter, setStatusFilter] = useState<'all' | LibraryStatus>('all');
  const [titleQuery, setTitleQuery] = useState('');
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [checkProgress, setCheckProgress] = useState<{
    current: number;
    total: number;
    title: string;
  } | null>(null);
  const [updateSummary, setUpdateSummary] = useState<UpdateCheckSummary | null>(null);

  const visibleMangas = useMemo(() => {
    return favorites.filter((m) => {
      if (statusFilter !== 'all' && m.libraryStatus !== statusFilter) return false;
      if (titleQuery.trim()) {
        const q = titleQuery.trim().toLowerCase();
        return m.title.toLowerCase().includes(q);
      }
      return true;
    });
  }, [favorites, statusFilter, titleQuery]);

  async function handleCheckAllUpdates() {
    setCheckingUpdates(true);
    setUpdateSummary(null);
    setCheckProgress(null);
    try {
      const summary = await checkLibraryUpdates((current, total, title) => {
        setCheckProgress({ current, total, title });
      });
      setUpdateSummary(summary);
    } finally {
      setCheckingUpdates(false);
      setCheckProgress(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Ma Bibliothèque</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {favorites.length} série(s) suivie(s) localement dans votre navigateur.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={titleQuery}
              onChange={(e) => setTitleQuery(e.target.value)}
              placeholder="Filtrer ma bibliothèque..."
              className="rounded-xl border border-zinc-800 bg-[#12121a] py-2 pl-9 pr-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500/60 focus:outline-none"
            />
          </div>

          <button
            type="button"
            disabled={checkingUpdates || favorites.length === 0}
            onClick={() => void handleCheckAllUpdates()}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
          >
            {checkingUpdates ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Vérifier les sorties
          </button>
        </div>
      </header>

      {/* Onglets de statut */}
      <div className="flex flex-wrap gap-1.5 border-b border-zinc-800/80 pb-3">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusFilter(tab.key)}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
              statusFilter === tab.key
                ? 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30'
                : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {checkProgress && (
        <div className="rounded-xl border border-zinc-800 bg-[#12121a] px-4 py-3 text-xs text-zinc-300">
          Vérification ({checkProgress.current}/{checkProgress.total}) :{' '}
          <strong className="text-white">{checkProgress.title}</strong>
        </div>
      )}

      {updateSummary && (
        <div className="space-y-3">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
            Vérification terminée : {updateSummary.checkedMangas} série(s) vérifiée(s),{' '}
            <strong>{updateSummary.newChaptersCount} nouveau(x) chapitre(s)</strong> détecté(s).
          </div>
          {updateSummary.errors
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
                  onRetry={() => void handleCheckAllUpdates()}
                />
              );
            })}
        </div>
      )}

      {favorites.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-zinc-800 bg-[#111118] p-14 text-center">
          <BookMarked className="mx-auto h-11 w-11 text-zinc-600" />
          <h2 className="mt-4 text-lg font-semibold text-white">Votre bibliothèque est vide</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
            Ajoutez d’abord une source dans <strong>Sources & Dépôts</strong>, puis explorez les
            catalogues pour ajouter vos mangas favoris ici.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate({ name: 'sources' })}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
            >
              Configurer mes sources
            </button>
            <button
              type="button"
              onClick={() => navigate({ name: 'explore' })}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-rose-500"
            >
              <Compass className="h-4 w-4" />
              Explorer les mangas
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {visibleMangas.map((manga) => {
            const preferredSrc = manga.preferredSourceId
              ? sourceById.get(manga.preferredSourceId)
              : undefined;
            return (
              <button
                key={manga.id}
                type="button"
                onClick={() => navigate({ name: 'manga', mangaId: manga.id })}
                className="group flex flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-[#12121a] text-left transition hover:-translate-y-0.5 hover:border-rose-500/50"
              >
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-900">
                  <AntiHotlinkImage
                    src={manga.coverUrl}
                    referer={preferredSrc?.baseUrl}
                    alt={manga.title}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                  {manga.unreadCount > 0 && (
                    <span className="absolute right-2 top-2 rounded-lg bg-rose-600 px-2 py-0.5 text-xs font-bold text-white shadow">
                      {manga.unreadCount}
                    </span>
                  )}
                  {preferredSrc && (
                    <span className="absolute bottom-2 left-2 rounded-md bg-zinc-950/85 px-2 py-0.5 text-[10px] font-medium text-zinc-300 backdrop-blur">
                      {preferredSrc.name}
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <h3 className="line-clamp-2 text-sm font-semibold text-zinc-100 group-hover:text-rose-300">
                    {manga.title}
                  </h3>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
