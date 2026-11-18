import { useLiveQuery } from 'dexie-react-hooks';
import {
  CheckCircle2,
  Compass,
  FileJson,
  FolderGit2,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react';
import { navigate } from '@/src/app/router';
import { CloudflareBanner } from '@/src/components/CloudflareBanner';
import { db } from '@/src/core/db/db';
import {
  checkOriginPermission,
  clearSiteTabProxied,
  isSiteTabProxied,
  requestOriginPermission,
} from '@/src/core/extension/browserBridge';
import { runWithAutoCloudflarePopup } from '@/src/core/extension/cfAutoVerify';
import { useTranslation } from '@/src/core/i18n';
import { parserEngine } from '@/src/core/parser/engine';
import { CloudflareChallengeError } from '@/src/core/parser/httpClient';
import {
  addOrRefreshRepositoryByUrl,
  importLocalJsonConfig,
  removeRepository,
  setSourceEnabled,
} from '@/src/core/parser/repositoryService';
import type { InstalledSourceRecord } from '@/src/core/types/manga';

type TestResult =
  | { status: 'loading' }
  | { status: 'ok'; count: number; sampleTitle?: string }
  | { status: 'cloudflare'; url: string; probeUrl?: string }
  | { status: 'error'; message: string };

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
    if (!repoUrlInput.trim()) return;
    setAddingRepo(true);
    setFeedback(null);
    try {
      const res = await addOrRefreshRepositoryByUrl(repoUrlInput.trim());
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
    setTestResults((prev) => ({ ...prev, [source.id]: { status: 'loading' } }));
    try {
      const hasPerm = await checkOriginPermission(source.baseUrl);
      if (!hasPerm) {
        const granted = await requestOriginPermission(source.baseUrl);
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

  async function handleGrantPermission(source: InstalledSourceRecord) {
    const granted = await requestOriginPermission(source.baseUrl);
    setPermissionsMap((prev) => ({ ...prev, [source.id]: granted }));
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
                      onClick={() => void setSourceEnabled(source.id, !source.enabled)}
                      className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                        source.enabled
                          ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                      }`}
                    >
                      {source.enabled ? t('sources.enabled') : t('sources.disabled')}
                    </button>
                  </div>
                </div>

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
