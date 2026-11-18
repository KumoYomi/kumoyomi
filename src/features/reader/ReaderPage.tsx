import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Columns2,
  ExternalLink,
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
import { ChapterPickerMenu } from '@/src/components/ChapterPickerMenu';
import { CloudflareBanner } from '@/src/components/CloudflareBanner';
import { ReaderProgressScrubber } from '@/src/components/ReaderProgressScrubber';
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
import { applyThemeToDocument } from '@/src/core/theme/theme';
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
  forceLoad?: boolean;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  registerRef: (el: HTMLDivElement | null) => void;
  onImageLoad?: (index: number) => void;
}

function LazyWebtoonPage({
  page,
  index,
  referer,
  scopeId,
  offlineChapterId,
  forceLoad = false,
  t,
  registerRef,
  onImageLoad,
}: LazyWebtoonPageProps) {
  const [shouldLoad, setShouldLoad] = useState(index <= 2 || forceLoad);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (forceLoad && !shouldLoad) {
      setShouldLoad(true);
    }
  }, [forceLoad, shouldLoad]);

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
      className="webtoon-page-item w-full scroll-mt-16"
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
          onImageLoad={() => onImageLoad?.(index)}
          placeholderClassName="mx-auto min-h-[65dvh] w-full rounded-lg"
          className="mx-auto block w-full object-contain"
        />
      ) : (
        <div className="mx-auto flex min-h-[65dvh] w-full flex-col items-center justify-center gap-2 rounded-lg border border-white/10 bg-slate-950/80 text-slate-500">
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
  const savedSettings = useLiveQuery(
    async () => {
      const row = await db.settings.get('default');
      return row ? { ...DEFAULT_APP_SETTINGS, ...row } : DEFAULT_APP_SETTINGS;
    },
    [],
    null,
  );
  const offlineMetas =
    useLiveQuery(() => db.offlineChapters.where('mangaId').equals(mangaId).toArray(), [mangaId], []) ??
    [];
  const offlineChapterIds = useMemo(
    () => new Set(offlineMetas.map((m) => m.chapterId)),
    [offlineMetas],
  );

  useEffect(() => {
    if (!savedSettings) return;
    applyThemeToDocument(
      savedSettings.themeMode ?? 'midnight',
      savedSettings.accentColor ?? 'aurora',
    );
  }, [savedSettings?.themeMode, savedSettings?.accentColor]);

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
  const pageContentRef = useRef<HTMLDivElement | null>(null);
  const restoredChapterRef = useRef<string>('');
  const loadedKeyRef = useRef<string>('');
  const lastRecordedProgressRef = useRef<string>('');
  const seekTargetRef = useRef<{ index: number; expiresAt: number } | null>(null);
  const persistChainRef = useRef<Promise<unknown>>(Promise.resolve());
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
            } else {
              seekTargetRef.current = { index: initial, expiresAt: Date.now() + 1400 };
              requestAnimationFrame(() => {
                webtoonRefs.current[initial]?.scrollIntoView({ behavior: 'auto', block: 'start' });
              });
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
        await fetchImageAsBlobUrl(p.imageUrl, p.headers?.Referer || baseUrl, scopeId, { priority: 'normal' }).catch(
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

  // Suivi fiable de la page visible en mode Webtoon (avec verrou de saut anti-glisse)
  useEffect(() => {
    if (readerMode !== 'webtoon' || pages.length === 0) return;
    let rafId = 0;

    const detectVisiblePage = () => {
      rafId = 0;
      const seek = seekTargetRef.current;
      if (seek && Date.now() < seek.expiresAt) {
        return;
      }
      seekTargetRef.current = null;

      const probeY = window.innerHeight * 0.42;
      let bestIdx = 0;
      let bestDist = Number.POSITIVE_INFINITY;

      for (let i = 0; i < pages.length; i += 1) {
        const el = webtoonRefs.current[i];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= probeY && rect.bottom >= probeY) {
          bestIdx = i;
          bestDist = 0;
          break;
        }
        const dist =
          rect.top > probeY
            ? rect.top - probeY
            : rect.bottom < probeY
              ? probeY - rect.bottom
              : 0;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }

      setCurrentPage((prev) => (prev === bestIdx ? prev : bestIdx));
    };

    const scheduleDetect = () => {
      if (!rafId) {
        rafId = requestAnimationFrame(detectVisiblePage);
      }
    };

    const cancelSeekOnUserScroll = () => {
      seekTargetRef.current = null;
      scheduleDetect();
    };

    window.addEventListener('scroll', scheduleDetect, { passive: true });
    window.addEventListener('wheel', cancelSeekOnUserScroll, { passive: true });
    window.addEventListener('touchmove', cancelSeekOnUserScroll, { passive: true });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', scheduleDetect);
      window.removeEventListener('wheel', cancelSeekOnUserScroll);
      window.removeEventListener('touchmove', cancelSeekOnUserScroll);
    };
  }, [readerMode, pages.length]);

  // Repositionne immédiatement vers la page cible si un saut vient d'être déclenché
  // et qu'une image au-dessus change de hauteur en finissant de charger
  const handleWebtoonImageLoaded = useCallback((loadedIdx: number) => {
    const seek = seekTargetRef.current;
    if (!seek || Date.now() >= seek.expiresAt) return;
    if (loadedIdx <= seek.index) {
      webtoonRefs.current[seek.index]?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }, []);

  const jumpToPage = useCallback(
    (targetIdx: number) => {
      if (pages.length === 0) return;
      const clamped = Math.max(0, Math.min(pages.length - 1, targetIdx));
      seekTargetRef.current = { index: clamped, expiresAt: Date.now() + 1400 };
      setCurrentPage(clamped);
      if (readerMode === 'webtoon') {
        requestAnimationFrame(() => {
          webtoonRefs.current[clamped]?.scrollIntoView({ behavior: 'auto', block: 'start' });
        });
      }
    },
    [pages.length, readerMode],
  );

  const switchReaderMode = useCallback((nextMode: ReaderMode) => {
    setReaderMode(nextMode);
    persistChainRef.current = persistChainRef.current.then(async () => {
      const current = await getOrCreateSettings();
      await db.settings.put({ ...current, readerMode: nextMode });
    });
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
      if ((e.target as HTMLElement).closest('button, a, input, select, [data-no-stage-tap]')) {
        return;
      }
      if (typeof window !== 'undefined' && window.getSelection()?.toString()) {
        return;
      }

      const contentRect = pageContentRef.current?.getBoundingClientRect();
      if (contentRect && contentRect.width > 40) {
        if (e.clientX < contentRect.left) {
          goStep(direction === 'rtl' ? 1 : -1);
          return;
        }
        if (e.clientX > contentRect.right) {
          goStep(direction === 'rtl' ? -1 : 1);
          return;
        }
        const relInPage = (e.clientX - contentRect.left) / contentRect.width;
        if (relInPage < 0.34) {
          goStep(direction === 'rtl' ? 1 : -1);
        } else if (relInPage > 0.66) {
          goStep(direction === 'rtl' ? -1 : 1);
        } else {
          setShowHud((v) => !v);
        }
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
      if (ratio < 0.34) {
        goStep(direction === 'rtl' ? 1 : -1);
      } else if (ratio > 0.66) {
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
    persistChainRef.current = persistChainRef.current.then(async () => {
      const current = await getOrCreateSettings();
      await db.settings.put({ ...current, ...patch });
    });
    await persistChainRef.current;
  }

  return (
    <div className="relative min-h-dvh bg-[var(--ky-reader-bg)] text-slate-100 select-none">
      {/* Barre supérieure flottante */}
      <header
        className={`ky-reader-bar fixed inset-x-0 top-0 z-30 border-b backdrop-blur-md transition-transform duration-200 ${
          showHud ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-2.5 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => navigate({ name: 'manga', mangaId })}
              aria-label={t('common.back')}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden md:inline">{t('common.back')}</span>
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-xs font-semibold text-white sm:text-sm">
                  {manga?.title ?? t('common.loading')}
                </p>
                {isOfflineCached && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                    <HardDrive className="h-3 w-3" />
                    <span className="hidden sm:inline">{t('common.offline')}</span>
                  </span>
                )}
              </div>
              <p className="truncate text-[11px] text-slate-400 sm:text-xs">
                {chapter?.title ?? ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
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
                className="rounded-lg border border-white/15 bg-white/5 p-1.5 text-slate-200 transition hover:bg-white/10 disabled:opacity-35"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <ChapterPickerMenu
                chapters={orderedAscChapters}
                activeChapterId={chapterId}
                offlineChapterIds={offlineChapterIds}
                onSelect={(nextId) => navigate({ name: 'reader', mangaId, chapterId: nextId })}
                labels={{
                  selectAria: t('reader.selectChapter'),
                  searchPlaceholder: t('reader.searchChapterPlaceholder'),
                  emptyMatch: t('reader.noMatchingChapter'),
                  reverseOrder: t('reader.reverseChapterOrder'),
                  pageProgress: (page, total) =>
                    total > 0 ? `p. ${page}/${total}` : `p. ${page}`,
                  newBadge: t('common.new'),
                }}
              />
              <button
                type="button"
                disabled={!nextChapter}
                title={t('reader.nextChapter')}
                onClick={() =>
                  nextChapter &&
                  navigate({ name: 'reader', mangaId, chapterId: nextChapter.id })
                }
                className="rounded-lg border border-white/15 bg-white/5 p-1.5 text-slate-200 transition hover:bg-white/10 disabled:opacity-35"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              {sourceChapterUrl && (
                <a
                  href={sourceChapterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t('reader.openChapterOnWebsiteTitle')}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline">{t('reader.openChapterOnWebsite')}</span>
                </a>
              )}
            </div>

            {/* Modes de lecture */}
            <div className="flex items-center rounded-xl border border-white/15 bg-black/35 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => switchReaderMode('webtoon')}
                title={t('reader.modeWebtoon')}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium transition sm:px-2.5 ${
                  readerMode === 'webtoon' ? 'ky-btn-primary' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <Rows3 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('reader.modeWebtoon')}</span>
              </button>
              <button
                type="button"
                onClick={() => switchReaderMode('single')}
                title={t('reader.modePage')}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium transition sm:px-2.5 ${
                  readerMode === 'single' ? 'ky-btn-primary' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <FileImage className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('reader.modePage')}</span>
              </button>
              <button
                type="button"
                onClick={() => switchReaderMode('double')}
                title={t('reader.modeDouble')}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium transition sm:px-2.5 ${
                  readerMode === 'double' ? 'ky-btn-primary' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <Columns2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('reader.modeDouble')}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              title={t('reader.optionsTooltip')}
              className={`rounded-xl border p-1.5 transition sm:p-2 ${
                showOptions
                  ? 'ky-pill-active border-transparent'
                  : 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              title={t('reader.helpTooltip')}
              aria-label={t('reader.helpTooltip')}
              className="hidden rounded-xl border border-white/15 bg-white/5 p-1.5 text-slate-200 transition hover:bg-white/10 sm:inline-flex sm:p-2"
            >
              <CircleHelp className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              title={t('reader.fullscreenTooltip')}
              className="rounded-xl border border-white/15 bg-white/5 p-1.5 text-slate-200 transition hover:bg-white/10 sm:p-2"
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
          <div className="max-h-[70dvh] overflow-y-auto border-t border-white/10 bg-[#0d1220]/95 px-4 py-3 text-xs">
            <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-center sm:gap-5">
              <div className="flex items-center justify-between gap-2 sm:justify-start">
                <span className="text-slate-400">{t('reader.directionLabel')}</span>
                <button
                  type="button"
                  onClick={() => {
                    const nextDir: ReadingDirection = direction === 'ltr' ? 'rtl' : 'ltr';
                    setDirection(nextDir);
                    void persistReaderPref({ readingDirection: nextDir });
                  }}
                  className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 font-semibold text-slate-100 hover:bg-white/10"
                >
                  {direction === 'ltr' ? t('reader.dirLtr') : t('reader.dirRtl')}
                </button>
              </div>

              {readerMode === 'webtoon' && (
                <>
                  <label className="flex items-center justify-between gap-3 text-slate-400 sm:justify-start">
                    <span>{t('reader.widthLabel', { px: webtoonWidth })}</span>
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
                      className="w-32 accent-[var(--ky-accent)]"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-slate-400 sm:justify-start">
                    <span>{t('reader.gapLabel', { px: webtoonGap })}</span>
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
                      className="w-28 accent-[var(--ky-accent)]"
                    />
                  </label>
                </>
              )}

              {readerMode !== 'webtoon' && (
                <>
                  <div className="flex items-center justify-between gap-1.5 sm:justify-start">
                    <span className="text-slate-400">{t('reader.fitLabel')}</span>
                    <div className="flex items-center rounded-lg border border-white/15 bg-black/40 p-0.5">
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
                          className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                            pageFitMode === opt.id
                              ? 'ky-btn-primary'
                              : 'text-slate-400 hover:text-slate-100'
                          }`}
                        >
                          {t(opt.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-1 sm:justify-start">
                    <span className="mr-1 text-slate-400">{t('reader.zoomLabel')}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setZoomPercent((z) => Math.max(60, z - 15))}
                        className="rounded-lg border border-white/15 bg-white/5 p-1 text-slate-100 hover:bg-white/10"
                        title={t('reader.zoomOut')}
                      >
                        <ZoomOut className="h-3.5 w-3.5" />
                      </button>
                      <span className="min-w-[3rem] text-center font-mono text-slate-100">
                        {zoomPercent}%
                      </span>
                      <button
                        type="button"
                        onClick={() => setZoomPercent((z) => Math.min(200, z + 15))}
                        className="rounded-lg border border-white/15 bg-white/5 p-1 text-slate-100 hover:bg-white/10"
                        title={t('reader.zoomIn')}
                      >
                        <ZoomIn className="h-3.5 w-3.5" />
                      </button>
                      {zoomPercent !== 100 && (
                        <button
                          type="button"
                          onClick={() => setZoomPercent(100)}
                          className="rounded-lg border border-white/15 bg-white/5 p-1 text-slate-300 hover:bg-white/10"
                          title={t('reader.zoomReset')}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}

              {readerMode === 'double' && (
                <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                  <input
                    type="checkbox"
                    checked={doubleOffset}
                    onChange={(e) => {
                      setDoubleOffset(e.target.checked);
                      void persistReaderPref({ doublePageOffset: e.target.checked });
                    }}
                    className="accent-[var(--ky-accent)]"
                  />
                  {t('reader.doubleCoverOffset')}
                </label>
              )}

              <label className="flex items-center justify-between gap-3 text-slate-400 sm:justify-start">
                <span>{t('reader.preloadLabel', { count: preloadCount })}</span>
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
                  className="w-28 accent-[var(--ky-accent)]"
                />
              </label>

              <span className="hidden text-slate-500 xl:inline">{t('reader.shortcuts')}</span>
            </div>
          </div>
        )}
      </header>

      {/* Bouton discret pour réafficher le HUD si masqué */}
      {!showHud && (
        <button
          type="button"
          onClick={() => setShowHud(true)}
          className="fixed right-3 top-3 z-30 rounded-full border border-white/20 bg-slate-900/80 p-2 text-slate-200 shadow-lg backdrop-blur hover:bg-slate-800 sm:right-4 sm:top-4"
          title={t('reader.showControls')}
        >
          <Eye className="h-4 w-4" />
        </button>
      )}

      {/* Zone principale de lecture */}
      <div className="pt-14 pb-20 sm:pb-24">
        {loadingPages && (
          <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--ky-accent)]" />
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
              if ((e.target as HTMLElement).closest('button, a, input, [data-no-stage-tap]')) return;
              setShowHud((v) => !v);
            }}
            className="mx-auto flex flex-col items-center px-1.5 sm:px-3"
            style={{ maxWidth: `${webtoonWidth}px`, gap: `${webtoonGap}px` }}
          >
            {pages.map((p, idx) => (
              <LazyWebtoonPage
                key={p.imageUrl}
                page={p}
                index={idx}
                referer={p.headers?.Referer || source?.baseUrl}
                scopeId={scopeId}
                offlineChapterId={isOfflineCached ? chapterId : undefined}
                forceLoad={Math.abs(idx - currentPage) <= 1}
                t={t}
                onImageLoad={handleWebtoonImageLoaded}
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
            className="relative flex min-h-[calc(100dvh-8.5rem)] cursor-pointer items-center justify-center px-2 sm:px-14"
          >
            <button
              type="button"
              disabled={direction === 'rtl' ? !canGoNextPage : !canGoPrevPage}
              onClick={() => goStep(direction === 'rtl' ? 1 : -1)}
              aria-label={direction === 'rtl' ? t('reader.nextPageTooltip') : t('reader.prevPageTooltip')}
              title={`${direction === 'rtl' ? t('reader.nextPageTooltip') : t('reader.prevPageTooltip')} (←)`}
              className="fixed left-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full border border-white/15 bg-slate-900/80 p-3 text-slate-100 shadow-lg backdrop-blur transition hover:border-[var(--ky-accent-ring)] hover:bg-[var(--ky-accent)] disabled:pointer-events-none disabled:opacity-20 md:inline-flex"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <button
              type="button"
              disabled={direction === 'rtl' ? !canGoPrevPage : !canGoNextPage}
              onClick={() => goStep(direction === 'rtl' ? -1 : 1)}
              aria-label={direction === 'rtl' ? t('reader.prevPageTooltip') : t('reader.nextPageTooltip')}
              title={`${direction === 'rtl' ? t('reader.prevPageTooltip') : t('reader.nextPageTooltip')} (→)`}
              className="fixed right-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full border border-white/15 bg-slate-900/80 p-3 text-slate-100 shadow-lg backdrop-blur transition hover:border-[var(--ky-accent-ring)] hover:bg-[var(--ky-accent)] disabled:pointer-events-none disabled:opacity-20 md:inline-flex"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            <div
              ref={pageContentRef}
              className="flex max-w-full items-center justify-center"
            >
              {readerMode === 'single' && (
                <div style={zoomPercent !== 100 ? { zoom: zoomPercent / 100 } : undefined}>
                    <AntiHotlinkImage
                      key={pages[currentPage]?.imageUrl}
                      src={pages[currentPage]?.imageUrl}
                      referer={pages[currentPage]?.headers?.Referer || source?.baseUrl}
                      scopeId={scopeId}
                    offlineChapterId={isOfflineCached ? chapterId : undefined}
                    pageIndex={pages[currentPage]?.index}
                    alt={t('reader.pageAlt', { num: currentPage + 1 })}
                    loadingLabel={t('reader.loadingPage', { num: currentPage + 1 })}
                    priority="high"
                    showRetry
                    placeholderClassName="h-[68dvh] w-[min(92vw,680px)] rounded-xl"
                    className={
                      pageFitMode === 'width'
                        ? 'w-[min(96vw,1100px)] max-w-none rounded object-contain shadow-2xl'
                        : pageFitMode === 'original'
                          ? 'max-w-none rounded object-contain shadow-2xl'
                          : 'max-h-[calc(100dvh-9rem)] max-w-full rounded object-contain shadow-2xl'
                    }
                  />
                </div>
              )}

              {readerMode === 'double' && (
                <div
                  style={zoomPercent !== 100 ? { zoom: zoomPercent / 100 } : undefined}
                  className={`flex max-w-full flex-nowrap items-center justify-center gap-1.5 sm:gap-2 ${
                    direction === 'rtl' ? 'flex-row-reverse' : 'flex-row'
                  }`}
                >
                  {(spreads[currentSpreadIndex] ?? []).map((p) => (
                    <AntiHotlinkImage
                      key={p.imageUrl}
                      src={p.imageUrl}
                      referer={p.headers?.Referer || source?.baseUrl}
                      scopeId={scopeId}
                      offlineChapterId={isOfflineCached ? chapterId : undefined}
                      pageIndex={p.index}
                      alt={t('reader.pageAlt', { num: p.index + 1 })}
                      loadingLabel={t('reader.loadingPage', { num: p.index + 1 })}
                      priority="high"
                      showRetry
                      placeholderClassName="h-[65dvh] w-[44vw] max-w-[540px] rounded-xl"
                      className={
                        pageFitMode === 'width'
                          ? 'w-auto max-w-[47vw] rounded object-contain shadow-2xl'
                          : pageFitMode === 'original'
                            ? 'w-auto max-w-none rounded object-contain shadow-2xl'
                            : 'max-h-[calc(100dvh-9rem)] w-auto max-w-[47vw] rounded object-contain shadow-2xl sm:max-w-[45vw]'
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Fin de chapitre */}
        {!loadingPages && !pageError && pages.length > 0 && (
          <div className="mx-auto mt-8 flex max-w-xl flex-wrap items-center justify-center gap-3 px-4">
            <button
              type="button"
              onClick={() => navigate({ name: 'manga', mangaId })}
              className="rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
            >
              {t('reader.backToManga')}
            </button>
            {nextChapter && (
              <button
                type="button"
                onClick={() =>
                  navigate({ name: 'reader', mangaId, chapterId: nextChapter.id })
                }
                className="ky-btn-primary inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold"
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
          className={`ky-reader-bar fixed inset-x-0 bottom-0 z-30 border-t px-3 py-2 backdrop-blur-md transition-transform duration-200 sm:px-4 sm:py-2.5 ${
            showHud ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          <div className="mx-auto flex max-w-4xl items-center gap-2 text-xs sm:gap-3">
            {readerMode !== 'webtoon' && (
              <button
                type="button"
                disabled={!canGoPrevPage}
                onClick={() => goStep(-1)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 font-medium text-slate-100 hover:bg-white/10 disabled:opacity-35 sm:px-2.5"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('reader.prevShort')}</span>
              </button>
            )}
            <span className="min-w-[5rem] shrink-0 text-center font-mono text-[11px] text-slate-300 sm:min-w-[6.5rem] sm:text-xs">
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
            <ReaderProgressScrubber
              total={pages.length}
              value={currentPage}
              onCommit={jumpToPage}
              formatLabel={(p, n) => t('reader.pageCounter', { current: p, total: n })}
            />
            {readerMode !== 'webtoon' && (
              <button
                type="button"
                disabled={!canGoNextPage}
                onClick={() => goStep(1)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 font-medium text-slate-100 hover:bg-white/10 disabled:opacity-35 sm:px-2.5"
              >
                <span className="hidden sm:inline">{t('reader.nextShort')}</span>
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
            className="ky-dropdown-panel w-full max-w-md space-y-4 rounded-2xl p-6 text-sm"
          >
            <div className="flex items-center justify-between">
              <h2 id="reader-help-title" className="ky-heading text-base font-bold">
                {t('reader.helpTitle')}
              </h2>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setShowHelp(false)}
                className="ky-btn-secondary rounded-lg p-1.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="space-y-2 text-xs text-[var(--ky-text-secondary)]">
              <li>{t('reader.helpKeyArrows')}</li>
              <li>{t('reader.helpKeySpace')}</li>
              <li>{t('reader.helpKeyFullscreen')}</li>
              <li>{t('reader.helpKeyMode')}</li>
              <li>{t('reader.helpKeyChapters')}</li>
              <li>{t('reader.helpKeyHelp')}</li>
              <li>{t('reader.helpKeyEsc')}</li>
            </ul>
            <p className="border-t border-[var(--ky-border)] pt-3 text-xs text-[var(--ky-text-muted)]">
              {t('reader.helpClickZones')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
