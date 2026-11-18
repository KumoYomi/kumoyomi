import { browser } from 'wxt/browser';
import {
  type CloudflarePopupResult,
  getSiteRootDomain,
  markSiteTabProxied,
  openExternalTab,
} from '@/src/core/extension/browserBridge';
import { looksLikeChallengeTitle } from '@/src/core/extension/tabProxy';
import { isCloudflareResponse } from '@/src/core/parser/httpClient';

const COOLDOWN_MS = 60_000;
const POPUP_WIDTH = 520;
const POPUP_HEIGHT = 660;

const inFlightPopups = new Map<string, Promise<CloudflarePopupResult>>();
const cancelledUntilByDomain = new Map<string, number>();

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
    title.includes('attention required') ||
    title.includes('checking your browser') ||
    title.includes('ddos-guard');
  if (titleBlocked) {
    return { unlocked: false };
  }

  const challengeSelector =
    '#challenge-running, #challenge-stage, #cf-challenge-running, form#challenge-form, .cf-browser-verification';
  if (document.querySelector(challengeSelector)) {
    return { unlocked: false };
  }

  const bodyLower = (document.body?.innerText ?? '').toLowerCase();
  if (
    bodyLower.includes('enable javascript and cookies to continue') ||
    bodyLower.includes('checking if the site connection is secure') ||
    bodyLower.includes('verify you are human')
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
      if (res.status === 403 || res.status === 503 || res.status === 429) {
        const text = (await res.text()).toLowerCase();
        if (
          text.includes('<title>just a moment...</title>') ||
          text.includes('<title>un instant...</title>') ||
          text.includes('challenges.cloudflare.com') ||
          text.includes('/cdn-cgi/challenge-platform/') ||
          text.includes('_cf_chl_opt')
        ) {
          return false;
        }
        return false;
      }
      return true;
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

async function runPopupVerificationFlow(
  siteUrl: string,
  probeTarget: string,
  root: string,
): Promise<CloudflarePopupResult> {
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

        // Laisse une courte marge au cas où Cloudflare enchaîne un redirect juste après validation
        await new Promise((r) => setTimeout(r, 350));
        if (settled) return;

        const directWorks = await canExtensionFetchDirectly(probeTarget);
        if (directWorks) {
          cancelledUntilByDomain.delete(root);
          await browser.windows.remove(popupWinId).catch(() => {});
          await focusCallerContext(callerWindowId, callerTabId);
          finish({ unlocked: true, mode: 'direct' });
          return;
        }

        // Cookies partitionnés / Sec-Fetch-Site : le proxy via onglet reste requis.
        // Déplacer l'onglet débloqué en onglet épinglé inactif ferme automatiquement la popup et garde KumoYomi au premier plan.
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

        if (targetDockWindowId !== undefined) {
          try {
            await browser.tabs.move(popupTabId, { windowId: targetDockWindowId, index: -1 });
            await browser.tabs.update(popupTabId, { pinned: true, active: false });
            await focusCallerContext(callerWindowId ?? targetDockWindowId, callerTabId);
            finish({ unlocked: true, mode: 'pinned_tab' });
            return;
          } catch {
            // Repli ci-dessous si le déplacement inter-fenêtres échoue
          }
        }

        await browser.windows.update(popupWinId, { state: 'minimized' }).catch(() => {});
        await focusCallerContext(callerWindowId, callerTabId);
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
