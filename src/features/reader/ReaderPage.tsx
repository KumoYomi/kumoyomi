import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Columns2,
  Eye,
  FileImage,
  HardDrive,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
  Rows3,
  SlidersHorizontal,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '@/src/app/router';
import { AntiHotlinkImage } from '@/src/components/AntiHotlinkImage';
import { CloudflareBanner } from '@/src/components/CloudflareBanner';
import { DEFAULT_APP_SETTINGS, db, getOrCreateSettings } from '@/src/core/db/db';
import { recordChapterProgress } from '@/src/core/db/mangaRepository';
import { runWithAutoCloudflarePopup } from '@/src/core/extension/cfAutoVerify';
import { useTranslation } from '@/src/core/i18n';
import type { TranslationKey } from '@/src/core/i18n/types';
import {
  fetchImageAsBlobUrl,
  revokeScopeBlobUrls,
} from '@/src/core/image-loader/blobImageLoader';
import { getOfflineChapterPages, removeOfflineChapter } from '@/src/core/offline/offlineCache';
import { parserEngine } from '@/src/core/parser/engine';
import { CloudflareChallengeError } from '@/src/core/parser/httpClient';
import type { PageFitMode, ReaderMode, ReadingDirection } from '@/src/core/types/manga';
import type { ParsedPageItem } from '@/src/core/types/source';

interface ReaderPageProps {
  mangaId: string;
  chapterId: string;
}

interface LazyWebtoonPageProps {
  page: ParsedPageItem;
  index: number;
  referer?: string;
  scopeId: string;
  offlineChapterId?: string;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  registerRef: (el: HTMLDivElement | null) => void;
}

function LazyWebtoonPage({
  page,
  index,
  referer,
  scopeId,
  offlineChapterId,
  t,
  registerRef,
}: LazyWebtoonPageProps) {
  const [shouldLoad, setShouldLoad] = useState(index <= 2);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (shouldLoad) return;
    const node = containerRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: '900px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        registerRef(el);
      }}
      data-page-index={index}
      className="webtoon-page-item w-full"
    >
      {shouldLoad ? (
        <AntiHotlinkImage
          src={page.imageUrl}
          referer={referer}
          scopeId={scopeId}
          offlineChapterId={offlineChapterId}
          pageIndex={page.index}
          alt={t('reader.pageAlt', { num: index + 1 })}
          loadingLabel={t('reader.loadingPage', { num: index + 1 })}
          priority="high"
          showRetry
          placeholderClassName="mx-auto min-h-[65vh] w-full rounded-lg"
          className="mx-auto block w-full object-contain"
        />
      ) : (
        <div className="mx-auto flex min-h-[65vh] w-full flex-col items-center justify-center gap-2 rounded-lg border border-zinc-900 bg-zinc-950/80 text-zinc-600">
          <Loader2 className="h-5 w-5 animate-spin opacity-60" />
          <span className="text-xs">{t('reader.pagePlaceholder', { num: index + 1 })}</span>
        </div>
      )}
    </div>
  );
}

