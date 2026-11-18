import { useLiveQuery } from 'dexie-react-hooks';
import { Download, HardDrive, Trash2, Upload } from 'lucide-react';
import { type ChangeEvent, useState } from 'react';
import {
  exportBackupPayload,
  importBackupJson,
  triggerJsonDownload,
} from '@/src/core/db/backup';
import { DEFAULT_APP_SETTINGS, db, getOrCreateSettings } from '@/src/core/db/db';
import { sendBackgroundMessage } from '@/src/core/extension/browserBridge';
import { clearCoverBlobCache } from '@/src/core/image-loader/blobImageLoader';
import { syncAllSourceRulesToBackground } from '@/src/core/parser/repositoryService';
import type { AppSettings, ReaderMode, ReadingDirection } from '@/src/core/types/manga';

export function SettingsPage() {
  const settings = useLiveQuery(() => db.settings.get('default'), [], DEFAULT_APP_SETTINGS);
  const mangasCount = useLiveQuery(() => db.mangas.filter((m) => m.favorite).count(), [], 0) ?? 0;
  const sourcesCount = useLiveQuery(() => db.sources.count(), [], 0) ?? 0;
  const coverCacheCount = useLiveQuery(() => db.coverBlobs.count(), [], 0) ?? 0;

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

        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>

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
              {mangasCount} favori(s) · {sourcesCount} source(s) · {coverCacheCount} couverture(s) en
              cache
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
            Vider le cache images
          </button>
        </div>
      </section>
    </div>
  );
}
