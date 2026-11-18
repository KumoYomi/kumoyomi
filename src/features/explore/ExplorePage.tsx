import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertCircle,
  Compass,
  FolderGit2,
  Layers,
  Loader2,
  Search,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '@/src/app/router';
import { AntiHotlinkImage } from '@/src/components/AntiHotlinkImage';
import { CloudflareBanner } from '@/src/components/CloudflareBanner';
import { db, normalizeMangaKey } from '@/src/core/db/db';
import { upsertMangaFromCatalogueItem } from '@/src/core/db/mangaRepository';
import { parserEngine } from '@/src/core/parser/engine';
import { CloudflareChallengeError } from '@/src/core/parser/httpClient';
import type { InstalledSourceRecord } from '@/src/core/types/manga';
import type { ParsedCatalogueItem } from '@/src/core/types/source';

interface ExplorePageProps {
  initialSourceId?: string;
  initialQuery?: string;
}

interface SourceSearchState {
  source: InstalledSourceRecord;
  status: 'loading' | 'done' | 'cloudflare' | 'error';
  items: ParsedCatalogueItem[];
  errorMessage?: string;
  cloudflareUrl?: string;
}

interface GroupedSearchResult {
  normalizedKey: string;
  title: string;
  coverUrl?: string;
  referer?: string;
  entries: Array<{ sourceName: string; item: ParsedCatalogueItem }>;
}

