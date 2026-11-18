import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  ArrowUpDown,
  BookOpen,
  Check,
  CheckCheck,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  HardDrive,
  Heart,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '@/src/app/router';
import { AntiHotlinkImage } from '@/src/components/AntiHotlinkImage';
import { CloudflareBanner } from '@/src/components/CloudflareBanner';
import { CustomSelect } from '@/src/components/CustomSelect';
import { SourceIcon } from '@/src/components/SourceIcon';
import { DEFAULT_APP_SETTINGS, db, normalizeMangaKey } from '@/src/core/db/db';
import {
  addCustomCategory,
  markChaptersReadState,
  saveMangaDetails,
  setMangaCategories,
  setPreferredSource,
  syncSourceChapters,
  toggleFavoriteManga,
  upsertMangaFromCatalogueItem,
} from '@/src/core/db/mangaRepository';
import { runWithAutoCloudflarePopup } from '@/src/core/extension/cfAutoVerify';
import { useTranslation } from '@/src/core/i18n';
import {
  downloadChapterOffline,
  formatBytes,
  removeOfflineChapter,
} from '@/src/core/offline/offlineCache';
import { parserEngine } from '@/src/core/parser/engine';
import { CloudflareChallengeError } from '@/src/core/parser/httpClient';
import type { ChapterEntity, LibraryStatus } from '@/src/core/types/manga';

const LIBRARY_STATUS_KEYS: LibraryStatus[] = [
  'reading',
  'plan_to_read',
  'completed',
  'on_hold',
  'dropped',
];

