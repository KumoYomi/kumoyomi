import { useLiveQuery } from 'dexie-react-hooks';
import {
  CheckCircle2,
  Compass,
  FileJson,
  FolderGit2,
  Link2,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '@/src/app/router';
import { AntiHotlinkImage } from '@/src/components/AntiHotlinkImage';
import { CloudflareBanner } from '@/src/components/CloudflareBanner';
import { db } from '@/src/core/db/db';
import {
  checkGlobalOriginPermission,
  checkOriginPermission,
  clearSiteTabProxied,
  isExtensionContext,
  isSiteTabProxied,
  requestOriginPermission,
  requestRepositoryOriginPermission,
} from '@/src/core/extension/browserBridge';
import { runWithAutoCloudflarePopup } from '@/src/core/extension/cfAutoVerify';
import { useTranslation } from '@/src/core/i18n';
import { revokeScopeBlobUrls } from '@/src/core/image-loader/blobImageLoader';
import { parserEngine } from '@/src/core/parser/engine';
import { CloudflareChallengeError } from '@/src/core/parser/httpClient';
import {
  addOrRefreshRepositoryByUrl,
  importLocalJsonConfig,
  removeRepository,
  removeSource,
  setSourceEnabled,
} from '@/src/core/parser/repositoryService';
import type { InstalledSourceRecord } from '@/src/core/types/manga';
import type {
  ParsedCataloguePage,
  ParsedChapterItem,
  ParsedMangaDetails,
  ParsedPageItem,
} from '@/src/core/types/source';

type TestResult =
  | { status: 'loading' }
  | { status: 'ok'; count: number; sampleTitle?: string }
  | { status: 'cloudflare'; url: string; probeUrl?: string }
  | { status: 'error'; message: string };

interface SourceInspectorPanelProps {
  source: InstalledSourceRecord;
  onClose: () => void;
}

function SourceInspectorPanel({ source, onClose }: SourceInspectorPanelProps) {
  const { t } = useTranslation();
  const [catMode, setCatMode] = useState<'popular' | 'latest' | 'search'>('popular');
  const [searchQuery, setSearchQuery] = useState('');
  const [catRunning, setCatRunning] = useState(false);
  const [catResult, setCatResult] = useState<{ ms: number; page: ParsedCataloguePage } | null>(null);
  const [catError, setCatError] = useState<string | null>(null);

  const [mangaUrl, setMangaUrl] = useState('');
  const [detailsRunning, setDetailsRunning] = useState(false);
  const [detailsResult, setDetailsResult] = useState<{
    ms: number;
    details: ParsedMangaDetails;
    chapters: ParsedChapterItem[];
  } | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const [chapterUrl, setChapterUrl] = useState('');
  const [pagesRunning, setPagesRunning] = useState(false);
  const [pagesResult, setPagesResult] = useState<{ ms: number; pages: ParsedPageItem[] } | null>(
    null,
  );
  const [pagesError, setPagesError] = useState<string | null>(null);

  const previewScope = `inspector_${source.id}`;
  useEffect(() => {
    return () => {
      revokeScopeBlobUrls(previewScope);
    };
  }, [previewScope]);

  async function runCatalogueTest() {
    setCatRunning(true);
    setCatError(null);
    const t0 = performance.now();
    try {
      const page = await runWithAutoCloudflarePopup(() => {
        if (catMode === 'latest') return parserEngine.getLatest(source.resolvedConfig, 1);
        if (catMode === 'search') {
          return parserEngine.search(source.resolvedConfig, searchQuery.trim() || 'a', 1);
        }
        return parserEngine.getPopular(source.resolvedConfig, 1);
      });
      setCatResult({ ms: Math.round(performance.now() - t0), page });
    } catch (err) {
      setCatError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setCatRunning(false);
    }
  }

  async function runDetailsTest(targetUrl = mangaUrl) {
    const clean = targetUrl.trim();
    if (!clean) return;
    setMangaUrl(clean);
    setDetailsRunning(true);
    setDetailsError(null);
    const t0 = performance.now();
    try {
      const data = await runWithAutoCloudflarePopup(async () => {
        const details = await parserEngine.getMangaDetails(source.resolvedConfig, clean);
        const chapters = await parserEngine.getChapters(
          source.resolvedConfig,
          details.url || clean,
          details.rawHtml,
          details.rawJson,
        );
        return { details, chapters };
      });
      setDetailsResult({ ms: Math.round(performance.now() - t0), ...data });
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setDetailsRunning(false);
    }
  }

  async function runPagesTest(targetUrl = chapterUrl) {
    const clean = targetUrl.trim();
    if (!clean) return;
    setChapterUrl(clean);
    setPagesRunning(true);
    setPagesError(null);
    const t0 = performance.now();
    try {
      const pages = await runWithAutoCloudflarePopup(() =>
        parserEngine.getChapterPages(source.resolvedConfig, clean),
      );
      setPagesResult({ ms: Math.round(performance.now() - t0), pages });
    } catch (err) {
      setPagesError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setPagesRunning(false);
    }
  }

  return (
    <div className="mt-3 space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/90 p-4 text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-2">
        <span className="flex items-center gap-2 font-semibold text-zinc-200">
          <Wrench className="h-3.5 w-3.5 text-rose-400" />
          {t('sources.inspectorTitle')}
        </span>
        <button
          type="button"
          onClick={onClose}
          title={t('sources.inspectorClose')}
          aria-label={t('sources.inspectorClose')}
          className="rounded-lg border border-zinc-800 bg-zinc-900 p-1 text-zinc-400 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Step 1: Catalogue / Search */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={catMode}
            onChange={(e) => setCatMode(e.target.value as 'popular' | 'latest' | 'search')}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-zinc-200"
          >
            <option value="popular">{t('sources.inspectorModePopular')}</option>
            <option value="latest">{t('sources.inspectorModeLatest')}</option>
            <option value="search">{t('sources.inspectorModeSearch')}</option>
          </select>
          {catMode === 'search' && (
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('common.search')}
              className="w-44 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-zinc-200"
            />
          )}
          <button
            type="button"
            disabled={catRunning}
            onClick={() => void runCatalogueTest()}
            className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
          >
            {catRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {t('sources.inspectorRunBtn')}
          </button>
          {catResult && (
            <span className="font-mono text-[11px] text-emerald-300">
              {catResult.page.items.length} item(s) · {t('sources.inspectorDuration', { ms: catResult.ms })} ·{' '}
              {t('sources.inspectorHasNext', { val: String(catResult.page.hasNextPage) })}
            </span>
          )}
        </div>
        {catError && <p className="text-rose-300">{catError}</p>}
        {catResult && catResult.page.items.length > 0 && (
          <div className="space-y-1">
            {catResult.page.items.slice(0, 3).map((item) => (
              <div
                key={item.url}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-zinc-200">{item.title}</p>
                  <p className="truncate font-mono text-[10px] text-zinc-500">{item.url}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void runDetailsTest(item.url)}
                  className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-medium text-rose-300 hover:bg-zinc-800"
                >
                  {t('sources.inspectorUseManga')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Step 2: Manga Details & Chapters */}
      <div className="space-y-2 border-t border-zinc-800/80 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="url"
            value={mangaUrl}
            onChange={(e) => setMangaUrl(e.target.value)}
            placeholder={t('sources.inspectorMangaUrlPlaceholder')}
            className="min-w-[220px] flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600"
          />
          <button
            type="button"
            disabled={detailsRunning || !mangaUrl.trim()}
            onClick={() => void runDetailsTest()}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
          >
            {detailsRunning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {t('sources.inspectorRunBtn')}
          </button>
          {detailsResult && (
            <span className="font-mono text-[11px] text-emerald-300">
              {t('sources.inspectorDetailsSection', { count: detailsResult.chapters.length })} ·{' '}
              {t('sources.inspectorDuration', { ms: detailsResult.ms })}
            </span>
          )}
        </div>
        {detailsError && <p className="text-rose-300">{detailsError}</p>}
        {detailsResult && (
          <div className="space-y-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
            <p className="text-zinc-200">
              <strong>{detailsResult.details.title}</strong> · {detailsResult.details.status}
              {detailsResult.details.author ? ` · ${detailsResult.details.author}` : ''}
              {detailsResult.details.genres.length > 0
                ? ` · [${detailsResult.details.genres.slice(0, 4).join(', ')}]`
                : ''}
            </p>
            {detailsResult.chapters.slice(0, 3).map((ch) => (
              <div
                key={ch.url}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-800/60 bg-zinc-950/60 px-2 py-1"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-zinc-300">{ch.title}</p>
                  <p className="truncate font-mono text-[10px] text-zinc-500">{ch.url}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void runPagesTest(ch.url)}
                  className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-medium text-rose-300 hover:bg-zinc-800"
                >
                  {t('sources.inspectorUseChapter')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Step 3: Chapter Pages + Live Referer Preview */}
      <div className="space-y-2 border-t border-zinc-800/80 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="url"
            value={chapterUrl}
            onChange={(e) => setChapterUrl(e.target.value)}
            placeholder={t('sources.inspectorChapterUrlPlaceholder')}
            className="min-w-[220px] flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600"
          />
          <button
            type="button"
            disabled={pagesRunning || !chapterUrl.trim()}
            onClick={() => void runPagesTest()}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
          >
            {pagesRunning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {t('sources.inspectorRunBtn')}
          </button>
          {pagesResult && (
            <span className="font-mono text-[11px] text-emerald-300">
              {t('sources.inspectorPagesCount', { count: pagesResult.pages.length })} ·{' '}
              {t('sources.inspectorDuration', { ms: pagesResult.ms })}
            </span>
          )}
        </div>
        {pagesError && <p className="text-rose-300">{pagesError}</p>}
        {pagesResult && pagesResult.pages.length > 0 && (
          <div className="space-y-2">
            <ul className="space-y-0.5 font-mono text-[10px] text-zinc-500">
              {pagesResult.pages.slice(0, 3).map((p) => (
                <li key={p.index} className="truncate">
                  #{p.index + 1}: {p.imageUrl}
                </li>
              ))}
            </ul>
            <p className="text-[11px] font-medium text-zinc-400">
              {t('sources.inspectorPreviewLabel')}
            </p>
            <AntiHotlinkImage
              src={pagesResult.pages[0]!.imageUrl}
              referer={source.baseUrl}
              scopeId={previewScope}
              alt="Page 1"
              className="max-h-64 w-auto rounded-lg border border-zinc-800 object-contain"
              placeholderClassName="h-44 w-36 rounded-lg"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function SourcesPage() {
  const { t } = useTranslation();
  const repositories = useLiveQuery(() => db.repositories.toArray(), [], []) ?? [];
  const sources = useLiveQuery(() => db.sources.toArray(), [], []) ?? [];

  const [repoUrlInput, setRepoUrlInput] = useState('');
  const [addingRepo, setAddingRepo] = useState(false);
  const [refreshingRepoId, setRefreshingRepoId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pastedJson, setPastedJson] = useState('');
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [permissionsMap, setPermissionsMap] = useState<Record<string, boolean>>({});
  const [sourceQuery, setSourceQuery] = useState('');
  const [langFilter, setLangFilter] = useState<string>('all');
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [sessionNonce, setSessionNonce] = useState(0);
  const [inspectingSourceId, setInspectingSourceId] = useState<string | null>(null);
  const globalPermRef = useRef(true);

  useEffect(() => {
    if (!isExtensionContext()) return;
    void checkGlobalOriginPermission().then((ok) => {
      globalPermRef.current = ok;
    });
  }, []);

  const availableLangs = useMemo(
    () => Array.from(new Set(sources.map((s) => s.lang.toLowerCase()))).sort(),
    [sources],
  );

  const visibleSources = useMemo(() => {
    const q = sourceQuery.trim().toLowerCase();
    return sources.filter((s) => {
      if (langFilter !== 'all' && s.lang.toLowerCase() !== langFilter) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.baseUrl.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [sources, langFilter, sourceQuery]);

  useEffect(() => {
    let active = true;
    (async () => {
      const next: Record<string, boolean> = {};
      for (const src of sources) {
        next[src.id] = await checkOriginPermission(src.baseUrl);
      }
      if (active) setPermissionsMap(next);
    })();
    return () => {
      active = false;
    };
  }, [sources]);

  async function handleAddRepository(e: FormEvent) {
    e.preventDefault();
    const rawUrl = repoUrlInput.trim();
    if (!rawUrl) return;
    // Call Firefox permissions.request synchronously inside user gesture before any await
    const permPromise =
      isExtensionContext() && !globalPermRef.current
        ? requestRepositoryOriginPermission(rawUrl)
        : null;
    setAddingRepo(true);
    setFeedback(null);
    try {
      if (permPromise) await permPromise;
      const res = await addOrRefreshRepositoryByUrl(rawUrl);
      setRepoUrlInput('');
      setFeedback({
        kind: 'ok',
        text: t('sources.repoAdded', {
          name: res.repo.name,
          sources: res.sourcesCount,
          templates: res.templatesCount,
        }),
      });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : t('sources.repoAddError'),
      });
    } finally {
      setAddingRepo(false);
    }
  }

  async function handleRefreshRepo(repoId: string, url: string) {
    if (url.startsWith('local://')) return;
    setRefreshingRepoId(repoId);
    setFeedback(null);
    try {
      const res = await addOrRefreshRepositoryByUrl(url);
      setFeedback({
        kind: 'ok',
        text: t('sources.repoRefreshed', {
          name: res.repo.name,
          sources: res.sourcesCount,
        }),
      });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : t('sources.repoRefreshError'),
      });
    } finally {
      setRefreshingRepoId(null);
    }
  }

  async function handleFileImport(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    setFeedback(null);
    try {
      const contents = await Promise.all(
        files.map(async (f) => ({ name: f.name, text: await f.text() })),
      );
      // Importer les modèles / manifestes en premier afin que `extends` se résolve si plusieurs fichiers sont sélectionnés ensemble.
      contents.sort((a, b) => {
        const score = (text: string) => {
          try {
            const obj = JSON.parse(text) as Record<string, unknown>;
            if (Array.isArray(obj.sources)) return 0;
            if (!obj.baseUrl) return 1;
            return 2;
          } catch {
            return 3;
          }
        };
        return score(a.text) - score(b.text);
      });

      const messages: string[] = [];
      for (const item of contents) {
        const res = await importLocalJsonConfig(item.text, item.name);
        messages.push(res.message);
      }
      setFeedback({ kind: 'ok', text: messages.join(' ') });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : t('sources.importError'),
      });
    }
  }

  async function handlePasteImport() {
    if (!pastedJson.trim()) return;
    setFeedback(null);
    try {
      const res = await importLocalJsonConfig(pastedJson, 'JSON');
      setPastedJson('');
      setShowPasteModal(false);
      setFeedback({ kind: 'ok', text: res.message });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : t('sources.invalidJson'),
      });
    }
  }

  async function handleRefreshAllRepos() {
    const remoteRepos = repositories.filter((r) => !r.url.startsWith('local://'));
    if (remoteRepos.length === 0) return;
    setRefreshingAll(true);
    setFeedback(null);
    let updatedSources = 0;
    try {
      for (const repo of remoteRepos) {
        const res = await addOrRefreshRepositoryByUrl(repo.url);
        updatedSources += res.sourcesCount;
      }
      setFeedback({
        kind: 'ok',
        text: t('sources.allReposRefreshed', {
          repos: remoteRepos.length,
          sources: updatedSources,
        }),
      });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : t('sources.syncError'),
      });
    } finally {
      setRefreshingAll(false);
    }
  }

  async function handleTestSource(source: InstalledSourceRecord) {
    // Request host permission synchronously inside the click handler before any await
    const permPromise =
      permissionsMap[source.id] === false ? requestOriginPermission(source.baseUrl) : null;
    setTestResults((prev) => ({ ...prev, [source.id]: { status: 'loading' } }));
    try {
      if (permPromise) {
        const granted = await permPromise;
        setPermissionsMap((prev) => ({ ...prev, [source.id]: granted }));
      }
      const page = await runWithAutoCloudflarePopup(() =>
        parserEngine.getPopular(source.resolvedConfig, 1),
      );
      setSessionNonce((n) => n + 1);
      setTestResults((prev) => ({
        ...prev,
        [source.id]: {
          status: 'ok',
          count: page.items.length,
          sampleTitle: page.items[0]?.title,
        },
      }));
    } catch (err) {
      if (err instanceof CloudflareChallengeError) {
        setTestResults((prev) => ({
          ...prev,
          [source.id]: { status: 'cloudflare', url: err.url, probeUrl: err.requestUrl },
        }));
      } else {
        setTestResults((prev) => ({
          ...prev,
          [source.id]: {
            status: 'error',
            message: err instanceof Error ? err.message : t('common.unknown'),
          },
        }));
      }
    }
  }

  function handleGrantPermission(source: InstalledSourceRecord) {
    void requestOriginPermission(source.baseUrl).then((granted) => {
      setPermissionsMap((prev) => ({ ...prev, [source.id]: granted }));
    });
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{t('sources.title')}</h1>
          <p className="mt-1 text-sm text-zinc-400">{t('sources.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800">
            <FileJson className="h-4 w-4 text-rose-400" />
            {t('sources.importJson')}
            <input
              type="file"
              accept=".json,application/json"
              multiple
              className="hidden"
              onChange={(e) => void handleFileImport(e)}
            />
          </label>
          <button
            type="button"
            onClick={() => setShowPasteModal((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 px-4 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
          >
            <Plus className="h-4 w-4" />
            {t('sources.pasteJson')}
          </button>
        </div>
      </header>

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            feedback.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Ajouter un dépôt URL / GitHub */}
      <section className="rounded-2xl border border-zinc-800/80 bg-[#12121a] p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Link2 className="h-4 w-4 text-rose-400" />
          {t('sources.addRepoTitle')}
        </h2>
        <form onSubmit={(e) => void handleAddRepository(e)} className="mt-3 flex flex-wrap gap-3">
          <input
            type="url"
            value={repoUrlInput}
            onChange={(e) => setRepoUrlInput(e.target.value)}
            placeholder={t('sources.repoPlaceholder')}
            className="min-w-[300px] flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={addingRepo || !repoUrlInput.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {addingRepo ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {t('sources.addRepoBtn')}
          </button>
        </form>
        <p className="mt-2 text-xs text-zinc-500">{t('sources.localHint')}</p>
      </section>

      {showPasteModal && (
        <section className="rounded-2xl border border-zinc-700 bg-[#14141e] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">{t('sources.pasteModalTitle')}</h3>
            <button
              type="button"
              onClick={() => setShowPasteModal(false)}
              className="text-xs text-zinc-400 hover:text-white"
            >
              {t('common.close')}
            </button>
          </div>
          <textarea
            rows={7}
            value={pastedJson}
            onChange={(e) => setPastedJson(e.target.value)}
            placeholder='{ "id": "my-source", "name": "...", "baseUrl": "https://...", "extends": "origines" }'
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-200 focus:border-rose-500/60 focus:outline-none"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handlePasteImport()}
              className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500"
            >
              {t('sources.pasteValidate')}
            </button>
          </div>
        </section>
      )}

      {/* Dépôts installés */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            {t('sources.reposSection', { count: repositories.length })}
          </h2>
          {repositories.some((r) => !r.url.startsWith('local://')) && (
            <button
              type="button"
              disabled={refreshingAll}
              onClick={() => void handleRefreshAllRepos()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshingAll ? 'animate-spin' : ''}`} />
              {t('sources.refreshAll')}
            </button>
          )}
        </div>
        {repositories.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/50 p-8 text-center">
            <FolderGit2 className="mx-auto h-9 w-9 text-zinc-600" />
            <p className="mt-3 text-sm font-medium text-zinc-300">{t('sources.noReposTitle')}</p>
            <p className="mt-1 text-xs text-zinc-500">{t('sources.noReposDesc')}</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {repositories.map((repo) => (
              <div
                key={repo.id}
                className="flex items-start justify-between gap-4 rounded-2xl border border-zinc-800/80 bg-[#12121a] p-4"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-white">{repo.name}</h3>
                    {repo.version && (
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                        v{repo.version}
                      </span>
                    )}
                  </div>
                  <p className="truncate font-mono text-xs text-zinc-500">{repo.url}</p>
                  {repo.description && (
                    <p className="text-xs text-zinc-400">{repo.description}</p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {!repo.url.startsWith('local://') && (
                    <button
                      type="button"
                      title={t('common.refresh')}
                      onClick={() => void handleRefreshRepo(repo.id, repo.url)}
                      disabled={refreshingRepoId === repo.id}
                      className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800"
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${refreshingRepoId === repo.id ? 'animate-spin' : ''}`}
                      />
                    </button>
                  )}
                  <button
                    type="button"
                    title={t('sources.deleteRepo')}
                    onClick={() => void removeRepository(repo.id)}
                    className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 hover:border-rose-500/40 hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sources configurées */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            {visibleSources.length !== sources.length
              ? t('sources.sourcesFiltered', {
                  shown: visibleSources.length,
                  total: sources.length,
                })
              : t('sources.sourcesSection', { shown: visibleSources.length })}
          </h2>

          {sources.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                  type="search"
                  value={sourceQuery}
                  onChange={(e) => setSourceQuery(e.target.value)}
                  placeholder={t('sources.filterSources')}
                  className="rounded-xl border border-zinc-800 bg-[#12121a] py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-rose-500/60 focus:outline-none"
                />
              </div>
              {availableLangs.length > 1 && (
                <div className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-[#12121a] p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setLangFilter('all')}
                    className={`rounded-lg px-2 py-1 font-medium ${
                      langFilter === 'all' ? 'bg-rose-600 text-white' : 'text-zinc-400'
                    }`}
                  >
                    {t('common.all')}
                  </button>
                  {availableLangs.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setLangFilter(lang)}
                      className={`rounded-lg px-2 py-1 font-medium uppercase ${
                        langFilter === lang ? 'bg-rose-600 text-white' : 'text-zinc-400'
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="space-y-3">
          {visibleSources.map((source) => {
            const test = testResults[source.id];
            const hasPerm = permissionsMap[source.id] ?? true;
            const cfUnlocked = sessionNonce >= 0 && isSiteTabProxied(source.baseUrl);

            return (
              <div
                key={source.id}
                className="rounded-2xl border border-zinc-800/80 bg-[#12121a] p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-white">{source.name}</h3>
                      <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-[11px] font-semibold uppercase text-zinc-300">
                        {source.lang}
                      </span>
                      {source.extendsId && (
                        <span className="rounded-md bg-indigo-500/15 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
                          {t('sources.templateBadge', { id: source.extendsId })}
                        </span>
                      )}
                      {cfUnlocked && (
                        <button
                          type="button"
                          title={t('sources.cfSessionTitle')}
                          onClick={() => {
                            clearSiteTabProxied(source.baseUrl);
                            setSessionNonce((n) => n + 1);
                          }}
                          className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/25"
                        >
                          {t('sources.cfSessionActive')}
                        </button>
                      )}
                      {!hasPerm && (
                        <button
                          type="button"
                          onClick={() => void handleGrantPermission(source)}
                          className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300 hover:bg-amber-500/25"
                        >
                          <ShieldCheck className="h-3 w-3" />
                          {t('sources.allowAccess')}
                        </button>
                      )}
                    </div>
                    <p className="font-mono text-xs text-zinc-500">{source.baseUrl}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleTestSource(source)}
                      disabled={test?.status === 'loading'}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
                    >
                      {test?.status === 'loading' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      {t('sources.testBtn')}
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate({ name: 'explore', sourceId: source.id })}
                      disabled={!source.enabled}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-40"
                    >
                      <Compass className="h-3.5 w-3.5 text-rose-400" />
                      {t('sources.exploreBtn')}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setInspectingSourceId((prev) => (prev === source.id ? null : source.id))
                      }
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                        inspectingSourceId === source.id
                          ? 'border-rose-500/50 bg-rose-500/15 text-rose-200'
                          : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'
                      }`}
                    >
                      <Wrench className="h-3.5 w-3.5" />
                      {t('sources.inspectBtn')}
                    </button>

                    <button
                      type="button"
                      onClick={() => void setSourceEnabled(source.id, !source.enabled)}
                      className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                        source.enabled
                          ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                      }`}
                    >
                      {source.enabled ? t('sources.enabled') : t('sources.disabled')}
                    </button>

                    {source.repoId === 'local_manual' && (
                      <button
                        type="button"
                        title={t('sources.deleteSource')}
                        aria-label={t('sources.deleteSource')}
                        onClick={() => void removeSource(source.id)}
                        className="rounded-xl border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:border-rose-500/40 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {inspectingSourceId === source.id && (
                  <SourceInspectorPanel
                    source={source}
                    onClose={() => setInspectingSourceId(null)}
                  />
                )}

                {test?.status === 'ok' && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    <span>
                      {t('sources.testOk', { count: test.count })}
                      {test.sampleTitle ? t('sources.testSample', { title: test.sampleTitle }) : ''}.
                    </span>
                  </div>
                )}

                {test?.status === 'cloudflare' && (
                  <CloudflareBanner
                    sourceName={source.name}
                    url={test.url}
                    probeUrl={test.probeUrl}
                    compact
                    onRetry={() => void handleTestSource(source)}
                  />
                )}

                {test?.status === 'error' && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    {t('sources.testFail', { message: test.message })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
