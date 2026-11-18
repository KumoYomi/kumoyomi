import { browser } from 'wxt/browser';
import { db, getOrCreateSettings } from '@/src/core/db/db';
import {
  type BackgroundMessage,
  registerInProcessTabProxyHandler,
} from '@/src/core/extension/browserBridge';
import { closeManagedProxyTabs } from '@/src/core/extension/cfPopup';
import {
  ensureApiRefererOriginDnrRule,
  ensureImageRefererDnrRule,
  syncSourceDnrRules,
} from '@/src/core/extension/dnrRules';
import { proxyFetchInOpenTab } from '@/src/core/extension/tabProxy';
import { translate } from '@/src/core/i18n';
import { checkLibraryUpdates } from '@/src/core/updater/updateChecker';

const UPDATE_ALARM_NAME = 'kumoyomi-check-updates';
const NEW_CHAPTERS_NOTIF_ID = 'kumoyomi-new-chapters';

async function openOrFocusAppTab(hash = ''): Promise<void> {
  const appUrl = browser.runtime.getURL('/app.html');
  const targetUrl = hash ? `${appUrl}${hash}` : appUrl;
  try {
    const tabs = await browser.tabs.query({});
    const existing = tabs.find((t) => t.url?.startsWith(appUrl));
    if (existing?.id !== undefined) {
      await browser.tabs.update(existing.id, {
        active: true,
        ...(hash ? { url: targetUrl } : {}),
      });
      if (existing.windowId !== undefined) {
        await browser.windows.update(existing.windowId, { focused: true });
      }
      return;
    }
  } catch {
    // Fallback to creating a new tab
  }
  await browser.tabs.create({ url: targetUrl, active: true });
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
    console.warn('[KumoYomi Background] Unable to sync DNR rules:', err);
  }
}

export default defineBackground(() => {
  registerInProcessTabProxyHandler(proxyFetchInOpenTab);

  browser.notifications?.onClicked?.addListener((notificationId) => {
    if (notificationId === NEW_CHAPTERS_NOTIF_ID) {
      void openOrFocusAppTab('#/updates');
    }
  });

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
      await closeManagedProxyTabs();
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
        const summary = await checkLibraryUpdates();
        const totalNew = await db.chapters.filter((c) => c.isNew && !c.read).count();
        await updateBadgeCount(totalNew);

        if (summary.newChaptersCount > 0 && browser.notifications?.create) {
          const settings = await getOrCreateSettings();
          if (settings.desktopNotifications !== false) {
            const locale = settings.language ?? 'en';
            await browser.notifications
              .create(NEW_CHAPTERS_NOTIF_ID, {
                type: 'basic',
                iconUrl: browser.runtime.getURL('/icon/128.png'),
                title: translate(locale, 'notifications.newChaptersTitle'),
                message: translate(locale, 'notifications.newChaptersBody', {
                  count: summary.newChaptersCount,
                }),
              })
              .catch(() => {});
          }
        }
      } catch (err) {
        console.warn('[KumoYomi Background] Update check failed:', err);
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
        case 'ENSURE_API_REFERER_ORIGIN': {
          await ensureApiRefererOriginDnrRule(message.apiUrl, message.originUrl);
          sendResponse({ ok: true });
          break;
        }
        case 'PROXY_FETCH_IN_TAB': {
          const proxyResult = await proxyFetchInOpenTab(message.payload);
          sendResponse(proxyResult);
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
        case 'CLEAR_CF_PROXY_TABS': {
          await closeManagedProxyTabs();
          sendResponse({ ok: true });
          break;
        }
        case 'OPEN_EXTENSION_APP': {
          const safeHash =
            typeof message.hash === 'string' && message.hash.startsWith('#/') ? message.hash : '';
          await openOrFocusAppTab(safeHash);
          sendResponse({ ok: true });
          break;
        }
        default: {
          sendResponse({ ok: false });
        }
      }
    })().catch((err) => {
      console.error('[KumoYomi Background] Message handler error:', err);
      sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Error' });
    });

    return true;
  });
});