export function ReaderPage({ mangaId, chapterId }: ReaderPageProps) {
  const { t } = useTranslation();
  const manga = useLiveQuery(() => db.mangas.get(mangaId), [mangaId]);
  const chapter = useLiveQuery(() => db.chapters.get(chapterId), [chapterId]);
  const source = useLiveQuery(
    async () => (chapter ? db.sources.get(chapter.sourceId) : undefined),
    [chapter?.sourceId],
  );
  const allChapters =
    useLiveQuery(
      async () =>
        chapter
          ? db.chapters
              .where('[mangaId+sourceId]')
              .equals([mangaId, chapter.sourceId])
              .toArray()
          : [],
      [mangaId, chapter?.sourceId],
      [],
    ) ?? [];
  const savedSettings = useLiveQuery(() => db.settings.get('default'), [], DEFAULT_APP_SETTINGS);

  const [readerMode, setReaderMode] = useState<ReaderMode>('webtoon');
  const [direction, setDirection] = useState<ReadingDirection>('ltr');
  const [pageFitMode, setPageFitMode] = useState<PageFitMode>('contain');
  const [zoomPercent, setZoomPercent] = useState<number>(100);
  const [webtoonWidth, setWebtoonWidth] = useState<number>(820);
  const [webtoonGap, setWebtoonGap] = useState<number>(0);
  const [doubleOffset, setDoubleOffset] = useState<boolean>(true);
  const [preloadCount, setPreloadCount] = useState<number>(DEFAULT_APP_SETTINGS.preloadPagesCount);
  const settingsInitializedRef = useRef(false);

  const [pages, setPages] = useState<ParsedPageItem[]>([]);
  const [isOfflineCached, setIsOfflineCached] = useState<boolean>(false);
  const [loadingPages, setLoadingPages] = useState<boolean>(true);
  const [pageError, setPageError] = useState<
    | { kind: 'cloudflare'; url: string; probeUrl?: string }
    | { kind: 'error'; message: string }
    | null
  >(null);

  const [currentPage, setCurrentPage] = useState<number>(0);
  const [showHud, setShowHud] = useState<boolean>(true);
  const [showOptions, setShowOptions] = useState<boolean>(false);
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const scopeId = `chapter_${chapterId}`;
  const webtoonRefs = useRef<Array<HTMLDivElement | null>>([]);
  const restoredChapterRef = useRef<string>('');
  const loadedKeyRef = useRef<string>('');
  const lastRecordedProgressRef = useRef<string>('');
  const [reloadNonce, setReloadNonce] = useState<number>(0);

  const sourceRef = useRef(source);
  sourceRef.current = source;
  const chapterRef = useRef(chapter);
  chapterRef.current = chapter;

  const sourceId = source?.id;
  const sourceChapterUrl = chapter?.sourceChapterUrl;

  useEffect(() => {
    setPages([]);
    setIsOfflineCached(false);
    setPageError(null);
    setLoadingPages(true);
    setCurrentPage(0);
    loadedKeyRef.current = '';
    lastRecordedProgressRef.current = '';
  }, [chapterId]);

  useEffect(() => {
    if (settingsInitializedRef.current || !savedSettings) return;
    settingsInitializedRef.current = true;
    setReaderMode(savedSettings.readerMode);
    setDirection(savedSettings.readingDirection);
    setPageFitMode(savedSettings.pageFitMode ?? 'contain');
    setWebtoonWidth(savedSettings.webtoonWidth);
    setWebtoonGap(savedSettings.webtoonGap ?? 0);
    setDoubleOffset(savedSettings.doublePageOffset);
    setPreloadCount(savedSettings.preloadPagesCount ?? DEFAULT_APP_SETTINGS.preloadPagesCount);
  }, [savedSettings]);

  // Libération explicite des URLs Blob en quittant le chapitre ou l'écran lecteur
  useEffect(() => {
    return () => {
      revokeScopeBlobUrls(scopeId);
    };
  }, [scopeId]);

  // Auto-delete offline chapter blobs on chapter exit if marked read and enabled in settings
  useEffect(() => {
    return () => {
      void (async () => {
        try {
          const settings = await getOrCreateSettings();
          if (!settings.autoDeleteOfflineOnRead) return;
          const ch = await db.chapters.get(chapterId);
          if (ch?.read) {
            await removeOfflineChapter(chapterId);
          }
        } catch {
          // Ignore cleanup errors on exit
        }
      })();
    };
  }, [chapterId]);

  const orderedAscChapters = useMemo(
    () => [...allChapters].sort((a, b) => b.orderIndex - a.orderIndex),
    [allChapters],
  );
  const currentChapterIdx = orderedAscChapters.findIndex((c) => c.id === chapterId);
  const prevChapter =
    currentChapterIdx > 0 ? orderedAscChapters[currentChapterIdx - 1] : undefined;
  const nextChapter =
    currentChapterIdx >= 0 && currentChapterIdx < orderedAscChapters.length - 1
      ? orderedAscChapters[currentChapterIdx + 1]
      : undefined;

  useEffect(() => {
    const activeSource = sourceRef.current;
    const activeChapter = chapterRef.current;
    if (!activeSource || !activeChapter || !sourceChapterUrl) return;

    const loadKey = `${chapterId}::${sourceId}::${sourceChapterUrl}::${reloadNonce}`;
    if (loadedKeyRef.current === loadKey) return;
    loadedKeyRef.current = loadKey;

    let cancelled = false;
    setLoadingPages(true);
    setPageError(null);
    setPages([]);
    setIsOfflineCached(false);

    void (async () => {
      try {
        const offlinePages = await getOfflineChapterPages(chapterId);
        if (cancelled) return;
        let result: ParsedPageItem[];
        if (offlinePages && offlinePages.length > 0) {
          setIsOfflineCached(true);
          result = offlinePages;
        } else {
          result = await runWithAutoCloudflarePopup(() =>
            parserEngine.getChapterPages(activeSource.resolvedConfig, sourceChapterUrl),
          );
        }
        if (cancelled) return;
        if (result.length === 0) {
          setPageError({
            kind: 'error',
            message: t('reader.noPages'),
          });
        } else {
          setPages(result);
          if (restoredChapterRef.current !== chapterId) {
            restoredChapterRef.current = chapterId;
            const initial =
              activeChapter.lastPageRead > 0 && activeChapter.lastPageRead < result.length
                ? activeChapter.lastPageRead
                : 0;
            setCurrentPage(initial);
            if (initial === 0) {
              window.scrollTo({ top: 0 });
            }
          }
        }
      } catch (err) {
        if (cancelled) return;
        loadedKeyRef.current = '';
        if (err instanceof CloudflareChallengeError) {
          setPageError({ kind: 'cloudflare', url: err.url, probeUrl: err.requestUrl });
        } else {
          setPageError({
            kind: 'error',
            message: err instanceof Error ? err.message : t('reader.loadError'),
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingPages(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chapterId, sourceId, sourceChapterUrl, reloadNonce]);

  const spreads = useMemo(() => {
    if (pages.length === 0) return [];
    const groups: ParsedPageItem[][] = [];
    let i = 0;
    if (doubleOffset && pages.length > 0) {
      groups.push([pages[0]!]);
      i = 1;
    }
    while (i < pages.length) {
      const first = pages[i]!;
      const second = pages[i + 1];
      groups.push(second ? [first, second] : [first]);
      i += 2;
    }
    return groups;
  }, [pages, doubleOffset]);

  const currentSpreadIndex = useMemo(() => {
    const idx = spreads.findIndex((g) => g.some((p) => p.index === currentPage));
    return idx >= 0 ? idx : 0;
  }, [spreads, currentPage]);

  // Préchargement ordonné et configurable des N prochaines planches (sans bloquer la page visible)
  useEffect(() => {
    const baseUrl = sourceRef.current?.baseUrl;
    if (!baseUrl || pages.length === 0 || preloadCount <= 0 || isOfflineCached) return;

    const currentLastIndex =
      readerMode === 'double'
        ? (spreads[currentSpreadIndex]?.at(-1)?.index ?? currentPage)
        : currentPage;
    const ahead = pages.slice(currentLastIndex + 1, currentLastIndex + 1 + preloadCount);
    if (ahead.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const p of ahead) {
        if (cancelled) break;
        await fetchImageAsBlobUrl(p.imageUrl, baseUrl, scopeId, { priority: 'normal' }).catch(
          () => {},
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    currentPage,
    currentSpreadIndex,
    spreads,
    pages,
    sourceId,
    scopeId,
    readerMode,
    preloadCount,
    isOfflineCached,
  ]);

  // Enregistrement automatique de la progression sans re-déclencher loadPages
  useEffect(() => {
    if (!chapterId || !sourceId || pages.length === 0) return;
    const isLast =
      readerMode === 'double'
        ? currentSpreadIndex >= spreads.length - 1
        : currentPage >= pages.length - 1;

    const progressKey = `${chapterId}::${currentPage}::${pages.length}::${isLast}`;
    if (lastRecordedProgressRef.current === progressKey) return;
    lastRecordedProgressRef.current = progressKey;

    void recordChapterProgress({
      mangaId,
      chapterId,
      sourceId,
      pageIndex: currentPage,
      totalPages: pages.length,
      markRead: isLast,
    });
  }, [currentPage, currentSpreadIndex, spreads.length, pages.length, chapterId, sourceId, mangaId, readerMode]);

  // Suivi de la page visible en mode Webtoon
  useEffect(() => {
    if (readerMode !== 'webtoon' || pages.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let bestIdx = -1;
        let bestRatio = 0;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= bestRatio) {
            const idx = Number((entry.target as HTMLElement).dataset.pageIndex);
            if (!Number.isNaN(idx)) {
              bestRatio = entry.intersectionRatio;
              bestIdx = idx;
            }
          }
        }
        if (bestIdx >= 0) {
          setCurrentPage((prev) => (prev === bestIdx ? prev : bestIdx));
        }
      },
      { threshold: [0.25, 0.55] },
    );

    for (const node of webtoonRefs.current) {
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [readerMode, pages.length]);

  const switchReaderMode = useCallback((nextMode: ReaderMode) => {
    setReaderMode(nextMode);
    void (async () => {
      const current = await getOrCreateSettings();
      await db.settings.put({ ...current, readerMode: nextMode });
    })();
    if (nextMode !== 'webtoon') {
      window.scrollTo({ top: 0 });
    }
  }, []);

  const canGoPrevPage =
    readerMode === 'single'
      ? currentPage > 0 || Boolean(prevChapter)
      : readerMode === 'double'
        ? currentSpreadIndex > 0 || Boolean(prevChapter)
        : true;

  const canGoNextPage =
    readerMode === 'single'
      ? currentPage < pages.length - 1 || Boolean(nextChapter)
      : readerMode === 'double'
        ? currentSpreadIndex < spreads.length - 1 || Boolean(nextChapter)
        : true;

  const goStep = useCallback(
    (delta: number) => {
      if (pages.length === 0) return;
      if (readerMode === 'webtoon') {
        window.scrollBy({ top: delta * window.innerHeight * 0.85, behavior: 'smooth' });
        return;
      }
      if (readerMode === 'single') {
        const nextIdx = currentPage + delta;
        if (nextIdx >= 0 && nextIdx < pages.length) {
          setCurrentPage(nextIdx);
        } else if (nextIdx >= pages.length && nextChapter) {
          navigate({ name: 'reader', mangaId, chapterId: nextChapter.id });
        } else if (nextIdx < 0 && prevChapter) {
          navigate({ name: 'reader', mangaId, chapterId: prevChapter.id });
        }
        return;
      }
      // Mode double-page
      const nextSpread = currentSpreadIndex + delta;
      if (nextSpread >= 0 && nextSpread < spreads.length) {
        const targetPage = spreads[nextSpread]?.[0]?.index ?? 0;
        setCurrentPage(targetPage);
      } else if (nextSpread >= spreads.length && nextChapter) {
        navigate({ name: 'reader', mangaId, chapterId: nextChapter.id });
      } else if (nextSpread < 0 && prevChapter) {
        navigate({ name: 'reader', mangaId, chapterId: prevChapter.id });
      }
    },
    [
      pages.length,
      readerMode,
      currentPage,
      currentSpreadIndex,
      spreads,
      nextChapter,
      prevChapter,
      mangaId,
    ],
  );

  const handleStageClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button, a, input, select')) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
      if (ratio < 0.3) {
        goStep(direction === 'rtl' ? 1 : -1);
      } else if (ratio > 0.7) {
        goStep(direction === 'rtl' ? -1 : 1);
      } else {
        setShowHud((v) => !v);
      }
    },
    [direction, goStep],
  );

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goStep(direction === 'rtl' ? -1 : 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goStep(direction === 'rtl' ? 1 : -1);
      } else if (e.key === ' ') {
        e.preventDefault();
        goStep(1);
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        void toggleFullscreen();
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        const nextMode: ReaderMode =
          readerMode === 'webtoon' ? 'single' : readerMode === 'single' ? 'double' : 'webtoon';
        switchReaderMode(nextMode);
      } else if (e.key === '[' && prevChapter) {
        navigate({ name: 'reader', mangaId, chapterId: prevChapter.id });
      } else if (e.key === ']' && nextChapter) {
        navigate({ name: 'reader', mangaId, chapterId: nextChapter.id });
      } else if (e.key === '?' || e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setShowHelp((v) => !v);
      } else if (e.key === 'Escape') {
        if (showHelp) {
          e.preventDefault();
          setShowHelp(false);
          return;
        }
        if (!document.fullscreenElement) {
          navigate({ name: 'manga', mangaId });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    goStep,
    direction,
    toggleFullscreen,
    prevChapter,
    nextChapter,
    mangaId,
    readerMode,
    switchReaderMode,
    showHelp,
  ]);

  useEffect(() => {
    if (readerMode !== 'webtoon' || showOptions || loadingPages || pageError) return;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y > 140 && y - lastY > 18) {
        setShowHud(false);
      } else if (lastY - y > 24 || y <= 40) {
        setShowHud(true);
      }
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [readerMode, showOptions, loadingPages, pageError]);

  async function persistReaderPref(
    patch: Partial<{
      readerMode: ReaderMode;
      readingDirection: ReadingDirection;
      pageFitMode: PageFitMode;
      webtoonWidth: number;
      webtoonGap: number;
      doublePageOffset: boolean;
      preloadPagesCount: number;
    }>,
  ) {
    const current = await getOrCreateSettings();
    await db.settings.put({ ...current, ...patch });
  }

  return (
    <div className="relative min-h-screen bg-[#050507] text-zinc-100 select-none">
      {/* Barre supérieure flottante */}
      <header
        className={`fixed inset-x-0 top-0 z-30 border-b border-zinc-800/80 bg-[#0b0b10]/95 backdrop-blur-md transition-transform duration-200 ${
          showHud ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate({ name: 'manga', mangaId })}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('common.back')}
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-white">
                  {manga?.title ?? t('common.loading')}
                </p>
                {isOfflineCached && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                    <HardDrive className="h-3 w-3" />
                    {t('common.offline')}
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-zinc-400">{chapter?.title ?? ''}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Navigation entre chapitres */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!prevChapter}
                title={t('reader.prevChapter')}
                onClick={() =>
                  prevChapter &&
                  navigate({ name: 'reader', mangaId, chapterId: prevChapter.id })
                }
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-35"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <select
                aria-label={t('reader.selectChapter')}
                value={chapterId}
                onChange={(e) =>
                  navigate({ name: 'reader', mangaId, chapterId: e.target.value })
                }
                className="max-w-[200px] rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 focus:border-rose-500 focus:outline-none"
              >
                {orderedAscChapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!nextChapter}
                title={t('reader.nextChapter')}
                onClick={() =>
                  nextChapter &&
                  navigate({ name: 'reader', mangaId, chapterId: nextChapter.id })
                }
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-35"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Modes de lecture */}
            <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => switchReaderMode('webtoon')}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium ${
                  readerMode === 'webtoon' ? 'bg-rose-600 text-white' : 'text-zinc-400'
                }`}
              >
                <Rows3 className="h-3.5 w-3.5" />
                {t('reader.modeWebtoon')}
              </button>
              <button
                type="button"
                onClick={() => switchReaderMode('single')}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium ${
                  readerMode === 'single' ? 'bg-rose-600 text-white' : 'text-zinc-400'
                }`}
              >
                <FileImage className="h-3.5 w-3.5" />
                {t('reader.modePage')}
              </button>
              <button
                type="button"
                onClick={() => switchReaderMode('double')}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium ${
                  readerMode === 'double' ? 'bg-rose-600 text-white' : 'text-zinc-400'
                }`}
              >
                <Columns2 className="h-3.5 w-3.5" />
                {t('reader.modeDouble')}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              title={t('reader.optionsTooltip')}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              title={t('reader.helpTooltip')}
              aria-label={t('reader.helpTooltip')}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800"
            >
              <CircleHelp className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              title={t('reader.fullscreenTooltip')}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800"
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {showOptions && (
          <div className="border-t border-zinc-800/80 bg-[#0f1018] px-6 py-3 text-xs">
            <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-zinc-400">{t('reader.directionLabel')}</span>
                <button
                  type="button"
                  onClick={() => {
                    const nextDir: ReadingDirection = direction === 'ltr' ? 'rtl' : 'ltr';
                    setDirection(nextDir);
                    void persistReaderPref({ readingDirection: nextDir });
                  }}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 font-semibold text-zinc-200"
                >
                  {direction === 'ltr' ? t('reader.dirLtr') : t('reader.dirRtl')}
                </button>
              </div>

              {readerMode === 'webtoon' && (
                <>
                  <label className="flex items-center gap-3 text-zinc-400">
                    {t('reader.widthLabel', { px: webtoonWidth })}
                    <input
                      type="range"
                      min={560}
                      max={1200}
                      step={20}
                      value={webtoonWidth}
                      onChange={(e) => {
                        const w = Number.parseInt(e.target.value, 10);
                        setWebtoonWidth(w);
                        void persistReaderPref({ webtoonWidth: w });
                      }}
                      className="accent-rose-500"
                    />
                  </label>
                  <label className="flex items-center gap-3 text-zinc-400">
                    {t('reader.gapLabel', { px: webtoonGap })}
                    <input
                      type="range"
                      min={0}
                      max={32}
                      step={4}
                      value={webtoonGap}
                      onChange={(e) => {
                        const g = Number.parseInt(e.target.value, 10);
                        setWebtoonGap(g);
                        void persistReaderPref({ webtoonGap: g });
                      }}
                      className="accent-rose-500"
                    />
                  </label>
                </>
              )}

              {readerMode !== 'webtoon' && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-400">{t('reader.fitLabel')}</span>
                    <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
                      {(
                        [
                          { id: 'contain', labelKey: 'reader.fitContain' },
                          { id: 'width', labelKey: 'reader.fitWidth' },
                          { id: 'original', labelKey: 'reader.fitOriginal' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setPageFitMode(opt.id);
                            void persistReaderPref({ pageFitMode: opt.id });
                          }}
                          className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                            pageFitMode === opt.id
                              ? 'bg-rose-600 text-white'
                              : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {t(opt.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="text-zinc-400 mr-1">{t('reader.zoomLabel')}</span>
                    <button
                      type="button"
                      onClick={() => setZoomPercent((z) => Math.max(60, z - 15))}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 p-1 text-zinc-200 hover:bg-zinc-800"
                      title={t('reader.zoomOut')}
                    >
                      <ZoomOut className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-[3rem] text-center font-mono text-zinc-200">
                      {zoomPercent}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setZoomPercent((z) => Math.min(200, z + 15))}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 p-1 text-zinc-200 hover:bg-zinc-800"
                      title={t('reader.zoomIn')}
                    >
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                    {zoomPercent !== 100 && (
                      <button
                        type="button"
                        onClick={() => setZoomPercent(100)}
                        className="rounded-lg border border-zinc-700 bg-zinc-900 p-1 text-zinc-300 hover:bg-zinc-800"
                        title={t('reader.zoomReset')}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </>
              )}

              {readerMode === 'double' && (
                <label className="flex cursor-pointer items-center gap-2 text-zinc-300">
                  <input
                    type="checkbox"
                    checked={doubleOffset}
                    onChange={(e) => {
                      setDoubleOffset(e.target.checked);
                      void persistReaderPref({ doublePageOffset: e.target.checked });
                    }}
                    className="accent-rose-500"
                  />
                  {t('reader.doubleCoverOffset')}
                </label>
              )}

              <label className="flex items-center gap-3 text-zinc-400">
                {t('reader.preloadLabel', { count: preloadCount })}
                <input
                  type="range"
                  min={0}
                  max={15}
                  step={1}
                  value={preloadCount}
                  onChange={(e) => {
                    const count = Number.parseInt(e.target.value, 10);
                    setPreloadCount(count);
                    void persistReaderPref({ preloadPagesCount: count });
                  }}
                  className="accent-rose-500"
                />
              </label>

              <span className="text-zinc-500">{t('reader.shortcuts')}</span>
            </div>
          </div>
        )}
      </header>

      {/* Bouton discret pour réafficher le HUD si masqué */}
      {!showHud && (
        <button
          type="button"
          onClick={() => setShowHud(true)}
          className="fixed right-4 top-4 z-30 rounded-full border border-zinc-700 bg-zinc-900/80 p-2 text-zinc-300 backdrop-blur hover:bg-zinc-800"
          title={t('reader.showControls')}
        >
          <Eye className="h-4 w-4" />
        </button>
      )}

      {/* Zone principale de lecture */}
      <div className="pt-14 pb-24">
        {loadingPages && (
          <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-zinc-400">
            <Loader2 className="h-8 w-8 animate-spin text-rose-500" />
            <p className="text-sm">{t('reader.fetchingPages')}</p>
          </div>
        )}

        {pageError?.kind === 'cloudflare' && source && (
          <div className="mx-auto max-w-2xl px-4 py-20">
            <CloudflareBanner
              sourceName={source.name}
              url={pageError.url}
              probeUrl={pageError.probeUrl}
              onRetry={() => setReloadNonce((n) => n + 1)}
            />
          </div>
        )}

        {pageError?.kind === 'error' && (
          <div className="mx-auto max-w-xl px-4 py-20 text-center">
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-200">
              {pageError.message}
            </div>
          </div>
        )}

        {!loadingPages && !pageError && pages.length > 0 && readerMode === 'webtoon' && (
          <div
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('button, a, input')) return;
              setShowHud((v) => !v);
            }}
            className="mx-auto flex flex-col items-center px-2"
            style={{ maxWidth: `${webtoonWidth}px`, gap: `${webtoonGap}px` }}
          >
            {pages.map((p, idx) => (
              <LazyWebtoonPage
                key={p.imageUrl}
                page={p}
                index={idx}
                referer={source?.baseUrl}
                scopeId={scopeId}
                offlineChapterId={isOfflineCached ? chapterId : undefined}
                t={t}
                registerRef={(el) => {
                  webtoonRefs.current[idx] = el;
                }}
              />
            ))}
          </div>
        )}

        {!loadingPages && !pageError && pages.length > 0 && readerMode !== 'webtoon' && (
          <div
            onClick={handleStageClick}
            className="relative flex min-h-[calc(100vh-8.5rem)] items-center justify-center px-14"
          >
            <button
              type="button"
              disabled={direction === 'rtl' ? !canGoNextPage : !canGoPrevPage}
              onClick={() => goStep(direction === 'rtl' ? 1 : -1)}
              aria-label={direction === 'rtl' ? t('reader.nextPageTooltip') : t('reader.prevPageTooltip')}
              title={`${direction === 'rtl' ? t('reader.nextPageTooltip') : t('reader.prevPageTooltip')} (←)`}
              className="fixed left-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-zinc-700/80 bg-zinc-900/85 p-3 text-zinc-100 shadow-lg backdrop-blur transition hover:border-rose-500 hover:bg-rose-600 disabled:pointer-events-none disabled:opacity-25"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <button
              type="button"
              disabled={direction === 'rtl' ? !canGoPrevPage : !canGoNextPage}
              onClick={() => goStep(direction === 'rtl' ? -1 : 1)}
              aria-label={direction === 'rtl' ? t('reader.prevPageTooltip') : t('reader.nextPageTooltip')}
              title={`${direction === 'rtl' ? t('reader.prevPageTooltip') : t('reader.nextPageTooltip')} (→)`}
              className="fixed right-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-zinc-700/80 bg-zinc-900/85 p-3 text-zinc-100 shadow-lg backdrop-blur transition hover:border-rose-500 hover:bg-rose-600 disabled:pointer-events-none disabled:opacity-25"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            {readerMode === 'single' && (
              <div style={zoomPercent !== 100 ? { zoom: zoomPercent / 100 } : undefined}>
                <AntiHotlinkImage
                  key={pages[currentPage]?.imageUrl}
                  src={pages[currentPage]?.imageUrl}
                  referer={source?.baseUrl}
                  scopeId={scopeId}
                  offlineChapterId={isOfflineCached ? chapterId : undefined}
                  pageIndex={pages[currentPage]?.index}
                  alt={t('reader.pageAlt', { num: currentPage + 1 })}
                  loadingLabel={t('reader.loadingPage', { num: currentPage + 1 })}
                  priority="high"
                  showRetry
                  placeholderClassName="h-[68vh] w-[min(85vw,680px)] rounded-xl"
                  className={
                    pageFitMode === 'width'
                      ? 'w-[min(92vw,1100px)] max-w-none rounded object-contain shadow-2xl'
                      : pageFitMode === 'original'
                        ? 'max-w-none rounded object-contain shadow-2xl'
                        : 'max-h-[calc(100vh-9.5rem)] max-w-full rounded object-contain shadow-2xl'
                  }
                />
              </div>
            )}

            {readerMode === 'double' && (
              <div
                style={zoomPercent !== 100 ? { zoom: zoomPercent / 100 } : undefined}
                className={`flex max-w-full flex-nowrap items-center justify-center gap-2 ${
                  direction === 'rtl' ? 'flex-row-reverse' : 'flex-row'
                }`}
              >
                {(spreads[currentSpreadIndex] ?? []).map((p) => (
                  <AntiHotlinkImage
                    key={p.imageUrl}
                    src={p.imageUrl}
                    referer={source?.baseUrl}
                    scopeId={scopeId}
                    offlineChapterId={isOfflineCached ? chapterId : undefined}
                    pageIndex={p.index}
                    alt={t('reader.pageAlt', { num: p.index + 1 })}
                    loadingLabel={t('reader.loadingPage', { num: p.index + 1 })}
                    priority="high"
                    showRetry
                    placeholderClassName="h-[68vh] w-[42vw] max-w-[540px] rounded-xl"
                    className={
                      pageFitMode === 'width'
                        ? 'max-w-[46vw] w-auto rounded object-contain shadow-2xl'
                        : pageFitMode === 'original'
                          ? 'max-w-none w-auto rounded object-contain shadow-2xl'
                          : 'max-h-[calc(100vh-9.5rem)] max-w-[45vw] w-auto rounded object-contain shadow-2xl'
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Fin de chapitre */}
        {!loadingPages && !pageError && pages.length > 0 && (
          <div className="mx-auto mt-8 flex max-w-xl flex-wrap items-center justify-center gap-3 px-4">
            <button
              type="button"
              onClick={() => navigate({ name: 'manga', mangaId })}
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
            >
              {t('reader.backToManga')}
            </button>
            {nextChapter && (
              <button
                type="button"
                onClick={() =>
                  navigate({ name: 'reader', mangaId, chapterId: nextChapter.id })
                }
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-rose-500"
              >
                {t('reader.nextChapterCta', { title: nextChapter.title })}
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Barre inférieure de progression */}
      {pages.length > 0 && (
        <footer
          className={`fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800/80 bg-[#0b0b10]/95 px-4 py-2.5 backdrop-blur-md transition-transform duration-200 ${
            showHud ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          <div className="mx-auto flex max-w-4xl items-center gap-3 text-xs">
            {readerMode !== 'webtoon' && (
              <button
                type="button"
                disabled={!canGoPrevPage}
                onClick={() => goStep(-1)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-35"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {t('reader.prevShort')}
              </button>
            )}
            <span className="min-w-[6.5rem] shrink-0 text-center font-mono text-zinc-400">
              {(() => {
                if (readerMode === 'double') {
                  const spread = spreads[currentSpreadIndex] ?? [];
                  if (spread.length >= 2) {
                    return t('reader.pagesRange', {
                      start: spread[0]!.index + 1,
                      end: spread[spread.length - 1]!.index + 1,
                      total: pages.length,
                    });
                  }
                  if (spread.length === 1) {
                    return t('reader.pageCounter', {
                      current: spread[0]!.index + 1,
                      total: pages.length,
                    });
                  }
                }
                return t('reader.pageCounter', { current: currentPage + 1, total: pages.length });
              })()}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, pages.length - 1)}
              value={currentPage}
              onChange={(e) => {
                const targetIdx = Number.parseInt(e.target.value, 10);
                setCurrentPage(targetIdx);
                if (readerMode === 'webtoon') {
                  webtoonRefs.current[targetIdx]?.scrollIntoView({ behavior: 'smooth' });
                }
              }}
              className="flex-1 accent-rose-500"
            />
            {readerMode !== 'webtoon' && (
              <button
                type="button"
                disabled={!canGoNextPage}
                onClick={() => goStep(1)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-35"
              >
                {t('reader.nextShort')}
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </footer>
      )}

      {/* Keyboard Shortcuts Help Modal (?) */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => setShowHelp(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reader-help-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-800 bg-[#12121a] p-6 text-sm shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 id="reader-help-title" className="text-base font-bold text-white">
                {t('reader.helpTitle')}
              </h2>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setShowHelp(false)}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="space-y-2 text-xs text-zinc-300">
              <li>{t('reader.helpKeyArrows')}</li>
              <li>{t('reader.helpKeySpace')}</li>
              <li>{t('reader.helpKeyFullscreen')}</li>
              <li>{t('reader.helpKeyMode')}</li>
              <li>{t('reader.helpKeyChapters')}</li>
              <li>{t('reader.helpKeyHelp')}</li>
              <li>{t('reader.helpKeyEsc')}</li>
            </ul>
            <p className="border-t border-zinc-800 pt-3 text-xs text-zinc-400">
              {t('reader.helpClickZones')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
