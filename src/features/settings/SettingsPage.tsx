import { useLiveQuery } from 'dexie-react-hooks';
import {
  Check,
  Download,
  Globe,
  HardDrive,
  Palette,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { type ChangeEvent, useEffect, useState } from 'react';
import { CustomSelect } from '@/src/components/CustomSelect';
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
import { ACCENT_PRESETS, THEME_MODES, applyThemeToDocument } from '@/src/core/theme/theme';
import type {
  AccentPreset,
  AppLocale,
  AppSettings,
  PageFitMode,
  ReaderMode,
  ReadingDirection,
  ThemeMode,
} from '@/src/core/types/manga';

export function SettingsPage() {
  const { locale, t, setLocale } = useTranslation();
  const settings = useLiveQuery(
    async () => {
      const row = await db.settings.get('default');
      return row ? { ...DEFAULT_APP_SETTINGS, ...row } : DEFAULT_APP_SETTINGS;
    },
    [],
    null,
  );
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
    if (patch.themeMode !== undefined || patch.accentColor !== undefined) {
      applyThemeToDocument(next.themeMode ?? 'midnight', next.accentColor ?? 'aurora');
    }
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
    void sendBackgroundMessage({ type: 'CLEAR_CF_PROXY_TABS' });
    setStatusMessage({
      kind: 'ok',
      text: t('settings.cfResetDone'),
    });
  }

  const currentSettings = settings ?? DEFAULT_APP_SETTINGS;
  const activeThemeMode: ThemeMode = currentSettings.themeMode ?? 'midnight';
  const activeAccent: AccentPreset = currentSettings.accentColor ?? 'aurora';

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="ky-heading text-2xl font-bold tracking-tight">{t('settings.title')}</h1>
        <p className="ky-muted mt-1 text-sm">{t('settings.subtitle')}</p>
      </header>

      {statusMessage && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            statusMessage.kind === 'ok'
              ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300'
              : 'border-rose-500/35 bg-rose-500/12 text-rose-300'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Langue de l'interface */}
      <section className="ky-surface space-y-3 rounded-2xl border p-5">
        <h2 className="ky-heading flex items-center gap-2 text-sm font-semibold">
          <Globe className="h-4 w-4 text-sky-400" />
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
                  ? 'ky-pill-active border-transparent'
                  : 'ky-btn-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* Apparence & Palettes de couleurs */}
      <section className="ky-surface space-y-4 rounded-2xl border p-5">
        <h2 className="ky-heading flex items-center gap-2 text-sm font-semibold">
          <Palette className="h-4 w-4 text-[var(--ky-accent-text)]" />
          {t('theme.sectionTitle')}
        </h2>

        <div className="space-y-2">
          <p className="ky-muted text-xs font-medium">{t('theme.surfaceLabel')}</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {THEME_MODES.map((mode) => {
              const selected = activeThemeMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => void updateSettings({ themeMode: mode.id })}
                  className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left text-xs font-semibold transition ${
                    selected ? 'ky-pill-active border-transparent' : 'ky-btn-secondary'
                  }`}
                >
                  <span
                    style={{ backgroundColor: mode.swatchBg }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/15 shadow-inner"
                  >
                    <span
                      style={{ backgroundColor: mode.swatchCard }}
                      className="h-3.5 w-3.5 rounded-sm border border-white/10"
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t(mode.labelKey)}</span>
                  {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p className="ky-muted text-xs font-medium">{t('theme.accentLabel')}</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
            {ACCENT_PRESETS.map((preset) => {
              const selected = activeAccent === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => void updateSettings({ accentColor: preset.id })}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    selected ? 'ky-pill-active border-transparent' : 'ky-btn-secondary'
                  }`}
                >
                  <span
                    style={{
                      backgroundImage: `linear-gradient(135deg, ${preset.primary}, ${preset.secondary})`,
                    }}
                    className="h-4 w-4 shrink-0 rounded-full ring-1 ring-white/25"
                  />
                  <span className="truncate">{t(preset.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Lecteur par défaut */}
      <section className="ky-surface space-y-4 rounded-2xl border p-5">
        <h2 className="ky-heading text-sm font-semibold">{t('settings.readerSection')}</h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 text-xs">
            <span className="ky-muted block">{t('settings.readerMode')}</span>
            <CustomSelect
              ariaLabel={t('settings.readerMode')}
              className="w-full"
              value={currentSettings.readerMode}
              options={[
                { value: 'webtoon', label: t('settings.modeWebtoon') },
                { value: 'single', label: t('settings.modeSingle') },
                { value: 'double', label: t('settings.modeDouble') },
              ]}
              onChange={(val) => void updateSettings({ readerMode: val as ReaderMode })}
            />
          </div>

          <div className="space-y-1.5 text-xs">
            <span className="ky-muted block">{t('settings.readingDirection')}</span>
            <CustomSelect
              ariaLabel={t('settings.readingDirection')}
              className="w-full"
              value={currentSettings.readingDirection}
              options={[
                { value: 'ltr', label: t('settings.dirLtr') },
                { value: 'rtl', label: t('settings.dirRtl') },
              ]}
              onChange={(val) =>
                void updateSettings({ readingDirection: val as ReadingDirection })
              }
            />
          </div>

          <div className="space-y-1.5 text-xs">
            <span className="ky-muted block">{t('settings.fitMode')}</span>
            <CustomSelect
              ariaLabel={t('settings.fitMode')}
              className="w-full"
              value={currentSettings.pageFitMode ?? 'contain'}
              options={[
                { value: 'contain', label: t('settings.fitContain') },
                { value: 'width', label: t('settings.fitWidth') },
                { value: 'original', label: t('settings.fitOriginal') },
              ]}
              onChange={(val) => void updateSettings({ pageFitMode: val as PageFitMode })}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="ky-muted block space-y-1.5 text-xs">
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
              className="w-full accent-[var(--ky-accent)]"
            />
          </label>

          <label className="ky-muted block space-y-1.5 text-xs">
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
              className="w-full accent-[var(--ky-accent)]"
            />
          </label>
        </div>

        <label className="ky-muted block space-y-1.5 text-xs">
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
            className="w-full accent-[var(--ky-accent)]"
          />
        </label>
      </section>

      {/* Cloudflare & Anti-bot */}
      <section className="ky-surface space-y-3 rounded-2xl border p-5">
        <h2 className="ky-heading flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-amber-400" />
          {t('settings.cfSection')}
        </h2>
        <label className="flex cursor-pointer items-start gap-3 text-xs text-[var(--ky-text-secondary)]">
          <input
            type="checkbox"
            checked={currentSettings.autoOpenCloudflarePopup ?? true}
            onChange={(e) =>
              void updateSettings({ autoOpenCloudflarePopup: e.target.checked })
            }
            className="mt-0.5 accent-[var(--ky-accent)]"
          />
          <span>{t('settings.cfAutoPopupDesc')}</span>
        </label>
        <div>
          <button
            type="button"
            onClick={handleResetCloudflareCache}
            className="ky-btn-secondary rounded-xl px-3.5 py-2 text-xs font-medium"
          >
            {t('settings.cfResetBtn')}
          </button>
        </div>
      </section>

      {/* Mises à jour automatiques */}
      <section className="ky-surface space-y-3 rounded-2xl border p-5">
        <h2 className="ky-heading text-sm font-semibold">{t('settings.updatesSection')}</h2>
        <div className="space-y-1.5 text-xs">
          <span className="ky-muted block">{t('settings.updateFrequency')}</span>
          <CustomSelect
            ariaLabel={t('settings.updateFrequency')}
            className="w-full sm:w-80"
            value={String(currentSettings.updateIntervalMinutes)}
            options={[
              { value: '30', label: t('settings.every30m') },
              { value: '60', label: t('settings.every1h') },
              { value: '120', label: t('settings.every2h') },
              { value: '360', label: t('settings.every6h') },
              { value: '1440', label: t('settings.every1d') },
            ]}
            onChange={(val) =>
              void updateSettings({
                updateIntervalMinutes: Number.parseInt(val, 10),
              })
            }
          />
        </div>
        <label className="flex cursor-pointer items-start gap-3 pt-1 text-xs text-[var(--ky-text-secondary)]">
          <input
            type="checkbox"
            checked={currentSettings.desktopNotifications ?? true}
            onChange={(e) => void updateSettings({ desktopNotifications: e.target.checked })}
            className="mt-0.5 accent-[var(--ky-accent)]"
          />
          <span>{t('settings.desktopNotificationsDesc')}</span>
        </label>
      </section>

      {/* Sauvegarde & Cache local */}
      <section className="ky-surface space-y-4 rounded-2xl border p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="ky-heading flex items-center gap-2 text-sm font-semibold">
              <HardDrive className="h-4 w-4 text-emerald-400" />
              {t('settings.storageSection')}
            </h2>
            <p className="ky-muted mt-1 text-xs">
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
            className="ky-btn-primary inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold"
          >
            <Download className="h-4 w-4" />
            {t('settings.exportBackup')}
          </button>

          <label className="ky-btn-secondary inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold">
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
            className="ky-btn-secondary inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium"
          >
            <Trash2 className="h-4 w-4" />
            {t('settings.clearCovers')}
          </button>

          {offlineChapters.length > 0 && (
            <button
              type="button"
              onClick={() => void handleClearOfflineCache()}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-500/35 bg-rose-500/12 px-4 py-2.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20"
            >
              <Trash2 className="h-4 w-4" />
              {t('settings.clearOffline')}
            </button>
          )}
        </div>

        <label className="flex cursor-pointer items-start gap-3 pt-1 text-xs text-[var(--ky-text-secondary)]">
          <input
            type="checkbox"
            checked={currentSettings.autoDeleteOfflineOnRead ?? false}
            onChange={(e) => void updateSettings({ autoDeleteOfflineOnRead: e.target.checked })}
            className="mt-0.5 accent-[var(--ky-accent)]"
          />
          <span>{t('settings.autoDeleteOfflineDesc')}</span>
        </label>
      </section>
    </div>
  );
}
