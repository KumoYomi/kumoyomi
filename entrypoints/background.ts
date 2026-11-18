import { browser } from 'wxt/browser';
import { db, getOrCreateSettings } from '@/src/core/db/db';
import type { BackgroundMessage } from '@/src/core/extension/browserBridge';
import {
  ensureImageRefererDnrRule,
  syncSourceDnrRules,
} from '@/src/core/extension/dnrRules';
import { checkLibraryUpdates } from '@/src/core/updater/updateChecker';

const UPDATE_ALARM_NAME = 'kumoyomi-check-updates';

async function openOrFocusAppTab(): Promise<void> {
  const appUrl = browser.runtime.getURL('/app.html');
  try {
    const tabs = await browser.tabs.query({});
    const existing = tabs.find((t) => t.url?.startsWith(appUrl));
    if (existing?.id !== undefined) {
      await browser.tabs.update(existing.id, { active: true });
      if (existing.windowId !== undefined) {
        await browser.windows.update(existing.windowId, { focused: true });
      }
      return;
    }
  } catch {
    // Repli sur l'ouverture d'un nouvel onglet
  }
  await browser.tabs.create({ url: appUrl, active: true });
}

async function updateBadgeCount(count: number): Promise<void> {
  try {
    await browser.action.setBadgeBackgroundColor({ color: '#e11d48' });
    await browser.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  } catch {
    // Ignore si l'action n'est pas disponible
  }
}

async function configureUpdateAlarm(intervalMinutes?: number): Promise<void> {
  const settings = await getOrCreateSettings();
  const minutes = Math.max(15, intervalMinutes ?? settings.updateIntervalMinutes ?? 120);
  await browser.alarms.clear(UPDATE_ALARM_NAME);
  browser.alarms.create(UPDATE_ALARM_NAME, { periodInMinutes: minutes });
}

async function syncStoredSourcesDnr(): Promise<void> {
  try {
    const sources = await db.sources.toArray();
    await syncSourceDnrRules(sources.filter((s) => s.enabled).map((s) => ({ baseUrl: s.baseUrl })));
  } catch (err) {
    console.warn('[KumoYomi Background] Impossible de synchroniser les règles DNR:', err);
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener((details) => {
    void (async () => {
      await syncStoredSourcesDnr();
      await configureUpdateAlarm();
      if (details.reason === 'install') {
        await openOrFocusAppTab();
      }
    })();
  });

  browser.runtime.onStartup.addListener(() => {
    void (async () => {
      await syncStoredSourcesDnr();
      await configureUpdateAlarm();
    })();
  });

  browser.action.onClicked.addListener(() => {
    void openOrFocusAppTab();
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== UPDATE_ALARM_NAME) return;
    void (async () => {
      try {
        await checkLibraryUpdates();
        const totalNew = await db.chapters.filter((c) => c.isNew && !c.read).count();
        await updateBadgeCount(totalNew);
      } catch (err) {
        console.warn('[KumoYomi Background] Vérification des mises à jour échouée:', err);
      }
    })();
  });

  browser.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
    const message = rawMessage as BackgroundMessage | undefined;
    if (!message || typeof message !== 'object') return false;

    (async () => {
      switch (message.type) {
        case 'SYNC_SOURCE_RULES': {
          await syncSourceDnrRules(message.sources);
          sendResponse({ ok: true });
          break;
        }
        case 'ENSURE_IMAGE_REFERER': {
          await ensureImageRefererDnrRule(message.imageUrl, message.refererOrigin);
          sendResponse({ ok: true });
          break;
        }
        case 'CHECK_UPDATES_NOW': {
          const summary = await checkLibraryUpdates();
          const totalNew = await db.chapters.filter((c) => c.isNew && !c.read).count();
          await updateBadgeCount(totalNew);
          sendResponse(summary);
          break;
        }
        case 'SET_BADGE_COUNT': {
          await updateBadgeCount(message.count);
          sendResponse({ ok: true });
          break;
        }
        case 'SET_UPDATE_ALARM': {
          await configureUpdateAlarm(message.intervalMinutes);
          sendResponse({ ok: true });
          break;
        }
        default: {
          sendResponse({ ok: false });
        }
      }
    })().catch((err) => {
      console.error('[KumoYomi Background] Erreur handler message:', err);
      sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Erreur' });
    });

    return true;
  });
});
