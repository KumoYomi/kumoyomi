import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Globe, HardDrive, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { type ChangeEvent, useEffect, useState } from 'react';
import {
  exportBackupPayload,
  importBackupJson,
  triggerJsonDownload,
} from '@/src/core/db/backup';
import { DEFAULT_APP_SETTINGS, db, getOrCreateSettings } from '@/src/core/db/db';
import { sendBackgroundMessage } from '@/src/core/extension/browserBridge';
import { LOCALE_OPTIONS, useTranslation } from '@/src/core/i18n';
import { clearCoverBlobCache } from '@/src/core/image-loader/blobImageLoader';
import { clearAllOfflineChapters, formatBytes } from '@/src/core/offline/offlineCache';
import { clearTabProxyCache } from '@/src/core/parser/httpClient';
import { syncAllSourceRulesToBackground } from '@/src/core/parser/repositoryService';
import type {
  AppLocale,
  AppSettings,
  PageFitMode,
  ReaderMode,
  ReadingDirection,
} from '@/src/core/types/manga';

export function SettingsPage() {
  const { locale, t, setLocale } = useTranslation();
  const settings = useLiveQuery(() => db.settings.get('default'), [], DEFAULT_APP_SETTINGS);
  const mangasCount = useLiveQuery(() => db.mangas.filter((m) => m.favorite).count(), [], 0) ?? 0;
  const sourcesCount = useLiveQuery(() => db.sources.count(), [], 0) ?? 0;
  const coverCacheCount = useLiveQuery(() => db.coverBlobs.count(), [], 0) ?? 0;
  const offlineChapters = useLiveQuery(() => db.offlineChapters.toArray(), [], []) ?? [];

  const offlineBytes = offlineChapters.reduce((sum, ch) => sum + ch.totalBytes, 0);
  const [storageEstimate, setStorageEstimate] = useState<{ usage: number; quota: number } | null>(
    null,
  );

  useEffect(() => {
    if (!navigator.storage?.estimate) return;
    void navigator.storage
      .estimate()
      .then((est) => {
        if (est.usage !== undefined && est.quota !== undefined) {
          setStorageEstimate({ usage: est.usage, quota: est.quota });
        }
      })
      .catch(() => {});
  }, [coverCacheCount, offlineChapters.length]);

  const [statusMessage, setStatusMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null,
  );

  async function updateSettings(patch: Partial<AppSettings>) {
    const current = await getOrCreateSettings();
    const next = { ...current, ...patch };
    await db.settings.put(next);
    if (patch.updateIntervalMinutes !== undefined) {
      await sendBackgroundMessage({
        type: 'SET_UPDATE_ALARM',
        intervalMinutes: patch.updateIntervalMinutes,
      });
    }
  }

  async function handleExportBackup() {
    const payload = await exportBackupPayload();
    const dateSlug = new Date().toISOString().slice(0, 10);
    triggerJsonDownload(`kumoyomi-backup-${dateSlug}.json`, payload);
    setStatusMessage({
      kind: 'ok',
      text: t('settings.backupExported', {
        mangas: payload.mangas.length,
        sources: payload.sources.length,
      }),
    });
  }

  async function handleImportBackup(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const summary = await importBackupJson(text);
      await syncAllSourceRulesToBackground();
      setStatusMessage({
        kind: 'ok',
        text: t('settings.backupRestored', {
          mangas: summary.mangasCount,
          sources: summary.sourcesCount,
          chapters: summary.chaptersCount,
        }),
      });
    } catch (err) {
      setStatusMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : t('settings.backupError'),
      });
    }
  }

  async function handleClearCoverCache() {
    await clearCoverBlobCache();
    setStatusMessage({
      kind: 'ok',
      text: t('settings.coversCleared'),
    });
  }

  async function handleClearOfflineCache() {
    await clearAllOfflineChapters();
    setStatusMessage({
      kind: 'ok',
      text: t('settings.offlineCleared'),
    });
  }

  function handleResetCloudflareCache() {
    clearTabProxyCache();
    setStatusMessage({
      kind: 'ok',
      text: t('settings.cfResetDone'),
    });
  }

  const currentSettings = settings ?? DEFAULT_APP_SETTINGS;

  return (
    <div className="max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t('settings.subtitle')}</p>
      </header>

      {statusMessage && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            statusMessage.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Langue de l'interface */}
      <section className="rounded-2xl border border-zinc-800/80 bg-[#12121a] p-5 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Globe className="h-4 w-4 text-rose-400" />
          {t('settings.languageSection')}
        </h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {LOCALE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => void setLocale(opt.value as AppLocale)}
              className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
                locale === opt.value
                  ? 'border-rose-500/50 bg-rose-500/15 text-rose-200'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* Lecteur par défaut */}
      <section className="rounded-2xl border border-zinc-800/80 bg-[#12121a] p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">{t('settings.readerSection')}</h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-1.5 text-xs text-zinc-400">
            <span>{t('settings.readerMode')}</span>
            <select
              value={currentSettings.readerMode}
              onChange={(e) => void updateSettings({ readerMode: e.target.value as ReaderMode })}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="webtoon">{t('settings.modeWebtoon')}</option>
              <option value="single">{t('settings.modeSingle')}</option>
              <option value="double">{t('settings.modeDouble')}</option>
            </select>
          </label>

          <label className="space-y-1.5 text-xs text-zinc-400">
            <span>{t('settings.readingDirection')}</span>
            <select
              value={currentSettings.readingDirection}
              onChange={(e) =>
                void updateSettings({ readingDirection: e.target.value as ReadingDirection })
              }
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="ltr">{t('settings.dirLtr')}</option>
              <option value="rtl">{t('settings.dirRtl')}</option>
            </select>
          </label>

          <label className="space-y-1.5 text-xs text-zinc-400">
            <span>{t('settings.fitMode')}</span>
            <select
              value={currentSettings.pageFitMode ?? 'contain'}
              onChange={(e) =>
                void updateSettings({ pageFitMode: e.target.value as PageFitMode })
              }
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="contain">{t('settings.fitContain')}</option>
              <option value="width">{t('settings.fitWidth')}</option>
              <option value="original">{t('settings.fitOriginal')}</option>
            </select>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5 text-xs text-zinc-400">
            <span>{t('settings.webtoonWidth', { px: currentSettings.webtoonWidth })}</span>
            <input
              type="range"
              min={560}
              max={1200}
              step={20}
              value={currentSettings.webtoonWidth}
              onChange={(e) =>
                void updateSettings({ webtoonWidth: Number.parseInt(e.target.value, 10) })
              }
              className="w-full accent-rose-500"
            />
          </label>

          <label className="block space-y-1.5 text-xs text-zinc-400">
            <span>{t('settings.webtoonGap', { px: currentSettings.webtoonGap ?? 0 })}</span>
            <input
              type="range"
              min={0}
              max={32}
              step={4}
              value={currentSettings.webtoonGap ?? 0}
              onChange={(e) =>
                void updateSettings({ webtoonGap: Number.parseInt(e.target.value, 10) })
              }
              className="w-full accent-rose-500"
            />
          </label>
        </div>

        <label className="block space-y-1.5 text-xs text-zinc-400">
          <span>
            {t('settings.preloadPages', { count: currentSettings.preloadPagesCount ?? 4 })}
          </span>
          <input
            type="range"
            min={0}
            max={15}
            step={1}
            value={currentSettings.preloadPagesCount ?? 4}
            onChange={(e) =>
              void updateSettings({ preloadPagesCount: Number.parseInt(e.target.value, 10) })
            }
            className="w-full accent-rose-500"
          />
        </label>
      </section>

      {/* Cloudflare & Anti-bot */}
      <section className="rounded-2xl border border-zinc-800/80 bg-[#12121a] p-5 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <ShieldCheck className="h-4 w-4 text-amber-400" />
          {t('settings.cfSection')}
        </h2>
        <label className="flex cursor-pointer items-start gap-3 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={currentSettings.autoOpenCloudflarePopup ?? true}
            onChange={(e) =>
              void updateSettings({ autoOpenCloudflarePopup: e.target.checked })
            }
            className="mt-0.5 accent-rose-500"
          />
          <span>{t('settings.cfAutoPopupDesc')}</span>
        </label>
        <div>
          <button
            type="button"
            onClick={handleResetCloudflareCache}
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            {t('settings.cfResetBtn')}
          </button>
        </div>
      </section>

      {/* Mises à jour automatiques */}
      <section className="rounded-2xl border border-zinc-800/80 bg-[#12121a] p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white">{t('settings.updatesSection')}</h2>
        <label className="block space-y-1.5 text-xs text-zinc-400">
          <span>{t('settings.updateFrequency')}</span>
          <select
            value={currentSettings.updateIntervalMinutes}
            onChange={(e) =>
              void updateSettings({
                updateIntervalMinutes: Number.parseInt(e.target.value, 10),
              })
            }
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value={30}>{t('settings.every30m')}</option>
            <option value={60}>{t('settings.every1h')}</option>
            <option value={120}>{t('settings.every2h')}</option>
            <option value={360}>{t('settings.every6h')}</option>
            <option value={1440}>{t('settings.every1d')}</option>
          </select>
        </label>
        <label className="flex cursor-pointer items-start gap-3 pt-1 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={currentSettings.desktopNotifications ?? true}
            onChange={(e) => void updateSettings({ desktopNotifications: e.target.checked })}
            className="mt-0.5 accent-rose-500"
          />
          <span>{t('settings.desktopNotificationsDesc')}</span>
        </label>
      </section>

      {/* Sauvegarde & Cache local */}
      <section className="rounded-2xl border border-zinc-800/80 bg-[#12121a] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <HardDrive className="h-4 w-4 text-rose-400" />
              {t('settings.storageSection')}
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              {t('settings.storageStats', {
                mangas: mangasCount,
                sources: sourcesCount,
                covers: coverCacheCount,
                offline: offlineChapters.length,
                size: formatBytes(offlineBytes),
              })}
              {storageEstimate
                ? ` · ${formatBytes(storageEstimate.usage)} / ${formatBytes(storageEstimate.quota)}`
                : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleExportBackup()}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-500"
          >
            <Download className="h-4 w-4" />
            {t('settings.exportBackup')}
          </button>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800">
            <Upload className="h-4 w-4" />
            {t('settings.importBackup')}
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => void handleImportBackup(e)}
            />
          </label>

          <button
            type="button"
            onClick={() => void handleClearCoverCache()}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            <Trash2 className="h-4 w-4" />
            {t('settings.clearCovers')}
          </button>

          {offlineChapters.length > 0 && (
            <button
              type="button"
              onClick={() => void handleClearOfflineCache()}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs font-medium text-rose-300 hover:bg-zinc-800"
            >
              <Trash2 className="h-4 w-4" />
              {t('settings.clearOffline')}
            </button>
          )}
        </div>

        <label className="flex cursor-pointer items-start gap-3 pt-1 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={currentSettings.autoDeleteOfflineOnRead ?? false}
            onChange={(e) => void updateSettings({ autoDeleteOfflineOnRead: e.target.checked })}
            className="mt-0.5 accent-rose-500"
          />
          <span>{t('settings.autoDeleteOfflineDesc')}</span>
        </label>
      </section>
    </div>
  );
}
