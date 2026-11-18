import { browser } from 'wxt/browser';
import {
  type CloudflarePopupResult,
  getSiteRootDomain,
  markSiteTabProxied,
  notifyCloudflareDomainUnlocked,
  openExternalTab,
  requestTabProxyFetch,
} from '@/src/core/extension/browserBridge';
import { looksLikeChallengeTitle } from '@/src/core/extension/tabProxy';
import { isCloudflareResponse } from '@/src/core/parser/httpClient';

const COOLDOWN_MS = 60_000;
const POPUP_WIDTH = 520;
const POPUP_HEIGHT = 660;
const MANAGED_PROXY_TABS_KEY = 'kumoyomi_cf_proxy_tabs';

const inFlightPopups = new Map<string, Promise<CloudflarePopupResult>>();
const cancelledUntilByDomain = new Map<string, number>();

type TabsApiWithHide = typeof browser.tabs & {
  hide?: (tabIds: number | number[]) => Promise<number[]>;
};

async function loadManagedProxyTabs(): Promise<Record<string, number>> {
  try {
    const area = browser.storage?.session ?? browser.storage?.local;
    if (!area) return {};
    const res = await area.get(MANAGED_PROXY_TABS_KEY);
    const raw = res?.[MANAGED_PROXY_TABS_KEY];
    return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

async function saveManagedProxyTabs(map: Record<string, number>): Promise<void> {
  try {
    const area = browser.storage?.session ?? browser.storage?.local;
    if (!area) return;
    await area.set({ [MANAGED_PROXY_TABS_KEY]: map });
  } catch {
    // Ignore storage write errors
  }
}

async function registerManagedProxyTab(root: string, tabId: number): Promise<void> {
  const map = await loadManagedProxyTabs();
  const prevId = map[root];
  if (prevId !== undefined && prevId !== tabId) {
    await browser.tabs.remove(prevId).catch(() => {});
  }
  map[root] = tabId;
  await saveManagedProxyTabs(map);
}

export async function closeManagedProxyTabs(): Promise<void> {
  const map = await loadManagedProxyTabs();
  const ids = Object.values(map).filter((id) => typeof id === 'number');
  if (ids.length > 0) {
    await browser.tabs.remove(ids).catch(() => {});
  }
  await saveManagedProxyTabs({});
}

function rootDomainOf(rawUrl: string): string {
  try {
    return getSiteRootDomain(new URL(rawUrl).hostname);
  } catch {
    return rawUrl;
  }
}

export function isVerificationPopupInCooldown(rawUrl: string): boolean {
  const root = rootDomainOf(rawUrl);
  const until = cancelledUntilByDomain.get(root);
  if (!until) return false;
  if (Date.now() >= until) {
    cancelledUntilByDomain.delete(root);
    return false;
  }
  return true;
}

/**
 * Inspecte passivement la page dans l'onglet popup pour savoir si le visiteur
 * a terminé la vérification humaine (Cloudflare / captcha) sans jamais interagir avec le widget.
 */
async function passiveChallengeCheckInTab(probeUrl: string): Promise<{ unlocked: boolean }> {
  if (document.readyState !== 'complete') {
    return { unlocked: false };
  }

  const title = (document.title ?? '').toLowerCase();
  const titleBlocked =
    title.includes('just a moment') ||
    title.includes('un instant') ||
    title.includes('instant') ||
    title.includes('vérification') ||
    title.includes('patientez') ||
    title.includes('attention required') ||
    title.includes('checking your browser') ||
    title.includes('ddos-guard');
  if (titleBlocked) {
    return { unlocked: false };
  }

  const challengeSelector =
    '#challenge-running, #challenge-stage, #cf-challenge-running, form#challenge-form, .cf-browser-verification, iframe[src*="challenges.cloudflare.com"]';
  if (document.querySelector(challengeSelector)) {
    return { unlocked: false };
  }

  const turnstileInput = document.querySelector<HTMLInputElement>(
    'input[name="cf-turnstile-response"]',
  );
  if (turnstileInput && !turnstileInput.value) {
    return { unlocked: false };
  }

  const bodyLower = (document.body?.innerText ?? '').toLowerCase();
  if (
    bodyLower.includes('enable javascript and cookies to continue') ||
    bodyLower.includes('checking if the site connection is secure') ||
    bodyLower.includes('verify you are human') ||
    bodyLower.includes('vérifiez que vous êtes humain') ||
    bodyLower.includes('vérification de la sécurité de votre connexion') ||
    bodyLower.includes('activez javascript et les cookies')
  ) {
    return { unlocked: false };
  }

  const runProbe = async (target: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(target, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      });
      if (res.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') {
        return false;
      }
      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
      if (
        res.status === 403 ||
        res.status === 503 ||
        res.status === 429 ||
        contentType.includes('text/html')
      ) {
        const text = (await res.text()).toLowerCase();
        if (
          text.includes('<title>just a moment') ||
          text.includes('<title>un instant') ||
          text.includes('challenges.cloudflare.com') ||
          text.includes('/cdn-cgi/challenge-platform/') ||
          text.includes('_cf_chl_opt')
        ) {
          return false;
        }
      }
      return res.status < 500 && res.status !== 403 && res.status !== 429;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  let ok = await runProbe(probeUrl);
  if (!ok && location.href.startsWith('http') && location.href !== probeUrl) {
    try {
      if (new URL(probeUrl).origin !== location.origin) {
        ok = await runProbe(location.href);
      }
    } catch {
      ok = await runProbe(location.href);
    }
  }
  return { unlocked: ok };
}

async function canExtensionFetchDirectly(probeUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(probeUrl, {
      method: 'GET',
      credentials: 'include',
      signal: controller.signal,
    });
    const text = await res.text();
    if (isCloudflareResponse(res.status, res.headers, text)) {
      return false;
    }
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function focusCallerContext(callerWindowId?: number, callerTabId?: number): Promise<void> {
  try {
    if (callerTabId !== undefined) {
      await browser.tabs.update(callerTabId, { active: true });
    }
    if (callerWindowId !== undefined) {
      await browser.windows.update(callerWindowId, { focused: true });
    }
  } catch {
    // Ignore si l'onglet appelant n'est plus joignable
  }
}

async function checkAlreadyUnlockedBeforePopup(
  siteUrl: string,
  probeTarget: string,
  root: string,
): Promise<CloudflarePopupResult | null> {
  try {
    let fallbackOrigin: string | undefined;
    try {
      fallbackOrigin = new URL(siteUrl).origin;
    } catch {
      fallbackOrigin = undefined;
    }
    const tabCheck = await requestTabProxyFetch({
      url: probeTarget,
      method: 'GET',
      timeoutMs: 4500,
      fallbackTabOrigin: fallbackOrigin,
    }).catch(() => undefined);

    if (tabCheck?.foundTab && !tabCheck.error) {
      const status = tabCheck.status ?? 0;
      const headers = new Headers(tabCheck.headers ?? {});
      const bodyLower = (tabCheck.bodyText ?? '').toLowerCase();
      const isHtml = (headers.get('content-type') ?? '').toLowerCase().includes('text/html');
      const hasChallengeHtml = isHtml && bodyLower.includes('challenges.cloudflare.com');
      if (
        status > 0 &&
        status !== 403 &&
        status !== 503 &&
        status !== 429 &&
        !hasChallengeHtml &&
        !isCloudflareResponse(status, headers, tabCheck.bodyText ?? '')
      ) {
        markSiteTabProxied(probeTarget);
        markSiteTabProxied(siteUrl);
        cancelledUntilByDomain.delete(root);
        notifyCloudflareDomainUnlocked(siteUrl);
        return { unlocked: true, mode: 'pinned_tab' };
      }
    }

    const probeDirect = await canExtensionFetchDirectly(probeTarget);
    if (probeDirect) {
      const siteDirect =
        probeTarget === siteUrl ? true : await canExtensionFetchDirectly(siteUrl);
      if (siteDirect) {
        cancelledUntilByDomain.delete(root);
        notifyCloudflareDomainUnlocked(siteUrl);
        return { unlocked: true, mode: 'direct' };
      }
    }
  } catch {
    // Fall through to opening popup window
  }
  return null;
}

async function runPopupVerificationFlow(
  siteUrl: string,
  probeTarget: string,
  root: string,
): Promise<CloudflarePopupResult> {
  const preflight = await checkAlreadyUnlockedBeforePopup(siteUrl, probeTarget, root);
  if (preflight) {
    return preflight;
  }

  if (!browser.windows?.create || !browser.tabs?.query || !browser.scripting?.executeScript) {
    await openExternalTab(siteUrl);
    return { unlocked: false, mode: 'external_tab' };
  }

  const callerWin = await browser.windows.getCurrent().catch(() => null);
  const callerTabs = callerWin?.id
    ? await browser.tabs.query({ windowId: callerWin.id, active: true }).catch(() => [])
    : [];
  const callerWindowId = callerWin?.id;
  const callerTabId = callerTabs[0]?.id;

  const left =
    callerWin?.left !== undefined && callerWin?.width !== undefined
      ? Math.max(0, Math.round(callerWin.left + (callerWin.width - POPUP_WIDTH) / 2))
      : undefined;
  const top =
    callerWin?.top !== undefined && callerWin?.height !== undefined
      ? Math.max(0, Math.round(callerWin.top + (callerWin.height - POPUP_HEIGHT) / 2))
      : undefined;

  const popupWin = await browser.windows.create({
    url: siteUrl,
    type: 'popup',
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    ...(left !== undefined && top !== undefined ? { left, top } : {}),
    focused: true,
  });

  const popupWinId = popupWin?.id;
  if (popupWinId === undefined) {
    await openExternalTab(siteUrl);
    return { unlocked: false, mode: 'external_tab' };
  }

  let popupTabId = popupWin?.tabs?.[0]?.id;
  if (popupTabId === undefined) {
    const winTabs = await browser.tabs.query({ windowId: popupWinId }).catch(() => []);
    popupTabId = winTabs[0]?.id;
  }

  return new Promise<CloudflarePopupResult>((resolve) => {
    let settled = false;
    let checking = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const cleanup = () => {
      if (intervalId) clearInterval(intervalId);
      browser.windows.onRemoved.removeListener(onWindowRemoved);
      browser.tabs.onUpdated.removeListener(onTabUpdated);
    };

    const finish = (result: CloudflarePopupResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const evaluatePopup = async () => {
      if (settled || checking) return;
      checking = true;
      try {
        if (popupTabId === undefined) {
          const winTabs = await browser.tabs.query({ windowId: popupWinId }).catch(() => []);
          popupTabId = winTabs[0]?.id;
        }
        if (popupTabId === undefined) return;

        const tab = await browser.tabs.get(popupTabId).catch(() => null);
        if (!tab || tab.status !== 'complete' || !tab.url?.startsWith('http')) return;
        if (looksLikeChallengeTitle(tab.title)) return;

        const results = await browser.scripting
          .executeScript({
            target: { tabId: popupTabId },
            world: 'MAIN',
            func: passiveChallengeCheckInTab,
            args: [probeTarget],
          })
          .catch(() => []);
        const probe = results[0]?.result as { unlocked?: boolean } | undefined;
        if (!probe?.unlocked) return;

        // Allow brief settle time in case Cloudflare chains a post-verification redirect
        await new Promise((r) => setTimeout(r, 350));
        if (settled) return;

        markSiteTabProxied(probeTarget);
        markSiteTabProxied(siteUrl);
        cancelledUntilByDomain.delete(root);

        const targetDockWindowId =
          callerWindowId !== undefined &&
          callerWindowId !== popupWinId &&
          callerWin?.type === 'normal'
            ? callerWindowId
            : (await browser.windows.getAll({ windowTypes: ['normal'] }).catch(() => [])).find(
                (w) => w.id !== popupWinId,
              )?.id;

        const tabsWithHide = browser.tabs as TabsApiWithHide;
        if (targetDockWindowId !== undefined && typeof tabsWithHide.hide === 'function') {
          try {
            await browser.tabs.move(popupTabId, { windowId: targetDockWindowId, index: -1 });
            await browser.tabs.update(popupTabId, { pinned: false, active: false });
            if (callerTabId !== undefined) {
              await browser.tabs.update(callerTabId, { active: true }).catch(() => {});
            }
            const hiddenIds = await tabsWithHide.hide(popupTabId);
            if (Array.isArray(hiddenIds) && hiddenIds.includes(popupTabId)) {
              await registerManagedProxyTab(root, popupTabId);

              const remaining = await browser.tabs.query({ windowId: popupWinId }).catch(() => []);
              if (remaining.length === 0) {
                await browser.windows.remove(popupWinId).catch(() => {});
              }

              const settleDeadline = Date.now() + 300;
              while (Date.now() < settleDeadline) {
                const info = await browser.tabs.get(popupTabId).catch(() => null);
                if (!info || info.status === 'complete') break;
                await new Promise((r) => setTimeout(r, 75));
              }

              await focusCallerContext(callerWindowId ?? targetDockWindowId, callerTabId);
              notifyCloudflareDomainUnlocked(siteUrl);
              finish({ unlocked: true, mode: 'hidden_tab' });
              return;
            }
            // If Firefox refused to hide for any reason, move back or minimize instead of pinning
          } catch {
            // Fall through cleanly below
          }
        }

        // Browsers without tabs.hide (e.g. Chromium): close popup completely if direct fetch works,
        // otherwise minimize the popup window cleanly without creating an unwanted pinned tab.
        const probeDirect = await canExtensionFetchDirectly(probeTarget);
        if (probeDirect) {
          const siteDirect =
            probeTarget === siteUrl ? true : await canExtensionFetchDirectly(siteUrl);
          if (siteDirect) {
            await browser.windows.remove(popupWinId).catch(() => {});
            await focusCallerContext(callerWindowId, callerTabId);
            notifyCloudflareDomainUnlocked(siteUrl);
            finish({ unlocked: true, mode: 'direct' });
            return;
          }
        }

        await registerManagedProxyTab(root, popupTabId);
        await browser.windows.update(popupWinId, { state: 'minimized' }).catch(() => {});
        await focusCallerContext(callerWindowId, callerTabId);
        notifyCloudflareDomainUnlocked(siteUrl);
        finish({ unlocked: true, mode: 'minimized' });
      } finally {
        checking = false;
      }
    };

    const onWindowRemoved = (removedWindowId: number) => {
      if (removedWindowId === popupWinId && !settled) {
        cancelledUntilByDomain.set(root, Date.now() + COOLDOWN_MS);
        finish({ unlocked: false, cancelled: true });
      }
    };

    const onTabUpdated = (tabId: number, changeInfo: { status?: string; title?: string }) => {
      if (tabId === popupTabId && (changeInfo.status === 'complete' || changeInfo.title)) {
        void evaluatePopup();
      }
    };

    browser.windows.onRemoved.addListener(onWindowRemoved);
    browser.tabs.onUpdated.addListener(onTabUpdated);
    intervalId = setInterval(() => {
      void evaluatePopup();
    }, 900);
  });
}

/**
 * Ouvre une petite fenêtre navigateur dédiée pour permettre à l'utilisateur de valider
 * Cloudflare / captcha, puis la referme automatiquement dès que la session est débloquée.
 */
export async function openCloudflareVerificationPopup(
  siteUrl: string,
  options?: { probeUrl?: string; autoTriggered?: boolean },
): Promise<CloudflarePopupResult> {
  const root = rootDomainOf(siteUrl);
  const existing = inFlightPopups.get(root);
  if (existing) {
    return existing;
  }

  if (options?.autoTriggered && isVerificationPopupInCooldown(siteUrl)) {
    return { unlocked: false, cancelled: true };
  }

  if (!options?.autoTriggered) {
    cancelledUntilByDomain.delete(root);
  }

  const probeTarget = options?.probeUrl || siteUrl;
  const promise = runPopupVerificationFlow(siteUrl, probeTarget, root).finally(() => {
    inFlightPopups.delete(root);
  });
  inFlightPopups.set(root, promise);
  return promise;
}
