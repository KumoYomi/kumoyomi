import { useLiveQuery } from 'dexie-react-hooks';
import { Download, HardDrive, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { type ChangeEvent, useEffect, useState } from 'react';
import {
  exportBackupPayload,
  importBackupJson,
  triggerJsonDownload,
} from '@/src/core/db/backup';
import { DEFAULT_APP_SETTINGS, db, getOrCreateSettings } from '@/src/core/db/db';
import { sendBackgroundMessage } from '@/src/core/extension/browserBridge';
import { clearCoverBlobCache } from '@/src/core/image-loader/blobImageLoader';
import { clearAllOfflineChapters, formatBytes } from '@/src/core/offline/offlineCache';
import { clearTabProxyCache } from '@/src/core/parser/httpClient';
import { syncAllSourceRulesToBackground } from '@/src/core/parser/repositoryService';
import type { AppSettings, PageFitMode, ReaderMode, ReadingDirection } from '@/src/core/types/manga';

export function SettingsPage() {
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
    triggerJsonDownload(`kumoyomi-sauvegarde-${dateSlug}.json`, payload);
    setStatusMessage({
      kind: 'ok',
      text: `Sauvegarde exportée (${payload.mangas.length} manga(s), ${payload.sources.length} source(s)).`,
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
        text: `Sauvegarde restaurée : ${summary.mangasCount} manga(s), ${summary.sourcesCount} source(s), ${summary.chaptersCount} chapitre(s).`,
      });
    } catch (err) {
      setStatusMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Erreur lors de la restauration.',
      });
    }
  }

  async function handleClearCoverCache() {
    await clearCoverBlobCache();
    setStatusMessage({
      kind: 'ok',
      text: 'Cache local des couvertures vidé.',
    });
  }

  async function handleClearOfflineCache() {
    await clearAllOfflineChapters();
    setStatusMessage({
      kind: 'ok',
      text: 'Cache des chapitres hors-ligne vidé.',
    });
  }

  function handleResetCloudflareCache() {
    clearTabProxyCache();
    setStatusMessage({
      kind: 'ok',
      text: 'Sessions Cloudflare mémorisées réinitialisées.',
    });
  }

  const currentSettings = settings ?? DEFAULT_APP_SETTINGS;

  return (
    <div className="max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Paramètres</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Préférences du lecteur, vérification automatique et sauvegarde locale 100 % hors-ligne.
        </p>
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

      {/* Lecteur par défaut */}
      <section className="rounded-2xl border border-zinc-800/80 bg-[#12121a] p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">Lecteur par défaut</h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-1.5 text-xs text-zinc-400">
            <span>Mode de lecture</span>
            <select
              value={currentSettings.readerMode}
              onChange={(e) => void updateSettings({ readerMode: e.target.value as ReaderMode })}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="webtoon">Webtoon (Défilement vertical)</option>
              <option value="single">Page simple</option>
              <option value="double">Double-page (Tome ouvert)</option>
            </select>
          </label>

          <label className="space-y-1.5 text-xs text-zinc-400">
            <span>Sens de lecture</span>
            <select
              value={currentSettings.readingDirection}
              onChange={(e) =>
                void updateSettings({ readingDirection: e.target.value as ReadingDirection })
              }
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="ltr">Gauche → Droite</option>
              <option value="rtl">Droite → Gauche (Manga)</option>
            </select>
          </label>

          <label className="space-y-1.5 text-xs text-zinc-400">
            <span>Ajustement (Page / Double)</span>
            <select
              value={currentSettings.pageFitMode ?? 'contain'}
              onChange={(e) =>
                void updateSettings({ pageFitMode: e.target.value as PageFitMode })
              }
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="contain">Ajuster à l&apos;écran</option>
              <option value="width">Pleine largeur</option>
              <option value="original">Taille réelle (100%)</option>
            </select>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5 text-xs text-zinc-400">
            <span>Largeur Webtoon par défaut ({currentSettings.webtoonWidth} px)</span>
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
            <span>Espacement Webtoon ({currentSettings.webtoonGap ?? 0} px)</span>
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
            Pages à précharger à l’avance ({currentSettings.preloadPagesCount ?? 4} page(s))
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
          Vérification Cloudflare / Captcha
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
          <span>
            Ouvrir automatiquement une petite fenêtre dédiée lorsqu&apos;un site demande une
            vérification Cloudflare ou Captcha (refermée dès que la validation passe).
          </span>
        </label>
        <div>
          <button
            type="button"
            onClick={handleResetCloudflareCache}
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Réinitialiser les sessions Cloudflare mémorisées
          </button>
        </div>
      </section>

      {/* Mises à jour automatiques */}
      <section className="rounded-2xl border border-zinc-800/80 bg-[#12121a] p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white">Vérification automatique en arrière-plan</h2>
        <label className="block space-y-1.5 text-xs text-zinc-400">
          <span>Fréquence de recherche des nouveaux chapitres</span>
          <select
            value={currentSettings.updateIntervalMinutes}
            onChange={(e) =>
              void updateSettings({
                updateIntervalMinutes: Number.parseInt(e.target.value, 10),
              })
            }
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value={30}>Toutes les 30 minutes</option>
            <option value={60}>Toutes les heures</option>
            <option value={120}>Toutes les 2 heures</option>
            <option value={360}>Toutes les 6 heures</option>
            <option value={1440}>Une fois par jour</option>
          </select>
        </label>
      </section>

      {/* Sauvegarde & Cache local */}
      <section className="rounded-2xl border border-zinc-800/80 bg-[#12121a] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <HardDrive className="h-4 w-4 text-rose-400" />
              Sauvegarde locale & Stockage (IndexedDB)
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              {mangasCount} favori(s) · {sourcesCount} source(s) · {coverCacheCount} couverture(s) ·{' '}
              {offlineChapters.length} chapitre(s) hors-ligne ({formatBytes(offlineBytes)})
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
            Exporter ma sauvegarde (.json)
          </button>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800">
            <Upload className="h-4 w-4" />
            Importer une sauvegarde (.json)
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
            Vider le cache couvertures
          </button>

          {offlineChapters.length > 0 && (
            <button
              type="button"
              onClick={() => void handleClearOfflineCache()}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs font-medium text-rose-300 hover:bg-zinc-800"
            >
              <Trash2 className="h-4 w-4" />
              Vider les chapitres hors-ligne
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