export function ExplorePage({ initialSourceId, initialQuery }: ExplorePageProps) {
  const allSources = useLiveQuery(() => db.sources.toArray(), [], []) ?? [];
  const enabledSources = useMemo(() => allSources.filter((s) => s.enabled), [allSources]);
  const sourceById = useMemo(
    () => new Map(allSources.map((s) => [s.id, s])),
    [allSources],
  );

  const [searchInput, setSearchInput] = useState(initialQuery ?? '');
  const [activeQuery, setActiveQuery] = useState(initialQuery ?? '');
  const [searchStates, setSearchStates] = useState<Record<string, SourceSearchState>>({});

  const [selectedSourceId, setSelectedSourceId] = useState<string>(initialSourceId ?? '');
  const [browseMode, setBrowseMode] = useState<'popular' | 'latest'>('popular');
  const [browsePage, setBrowsePage] = useState(1);
  const [browseItems, setBrowseItems] = useState<ParsedCatalogueItem[]>([]);
  const [browseHasNext, setBrowseHasNext] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<
    { kind: 'cloudflare'; url: string } | { kind: 'error'; message: string } | null
  >(null);

  const searchRunId = useRef(0);

  useEffect(() => {
    if (initialSourceId) {
      setSelectedSourceId(initialSourceId);
      return;
    }
    if (!selectedSourceId && enabledSources[0]) {
      setSelectedSourceId(enabledSources[0].id);
    }
  }, [initialSourceId, enabledSources, selectedSourceId]);

  const activeBrowseSource = selectedSourceId ? sourceById.get(selectedSourceId) : enabledSources[0];

  async function runParallelSearch(queryText: string) {
    const trimmed = queryText.trim();
    setActiveQuery(trimmed);
    if (!trimmed) {
      setSearchStates({});
      return;
    }

    const runId = ++searchRunId.current;
    const initial: Record<string, SourceSearchState> = {};
    for (const src of enabledSources) {
      initial[src.id] = { source: src, status: 'loading', items: [] };
    }
    setSearchStates(initial);

    await Promise.all(
      enabledSources.map(async (src) => {
        try {
          const res = await parserEngine.search(src.resolvedConfig, trimmed, 1);
          if (searchRunId.current !== runId) return;
          setSearchStates((prev) => ({
            ...prev,
            [src.id]: {
              source: src,
              status: 'done',
              items: res.items,
            },
          }));
        } catch (err) {
          if (searchRunId.current !== runId) return;
          if (err instanceof CloudflareChallengeError) {
            setSearchStates((prev) => ({
              ...prev,
              [src.id]: {
                source: src,
                status: 'cloudflare',
                items: [],
                cloudflareUrl: err.url,
              },
            }));
          } else {
            setSearchStates((prev) => ({
              ...prev,
              [src.id]: {
                source: src,
                status: 'error',
                items: [],
                errorMessage: err instanceof Error ? err.message : 'Erreur réseau',
              },
            }));
          }
        }
      }),
    );
  }

  async function retrySingleSourceSearch(src: InstalledSourceRecord) {
    if (!activeQuery) return;
    setSearchStates((prev) => ({
      ...prev,
      [src.id]: { source: src, status: 'loading', items: [] },
    }));
    try {
      const res = await parserEngine.search(src.resolvedConfig, activeQuery, 1);
      setSearchStates((prev) => ({
        ...prev,
        [src.id]: { source: src, status: 'done', items: res.items },
      }));
    } catch (err) {
      if (err instanceof CloudflareChallengeError) {
        setSearchStates((prev) => ({
          ...prev,
          [src.id]: { source: src, status: 'cloudflare', items: [], cloudflareUrl: err.url },
        }));
      } else {
        setSearchStates((prev) => ({
          ...prev,
          [src.id]: {
            source: src,
            status: 'error',
            items: [],
            errorMessage: err instanceof Error ? err.message : 'Erreur réseau',
          },
        }));
      }
    }
  }

  async function loadBrowseCatalogue(
    src: InstalledSourceRecord,
    mode: 'popular' | 'latest',
    pageNum: number,
    append: boolean,
  ) {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const pageRes =
        mode === 'popular'
          ? await parserEngine.getPopular(src.resolvedConfig, pageNum)
          : await parserEngine.getLatest(src.resolvedConfig, pageNum);
      setBrowseItems((prev) => (append ? [...prev, ...pageRes.items] : pageRes.items));
      setBrowseHasNext(pageRes.hasNextPage);
      setBrowsePage(pageNum);
    } catch (err) {
      if (err instanceof CloudflareChallengeError) {
        setBrowseError({ kind: 'cloudflare', url: err.url });
      } else {
        setBrowseError({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Erreur de chargement du catalogue',
        });
      }
    } finally {
      setBrowseLoading(false);
    }
  }

  useEffect(() => {
    if (activeQuery || !activeBrowseSource) return;
    void loadBrowseCatalogue(activeBrowseSource, browseMode, 1, false);
  }, [activeQuery, activeBrowseSource?.id, browseMode]);

  const groupedSearchResults = useMemo<GroupedSearchResult[]>(() => {
    const map = new Map<string, GroupedSearchResult>();
    for (const st of Object.values(searchStates)) {
      if (st.status !== 'done') continue;
      for (const item of st.items) {
        const key = normalizeMangaKey(item.title) || item.url;
        const existing = map.get(key);
        if (existing) {
          existing.entries.push({ sourceName: st.source.name, item });
          if (!existing.coverUrl && item.coverUrl) {
            existing.coverUrl = item.coverUrl;
            existing.referer = st.source.baseUrl;
          }
        } else {
          map.set(key, {
            normalizedKey: key,
            title: item.title,
            coverUrl: item.coverUrl,
            referer: st.source.baseUrl,
            entries: [{ sourceName: st.source.name, item }],
          });
        }
      }
    }
    return Array.from(map.values());
  }, [searchStates]);

  const anySourceLoading = Object.values(searchStates).some((s) => s.status === 'loading');

  async function handleOpenGroupedManga(group: GroupedSearchResult) {
    let primaryMangaId = '';
    for (const entry of group.entries) {
      const res = await upsertMangaFromCatalogueItem(entry.item);
      if (!primaryMangaId) primaryMangaId = res.manga.id;
    }
    if (primaryMangaId) {
      navigate({ name: 'manga', mangaId: primaryMangaId });
    }
  }

  async function handleOpenCatalogueItem(item: ParsedCatalogueItem) {
    const { manga } = await upsertMangaFromCatalogueItem(item);
    navigate({ name: 'manga', mangaId: manga.id });
  }

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    void runParallelSearch(searchInput);
  }

  if (enabledSources.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-800 bg-[#111118] p-12 text-center">
        <FolderGit2 className="mx-auto h-10 w-10 text-zinc-600" />
        <h2 className="mt-4 text-lg font-semibold text-white">Aucune source active</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
          Commencez par ajouter un dépôt ou importer un fichier <code>.json</code> dans l’onglet
          Sources & Dépôts pour explorer les catalogues.
        </p>
        <button
          type="button"
          onClick={() => navigate({ name: 'sources' })}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-500"
        >
          Configurer mes sources
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Explorer & Recherche</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Recherche globale parallèle sur {enabledSources.length} source(s) active(s) avec
              dédoublonnage automatique.
            </p>
          </div>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-3">
          <div className="relative min-w-[280px] flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              id="global-search-input"
              type="search"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                if (!e.target.value.trim() && activeQuery) {
                  setActiveQuery('');
                  setSearchStates({});
                }
              }}
              placeholder="Rechercher un titre sur toutes vos sources (ex: Solo Leveling, Kumo...)"
              className="w-full rounded-xl border border-zinc-800 bg-[#12121a] py-3 pl-11 pr-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-rose-500/60 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={!searchInput.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
          >
            {anySourceLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Rechercher
          </button>
          {activeQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setActiveQuery('');
                setSearchStates({});
              }}
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            >
              Retour au catalogue
            </button>
          )}
        </form>
      </header>

      {activeQuery ? (
        <section className="space-y-5">
          {/* Statuts par source en direct */}
          <div className="flex flex-wrap items-center gap-2">
            {Object.values(searchStates).map((st) => (
              <span
                key={st.source.id}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                  st.status === 'loading'
                    ? 'border-zinc-700 bg-zinc-900 text-zinc-300'
                    : st.status === 'done'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : st.status === 'cloudflare'
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                }`}
              >
                {st.status === 'loading' && <Loader2 className="h-3 w-3 animate-spin" />}
                <span>{st.source.name}</span>
                {st.status === 'done' && <span>({st.items.length})</span>}
                {st.status === 'cloudflare' && <span>(Cloudflare)</span>}
                {st.status === 'error' && <span>(Erreur)</span>}
              </span>
            ))}
          </div>

          {/* Bannières Cloudflare / Erreurs isolées par source */}
          <div className="space-y-3">
            {Object.values(searchStates)
              .filter((st) => st.status === 'cloudflare' && st.cloudflareUrl)
              .map((st) => (
                <CloudflareBanner
                  key={st.source.id}
                  sourceName={st.source.name}
                  url={st.cloudflareUrl!}
                  compact
                  onRetry={() => void retrySingleSourceSearch(st.source)}
                />
              ))}
            {Object.values(searchStates)
              .filter((st) => st.status === 'error')
              .map((st) => (
                <div
                  key={st.source.id}
                  className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                  <span>
                    <strong>{st.source.name}</strong> : {st.errorMessage}
                  </span>
                </div>
              ))}
          </div>

          {/* Grille progressive + skeletons */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {groupedSearchResults.map((group) => (
              <button
                key={group.normalizedKey}
                type="button"
                onClick={() => void handleOpenGroupedManga(group)}
                className="group flex flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-[#12121a] text-left transition hover:-translate-y-0.5 hover:border-rose-500/50"
              >
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-900">
                  <AntiHotlinkImage
                    src={group.coverUrl}
                    referer={group.referer}
                    alt={group.title}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                  <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                    {group.entries.length > 1 ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-rose-600/95 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                        <Layers className="h-3 w-3" />
                        {group.entries.length} sources
                      </span>
                    ) : (
                      <span className="rounded-md bg-zinc-950/85 px-2 py-0.5 text-[11px] font-medium text-zinc-200 backdrop-blur">
                        {group.entries[0]?.sourceName}
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-3">
                  <h3 className="line-clamp-2 text-sm font-semibold text-zinc-100 group-hover:text-rose-300">
                    {group.title}
                  </h3>
                  {group.entries.length > 1 && (
                    <p className="mt-1 truncate text-[11px] text-zinc-500">
                      {group.entries.map((e) => e.sourceName).join(' · ')}
                    </p>
                  )}
                </div>
              </button>
            ))}

            {anySourceLoading &&
              Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={`skel-${idx}`}
                  className="overflow-hidden rounded-2xl border border-zinc-800/70 bg-[#12121a]"
                >
                  <div className="aspect-[3/4] w-full animate-pulse bg-zinc-800/60" />
                  <div className="space-y-2 p-3">
                    <div className="h-4 w-4/5 animate-pulse rounded bg-zinc-800/80" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-800/50" />
                  </div>
                </div>
              ))}
          </div>

          {!anySourceLoading && groupedSearchResults.length === 0 && (
            <div className="rounded-2xl border border-zinc-800 bg-[#12121a] p-10 text-center text-sm text-zinc-400">
              Aucun résultat trouvé pour « {activeQuery} ».
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-5">
          {/* Barre de sélection source & tri */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800/80 bg-[#12121a] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 text-xs font-medium text-zinc-400">Catalogue :</span>
              <select
                value={activeBrowseSource?.id ?? ''}
                onChange={(e) => setSelectedSourceId(e.target.value)}
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm font-medium text-zinc-100 focus:border-rose-500 focus:outline-none"
              >
                {enabledSources.map((src) => (
                  <option key={src.id} value={src.id}>
                    {src.name} ({src.lang.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 rounded-xl bg-zinc-950 p-1">
              <button
                type="button"
                onClick={() => setBrowseMode('popular')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  browseMode === 'popular'
                    ? 'bg-rose-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                Populaires
              </button>
              <button
                type="button"
                onClick={() => setBrowseMode('latest')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  browseMode === 'latest'
                    ? 'bg-rose-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Dernières sorties
              </button>
            </div>
          </div>

          {browseError?.kind === 'cloudflare' && activeBrowseSource && (
            <CloudflareBanner
              sourceName={activeBrowseSource.name}
              url={browseError.url}
              onRetry={() => void loadBrowseCatalogue(activeBrowseSource, browseMode, 1, false)}
            />
          )}

          {browseError?.kind === 'error' && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              {browseError.message}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {browseItems.map((item) => (
              <button
                key={`${item.sourceId}-${item.url}`}
                type="button"
                onClick={() => void handleOpenCatalogueItem(item)}
                className="group flex flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-[#12121a] text-left transition hover:-translate-y-0.5 hover:border-rose-500/50"
              >
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-900">
                  <AntiHotlinkImage
                    src={item.coverUrl}
                    referer={activeBrowseSource?.baseUrl}
                    alt={item.title}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                  {item.latestChapter && (
                    <span className="absolute bottom-2 left-2 rounded-md bg-zinc-950/85 px-2 py-0.5 text-[11px] font-medium text-zinc-200 backdrop-blur">
                      {item.latestChapter}
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <h3 className="line-clamp-2 text-sm font-semibold text-zinc-100 group-hover:text-rose-300">
                    {item.title}
                  </h3>
                </div>
              </button>
            ))}

            {browseLoading &&
              browseItems.length === 0 &&
              Array.from({ length: 12 }).map((_, idx) => (
                <div
                  key={`b-skel-${idx}`}
                  className="overflow-hidden rounded-2xl border border-zinc-800/70 bg-[#12121a]"
                >
                  <div className="aspect-[3/4] w-full animate-pulse bg-zinc-800/60" />
                  <div className="space-y-2 p-3">
                    <div className="h-4 w-4/5 animate-pulse rounded bg-zinc-800/80" />
                  </div>
                </div>
              ))}
          </div>

          {!browseLoading && !browseError && browseItems.length === 0 && (
            <div className="rounded-2xl border border-zinc-800 bg-[#12121a] p-10 text-center">
              <Compass className="mx-auto h-8 w-8 text-zinc-600" />
              <p className="mt-2 text-sm text-zinc-400">Aucune série trouvée sur cette page.</p>
            </div>
          )}

          {browseHasNext && activeBrowseSource && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                disabled={browseLoading}
                onClick={() =>
                  void loadBrowseCatalogue(activeBrowseSource, browseMode, browsePage + 1, true)
                }
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                {browseLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Charger plus de séries
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
