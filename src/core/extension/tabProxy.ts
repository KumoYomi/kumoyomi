import { browser } from 'wxt/browser';
import type {
  TabProxyFetchRequest,
  TabProxyFetchResult,
} from '@/src/core/extension/browserBridge';

const CHALLENGE_TITLE_MARKERS = [
  'just a moment',
  'un instant',
  'attention required',
  'checking your browser',
  'ddos-guard',
];

function looksLikeChallengeTitle(title?: string): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  return CHALLENGE_TITLE_MARKERS.some((m) => lower.includes(m));
}

function getCandidateTabs(tabs: Array<{ id?: number; url?: string; title?: string; active?: boolean; discarded?: boolean }>, targetOrigin: string) {
  const matching = tabs.filter((tab) => {
    if (tab.id === undefined || !tab.url) return false;
    try {
      return new URL(tab.url).origin === targetOrigin;
    } catch {
      return false;
    }
  });

  // Priorité : onglet déjà débloqué (hors page de défi), actif/chargé, le plus récent
  return matching.sort((a, b) => {
    const scoreA =
      (looksLikeChallengeTitle(a.title) ? 0 : 10) +
      (a.discarded ? 0 : 4) +
      (a.active ? 2 : 0);
    const scoreB =
      (looksLikeChallengeTitle(b.title) ? 0 : 10) +
      (b.discarded ? 0 : 4) +
      (b.active ? 2 : 0);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return (b.id ?? 0) - (a.id ?? 0);
  });
}

async function inPageFetchExecutor(params: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  responseMode: 'text' | 'base64';
  timeoutMs: number;
}): Promise<TabProxyFetchResult> {
  const forbidden = new Set([
    'origin',
    'referer',
    'host',
    'cookie',
    'user-agent',
    'accept-encoding',
    'connection',
    'content-length',
  ]);
  const cleanHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.headers)) {
    const lower = k.toLowerCase();
    if (forbidden.has(lower) || lower.startsWith('sec-') || lower.startsWith('proxy-')) {
      continue;
    }
    cleanHeaders[k] = v;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const response = await fetch(params.url, {
      method: params.method,
      headers: cleanHeaders,
      body: params.body,
      credentials: 'include',
      signal: controller.signal,
    });

    const headersMap: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersMap[key.toLowerCase()] = value;
    });

    if (params.responseMode === 'base64' && response.ok) {
      const buf = await response.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      return {
        foundTab: true,
        ok: true,
        status: response.status,
        statusText: response.statusText,
        finalUrl: response.url || params.url,
        headers: headersMap,
        bodyBase64: btoa(binary),
      };
    }

    const bodyText = await response.text();
    return {
      foundTab: true,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url || params.url,
      headers: headersMap,
      bodyText,
    };
  } catch (err) {
    return {
      foundTab: true,
      ok: false,
      error: err instanceof Error ? err.message : 'Erreur réseau depuis onglet',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exécute une requête fetch same-origin dans un onglet déjà ouvert et débloqué du site cible
 * afin de bénéficier des cookies partitionnés/Cloudflare et des en-têtes navigateur natifs.
 */
export async function proxyFetchInOpenTab(
  request: TabProxyFetchRequest,
): Promise<TabProxyFetchResult> {
  if (!browser.tabs?.query || !browser.scripting?.executeScript) {
    return { foundTab: false };
  }

  let targetOrigin: string;
  try {
    targetOrigin = new URL(request.url).origin;
  } catch {
    return { foundTab: false };
  }

  let candidates: ReturnType<typeof getCandidateTabs> = [];
  try {
    const tabs = await browser.tabs.query({});
    candidates = getCandidateTabs(tabs, targetOrigin);
  } catch {
    return { foundTab: false };
  }
  if (candidates.length === 0) {
    return { foundTab: false };
  }

  const payload = {
    url: request.url,
    method: request.method ?? 'GET',
    headers: request.headers ?? {},
    body: request.body,
    responseMode: request.responseMode ?? 'text',
    timeoutMs: request.timeoutMs ?? 15_000,
  };

  for (const tab of candidates) {
    if (tab.id === undefined) continue;
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: inPageFetchExecutor,
        args: [payload],
      });
      const firstResult = results[0]?.result as TabProxyFetchResult | undefined;
      if (firstResult?.foundTab) {
        return firstResult;
      }
    } catch {
      // Onglet inaccessible ou fermé : essai sur le candidat suivant
    }
  }

  return { foundTab: false };
}