export function MangaDetailPage({ mangaId }: { mangaId: string }) {
  const { t, formatDate } = useTranslation();
  const manga = useLiveQuery(() => db.mangas.get(mangaId), [mangaId]);
  const links =
    useLiveQuery(() => db.mangaSources.where('mangaId').equals(mangaId).toArray(), [mangaId], []) ??
    [];
  const allSources = useLiveQuery(() => db.sources.toArray(), [], []) ?? [];
  const settings = useLiveQuery(() => db.settings.get('default'), [], DEFAULT_APP_SETTINGS);
  const customCategories = settings?.customCategories ?? [];
  const [newCatInput, setNewCatInput] = useState('');

  const activeSourceId =
    manga?.preferredSourceId && links.some((l) => l.sourceId === manga.preferredSourceId)
      ? manga.preferredSourceId
      : links[0]?.sourceId ?? '';

  const chaptersRaw = useLiveQuery(
    async () =>
      activeSourceId
        ? db.chapters.where('[mangaId+sourceId]').equals([mangaId, activeSourceId]).toArray()
        : [],
    [mangaId, activeSourceId],
  );
  const chapters = chaptersRaw ?? [];

  const sourceMap = useMemo(() => new Map(allSources.map((s) => [s.id, s])), [allSources]);
  const activeSource = activeSourceId ? sourceMap.get(activeSourceId) : undefined;
  const activeLink = links.find((l) => l.sourceId === activeSourceId);

  const offlineEntries =
    useLiveQuery(
      () => db.offlineChapters.where('mangaId').equals(mangaId).toArray(),
      [mangaId],
      [],
    ) ?? [];
  const offlineByChapterId = useMemo(
    () => new Map(offlineEntries.map((o) => [o.chapterId, o])),
    [offlineEntries],
  );

  const [syncing, setSyncing] = useState(false);
  const [matchingOtherSources, setMatchingOtherSources] = useState(false);
  const [syncError, setSyncError] = useState<
    | { kind: 'cloudflare'; url: string; probeUrl?: string }
    | { kind: 'error'; message: string }
    | null
  >(null);
  const [chapterQuery, setChapterQuery] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);
  const [downloadingProgress, setDownloadingProgress] = useState<
    Record<string, { done: number; total: number }>
  >({});
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);
  const autoFetchedKeyRef = useRef<string>('');

  useEffect(() => {
    return () => {
      batchAbortRef.current?.abort();
    };
  }, []);

  async function refreshFromActiveSource() {
    if (!activeSource || !activeLink) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const { details, parsedChapters } = await runWithAutoCloudflarePopup(async () => {
        const fetchedDetails = await parserEngine.getMangaDetails(
          activeSource.resolvedConfig,
          activeLink.sourceMangaUrl,
        );
        const fetchedChapters = await parserEngine.getChapters(
          activeSource.resolvedConfig,
          fetchedDetails.url || activeLink.sourceMangaUrl,
          fetchedDetails.rawHtml,
          fetchedDetails.rawJson,
        );
        return { details: fetchedDetails, parsedChapters: fetchedChapters };
      });
      await saveMangaDetails(mangaId, activeSource.id, details);
      await syncSourceChapters(mangaId, activeSource.id, parsedChapters);
    } catch (err) {
      if (err instanceof CloudflareChallengeError) {
        setSyncError({ kind: 'cloudflare', url: err.url, probeUrl: err.requestUrl });
      } else {
        setSyncError({
          kind: 'error',
          message: err instanceof Error ? err.message : t('manga.loadChaptersError'),
        });
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleDownloadSingleChapter(chapter: ChapterEntity, signal?: AbortSignal) {
    if (!activeSource) return;
    setDownloadError(null);
    setDownloadingProgress((prev) => ({ ...prev, [chapter.id]: { done: 0, total: 0 } }));
    try {
      await runWithAutoCloudflarePopup(() =>
        downloadChapterOffline(
          chapter,
          activeSource,
          (prog) => {
            setDownloadingProgress((prev) => ({
              ...prev,
              [chapter.id]: { done: prog.completedPages, total: prog.totalPages },
            }));
          },
          signal,
        ),
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (err instanceof CloudflareChallengeError) {
        setSyncError({ kind: 'cloudflare', url: err.url, probeUrl: err.requestUrl });
      } else {
        setDownloadError(
          err instanceof Error ? err.message : t('manga.downloadFailed'),
        );
      }
    } finally {
      setDownloadingProgress((prev) => {
        const next = { ...prev };
        delete next[chapter.id];
        return next;
      });
    }
  }

  async function handleDownloadUnreadChapters() {
    if (!activeSource || batchDownloading) return;
    const targets = [...chapters]
      .sort((a, b) => b.orderIndex - a.orderIndex)
      .filter((c) => !c.read && !offlineByChapterId.has(c.id));
    if (targets.length === 0) return;

    const controller = new AbortController();
    batchAbortRef.current = controller;
    setBatchDownloading(true);
    setDownloadError(null);
    try {
      for (const ch of targets) {
        if (controller.signal.aborted) break;
        await handleDownloadSingleChapter(ch, controller.signal);
      }
    } finally {
      batchAbortRef.current = null;
      setBatchDownloading(false);
    }
  }

  useEffect(() => {
    if (!activeSource || !activeLink || chaptersRaw === undefined) return;
    const key = `${mangaId}::${activeSource.id}`;
    if (autoFetchedKeyRef.current === key) return;
    if (chaptersRaw.length === 0) {
      autoFetchedKeyRef.current = key;
      void refreshFromActiveSource();
    }
  }, [mangaId, activeSource?.id, activeLink?.sourceMangaUrl, chaptersRaw]);

  async function handleFindOtherSources() {
    if (!manga) return;
    setMatchingOtherSources(true);
    try {
      const linkedIds = new Set(links.map((l) => l.sourceId));
      const candidates = allSources.filter((s) => s.enabled && !linkedIds.has(s.id));
      await Promise.all(
        candidates.map(async (src) => {
          try {
            const res = await parserEngine.search(src.resolvedConfig, manga.title, 1);
            for (const item of res.items) {
              if (normalizeMangaKey(item.title) === manga.normalizedKey) {
                await upsertMangaFromCatalogueItem(item);
                break;
              }
            }
          } catch {
            // Ignore les erreurs individuelles des sources secondaires
          }
        }),
      );
    } finally {
      setMatchingOtherSources(false);
    }
  }

  const orderedChapters = useMemo(() => {
    const sorted = [...chapters].sort((a, b) => a.orderIndex - b.orderIndex);
    const list = sortDesc ? sorted : [...sorted].reverse();
    const filteredUnread = onlyUnread ? list.filter((c) => !c.read) : list;
    if (!chapterQuery.trim()) return filteredUnread;
    const q = chapterQuery.trim().toLowerCase();
    return filteredUnread.filter((c) => c.title.toLowerCase().includes(q));
  }, [chapters, sortDesc, onlyUnread, chapterQuery]);

  const resumeChapter = useMemo(() => {
    if (chapters.length === 0) return undefined;
    // Du plus ancien au plus récent pour reprendre au premier chapitre non lu
    const ascending = [...chapters].sort((a, b) => b.orderIndex - a.orderIndex);
    return ascending.find((c) => !c.read) ?? ascending[ascending.length - 1];
  }, [chapters]);

  if (!manga) {
    return (
      <div className="py-20 text-center text-sm text-zinc-400">
        {t('manga.notFound')}{' '}
        <button
          type="button"
          onClick={() => navigate({ name: 'explore' })}
          className="text-rose-400 underline"
        >
          {t('manga.exploreSources')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => window.history.back()}
        className="inline-flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('common.back')}
      </button>

      {/* En-tête fiche manga */}
      <section className="ky-surface relative overflow-hidden rounded-3xl border p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:gap-7">
          <div className="mx-auto h-64 w-44 shrink-0 overflow-hidden rounded-2xl border border-[var(--ky-border-strong)] bg-black/30 shadow-2xl md:mx-0 md:h-72 md:w-48">
            <AntiHotlinkImage
              src={manga.coverUrl}
              referer={activeSource?.baseUrl}
              alt={manga.title}
              className="h-full w-full object-cover"
            />
          </div>

          <div className="min-w-0 flex-1 space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
                    manga.publicationStatus === 'completed'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : manga.publicationStatus === 'hiatus'
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-sky-500/15 text-sky-300'
                  }`}
                >
                  {t(`pubStatus.${manga.publicationStatus}`)}
                </span>
                {manga.author && (
                  <span className="ky-muted text-xs">
                    {t('manga.author')}{' '}
                    <strong className="ky-heading">{manga.author}</strong>
                  </span>
                )}
                {manga.artist && manga.artist !== manga.author && (
                  <span className="ky-muted text-xs">
                    · {t('manga.artist')}{' '}
                    <strong className="ky-heading">{manga.artist}</strong>
                  </span>
                )}
              </div>

              <h1 className="ky-heading text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">
                {manga.title}
              </h1>

              {manga.altTitles.length > 0 && (
                <p className="ky-soft text-xs">{manga.altTitles.join(' · ')}</p>
              )}
            </div>

            {manga.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {manga.genres.map((genre) => (
                  <span
                    key={genre}
                    className="rounded-lg border border-[var(--ky-border)] bg-[var(--ky-surface-2)] px-2.5 py-1 text-xs text-[var(--ky-text-secondary)]"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            )}

            {manga.description && (
              <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-[var(--ky-text-secondary)]">
                {manga.description}
              </p>
            )}

            {/* Actions & Sélecteur de source */}
            <div className="flex flex-wrap items-center gap-2.5 pt-2 sm:gap-3">
              {resumeChapter && (
                <button
                  type="button"
                  onClick={() =>
                    navigate({
                      name: 'reader',
                      mangaId: manga.id,
                      chapterId: resumeChapter.id,
                    })
                  }
                  className="ky-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold sm:w-auto"
                >
                  <Play className="h-4 w-4 shrink-0 fill-current" />
                  <span className="truncate">
                    {resumeChapter.lastPageRead > 0
                      ? `${t('updates.resumeBtn')}: ${resumeChapter.title}`
                      : t('manga.readAction', { title: resumeChapter.title })}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  void toggleFavoriteManga(manga.id, !manga.favorite, manga.libraryStatus)
                }
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                  manga.favorite
                    ? 'ky-pill-active border-transparent'
                    : 'ky-btn-secondary'
                }`}
              >
                <Heart
                  className={`h-4 w-4 ${manga.favorite ? 'fill-current text-[var(--ky-accent-text)]' : ''}`}
                />
                {manga.favorite ? t('manga.inLibrary') : t('manga.addToLibrary')}
              </button>

              {manga.favorite && (
                <CustomSelect
                  ariaLabel={t('library.title')}
                  value={manga.libraryStatus}
                  options={LIBRARY_STATUS_KEYS.map((key) => ({
                    value: key,
                    label: t(`libStatus.${key}`),
                  }))}
                  onChange={(val) =>
                    void toggleFavoriteManga(manga.id, true, val as LibraryStatus)
                  }
                />
              )}
            </div>

            {manga.favorite && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ky-text-muted)]">
                  <Tag className="h-3.5 w-3.5 text-violet-400" />
                  {t('categories.label')}:
                </span>
                {customCategories.map((cat) => {
                  const activeCats = manga.categories ?? [];
                  const assigned = activeCats.some(
                    (c) => c.toLowerCase() === cat.toLowerCase(),
                  );
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        const next = assigned
                          ? activeCats.filter((c) => c.toLowerCase() !== cat.toLowerCase())
                          : [...activeCats, cat];
                        void setMangaCategories(manga.id, next);
                      }}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                        assigned
                          ? 'ky-pill-active border-transparent'
                          : 'ky-btn-secondary'
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
                <form
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    const trimmed = newCatInput.trim();
                    if (!trimmed) return;
                    setNewCatInput('');
                    void (async () => {
                      await addCustomCategory(trimmed);
                      await setMangaCategories(manga.id, [...(manga.categories ?? []), trimmed]);
                    })();
                  }}
                  className="inline-flex items-center gap-1"
                >
                  <input
                    type="text"
                    value={newCatInput}
                    onChange={(e) => setNewCatInput(e.target.value)}
                    placeholder={t('categories.newPlaceholder')}
                    className="ky-input w-36 rounded-lg px-2.5 py-1 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={!newCatInput.trim()}
                    title={t('categories.addBtn')}
                    className="ky-btn-secondary inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3" />
                    {t('categories.addBtn')}
                  </button>
                </form>
              </div>
            )}

            {/* Menu déroulant changement de source */}
            <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-[var(--ky-border)] bg-[var(--ky-surface-2)] p-3 sm:gap-3">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--ky-text-muted)]">
                <Layers className="h-4 w-4 text-sky-400" />
                {t('manga.activeSource')}
              </div>
              <CustomSelect
                ariaLabel={t('manga.activeSource')}
                size="xs"
                value={activeSourceId}
                options={links.map((link) => {
                  const s = sourceMap.get(link.sourceId);
                  return {
                    value: link.sourceId,
                    label: s ? s.name : link.sourceId,
                    badge: s ? s.lang.toUpperCase() : undefined,
                    icon: s ? (
                      <SourceIcon
                        size="xs"
                        name={s.name}
                        iconUrl={s.resolvedConfig?.iconUrl}
                        baseUrl={s.baseUrl}
                      />
                    ) : undefined,
                  };
                })}
                onChange={(val) => {
                  autoFetchedKeyRef.current = '';
                  void setPreferredSource(manga.id, val);
                }}
              />

              <button
                type="button"
                onClick={() => void refreshFromActiveSource()}
                disabled={syncing}
                className="ky-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                {t('common.refresh')}
              </button>

              <button
                type="button"
                onClick={() => void handleFindOtherSources()}
                disabled={matchingOtherSources}
                className="ky-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
              >
                {matchingOtherSources ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                {t('manga.findOtherSources')}
              </button>
              {activeLink?.sourceMangaUrl && (
                <a
                  href={activeLink.sourceMangaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ky-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t('manga.openOnWebsite')}
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {syncError?.kind === 'cloudflare' && activeSource && (
        <CloudflareBanner
          sourceName={activeSource.name}
          url={syncError.url}
          probeUrl={syncError.probeUrl}
          onRetry={() => void refreshFromActiveSource()}
        />
      )}

      {(syncError?.kind === 'error' || downloadError) && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {downloadError ?? (syncError?.kind === 'error' ? syncError.message : '')}
        </div>
      )}

      {/* Liste des chapitres */}
      <section className="ky-surface space-y-4 rounded-3xl border p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <BookOpen className="h-4 w-4 text-[var(--ky-accent-text)]" />
            <h2 className="ky-heading text-base font-semibold">
              {t('manga.chaptersTitle', { count: chapters.length })}
            </h2>
            {offlineEntries.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                <HardDrive className="h-3 w-3" />
                {t('manga.offlineCount', { count: offlineEntries.length })}
              </span>
            )}
            {syncing && <Loader2 className="h-4 w-4 animate-spin text-[var(--ky-accent)]" />}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={chapterQuery}
              onChange={(e) => setChapterQuery(e.target.value)}
              placeholder={t('manga.filterChapter')}
              className="ky-input w-full rounded-xl px-3 py-1.5 text-xs sm:w-44"
            />
            <button
              type="button"
              onClick={() => setOnlyUnread((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                onlyUnread ? 'ky-pill-active border-transparent' : 'ky-btn-secondary'
              }`}
            >
              {t('manga.unreadOnly')}
            </button>
            <button
              type="button"
              onClick={() => setSortDesc((v) => !v)}
              className="ky-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {sortDesc ? t('manga.sortNewest') : t('manga.sortOldest')}
            </button>
            {activeSource && chapters.some((c) => !c.read && !offlineByChapterId.has(c.id)) && (
              <button
                type="button"
                onClick={() => {
                  if (batchDownloading) {
                    batchAbortRef.current?.abort();
                  } else {
                    void handleDownloadUnreadChapters();
                  }
                }}
                className="ky-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
              >
                {batchDownloading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ky-accent-text)]" />
                    {t('manga.cancelDownload')}
                  </>
                ) : (
                  <>
                    <Download className="h-3.5 w-3.5 text-sky-400" />
                    {t('manga.downloadUnread')}
                  </>
                )}
              </button>
            )}
            {chapters.length > 0 && activeSource && (
              <button
                type="button"
                onClick={() =>
                  void markChaptersReadState(
                    manga.id,
                    activeSource.id,
                    chapters.map((c) => c.id),
                    chapters.some((c) => !c.read),
                  )
                }
                className="ky-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
              >
                <CheckCheck className="h-3.5 w-3.5 text-emerald-400" />
                {chapters.some((c) => !c.read) ? t('manga.markAllRead') : t('manga.markAllUnread')}
              </button>
            )}
          </div>
        </div>

        {orderedChapters.length === 0 && !syncing ? (
          <p className="ky-soft py-8 text-center text-sm">{t('manga.noChapters')}</p>
        ) : (
          <div className="divide-y divide-[var(--ky-border)] overflow-hidden rounded-2xl border border-[var(--ky-border)] bg-[var(--ky-surface-2)]">
            {orderedChapters.map((chapter) => (
              <div
                key={chapter.id}
                className={`flex items-center justify-between gap-2 px-3 py-2.5 transition hover:bg-[var(--ky-surface-hover)] sm:gap-4 sm:px-4 sm:py-3 ${
                  chapter.read ? 'opacity-55' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() =>
                    navigate({ name: 'reader', mangaId: manga.id, chapterId: chapter.id })
                  }
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <span className="ky-heading truncate text-xs font-medium sm:text-sm">
                      {chapter.title}
                    </span>
                    {chapter.isNew && !chapter.read && (
                      <span className="ky-accent-badge rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                        {t('common.new')}
                      </span>
                    )}
                    {chapter.lastPageRead > 0 && !chapter.read && (
                      <span className="text-xs font-medium text-[var(--ky-accent-text)]">
                        · {t('updates.pageProgress', { page: chapter.lastPageRead + 1 })}
                        {chapter.totalPages > 0 ? `/${chapter.totalPages}` : ''}
                      </span>
                    )}
                  </div>
                  {chapter.publishedAt && (
                    <p className="ky-soft mt-0.5 text-[11px] sm:text-xs">
                      {formatDate(chapter.publishedAt, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  )}
                </button>

                <div className="flex shrink-0 items-center gap-1.5">
                  {activeSource && (
                    <>
                      {(() => {
                        const dl = downloadingProgress[chapter.id];
                        const offline = offlineByChapterId.get(chapter.id);
                        if (dl) {
                          return (
                            <span
                              className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-2 py-1 text-[11px] font-mono text-rose-300"
                              title={t('manga.downloadingOffline')}
                            >
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              {dl.total > 0 ? `${dl.done}/${dl.total}` : '...'}
                            </span>
                          );
                        }
                        if (offline) {
                          return (
                            <button
                              type="button"
                              title={t('manga.removeOffline', {
                                size: formatBytes(offline.totalBytes),
                              })}
                              onClick={() => void removeOfflineChapter(chapter.id)}
                              className="group inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-rose-500/15 hover:text-rose-300"
                            >
                              <HardDrive className="h-3.5 w-3.5 group-hover:hidden" />
                              <Trash2 className="hidden h-3.5 w-3.5 group-hover:block" />
                              <span className="hidden sm:inline">{formatBytes(offline.totalBytes)}</span>
                            </button>
                          );
                        }
                        return (
                          <button
                            type="button"
                            title={t('manga.downloadOffline')}
                            onClick={() => void handleDownloadSingleChapter(chapter)}
                            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                        );
                      })()}
                      <button
                        type="button"
                        title={t('manga.markUpToHere')}
                        onClick={() => {
                          const toMark = chapters
                            .filter((c) => c.orderIndex >= chapter.orderIndex)
                            .map((c) => c.id);
                          void markChaptersReadState(manga.id, activeSource.id, toMark, true);
                        }}
                        className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title={chapter.read ? t('manga.markUnread') : t('manga.markRead')}
                        onClick={() =>
                          void markChaptersReadState(
                            manga.id,
                            activeSource.id,
                            [chapter.id],
                            !chapter.read,
                          )
                        }
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                      >
                        {chapter.read ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </>
                  )}
                  {chapter.sourceChapterUrl && (
                    <a
                      href={chapter.sourceChapterUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title={t('manga.openChapterOnWebsite')}
                      className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-sky-300"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
