import { browser } from 'wxt/browser';
import {
  getSiteRootDomain,
  type TabProxyFetchRequest,
  type TabProxyFetchResult,
} from '@/src/core/extension/browserBridge';
import { ensureCrossSubdomainCorsDnrRule } from '@/src/core/extension/dnrRules';

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

function matchTabToTarget(
  tabUrl: string,
  targetOrigin: string,
  targetHost: string,
  fallbackTabOrigin?: string,
): { exactOrigin: boolean; tabOrigin: string } | null {
  try {
    const parsed = new URL(tabUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.origin === targetOrigin) {
      return { exactOrigin: true, tabOrigin: parsed.origin };
    }

    const tabHost = parsed.hostname.toLowerCase();
    const targetRoot = getSiteRootDomain(targetHost);
    const tabRoot = getSiteRootDomain(tabHost);
    if (
      tabRoot === targetRoot &&
      (!fallbackTabOrigin ||
        getSiteRootDomain(new URL(fallbackTabOrigin).hostname) === targetRoot)
    ) {
      return { exactOrigin: false, tabOrigin: parsed.origin };
    }
    return null;
  } catch {
    return null;
  }
}

interface CandidateTab {
  id: number;
  tabOrigin: string;
  exactOrigin: boolean;
  score: number;
  lastAccessed: number;
}

function getCandidateTabs(
  tabs: Array<{
    id?: number;
    url?: string;
    title?: string;
    active?: boolean;
    discarded?: boolean;
    lastAccessed?: number;
  }>,
  targetOrigin: string,
  targetHost: string,
  fallbackTabOrigin?: string,
): CandidateTab[] {
  const candidates: CandidateTab[] = [];
  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url) continue;
    const match = matchTabToTarget(tab.url, targetOrigin, targetHost, fallbackTabOrigin);
    if (!match) continue;
    const score =
      (match.exactOrigin ? 20 : 10) +
      (looksLikeChallengeTitle(tab.title) ? 0 : 15) +
      (tab.discarded ? 0 : 5) +
      (tab.active ? 2 : 0);
    candidates.push({
      id: tab.id,
      tabOrigin: match.tabOrigin,
      exactOrigin: match.exactOrigin,
      score,
      lastAccessed: tab.lastAccessed ?? 0,
    });
  }

  return candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.lastAccessed !== b.lastAccessed) return b.lastAccessed - a.lastAccessed;
    return b.id - a.id;
  });
}

function isTabResultCloudflare(result: TabProxyFetchResult): boolean {
  const status = result.status ?? 0;
  const headers = result.headers ?? {};
  if (headers['cf-mitigated']?.toLowerCase() === 'challenge') {
    return true;
  }
  if (status === 403 || status === 503 || status === 429) {
    const lower = (result.bodyText ?? '').toLowerCase();
    return (
      lower.includes('<title>just a moment...</title>') ||
      lower.includes('<title>un instant...</title>') ||
      lower.includes('challenges.cloudflare.com') ||
      lower.includes('/cdn-cgi/challenge-platform/') ||
      lower.includes('cf-browser-verification') ||
      lower.includes('enable javascript and cookies to continue') ||
      lower.includes('_cf_chl_opt')
    );
  }
  return false;
}

async function inPageFetchExecutor(params: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  responseMode: 'text' | 'base64';
  timeoutMs: number;
  isCrossOrigin: boolean;
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

  const runFetch = (cacheMode: RequestCache) =>
    fetch(params.url, {
      method: params.method,
      headers: cleanHeaders,
      body: params.body,
      credentials: 'include',
      cache: cacheMode,
      signal: controller.signal,
    });

  try {
    let response: Response;
    try {
      response = await runFetch('default');
    } catch (firstErr) {
      // Si Chrome avait mis en cache une réponse opaque sans CORS via <img>, retente avec reload
      if (params.isCrossOrigin && firstErr instanceof TypeError) {
        response = await runFetch('reload');
      } else {
        throw firstErr;
      }
    }

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
 * Exécute une requête fetch dans un onglet déjà ouvert et débloqué du site (ou domaine lié)
 * afin de bénéficier des cookies partitionnés/Cloudflare et des en-têtes navigateur natifs.
 */
export async function proxyFetchInOpenTab(
  request: TabProxyFetchRequest,
): Promise<TabProxyFetchResult> {
  if (!browser.tabs?.query || !browser.scripting?.executeScript) {
    return { foundTab: false };
  }

  let targetOrigin: string;
  let targetHost: string;
  try {
    const parsed = new URL(request.url);
    targetOrigin = parsed.origin;
    targetHost = parsed.hostname.toLowerCase();
  } catch {
    return { foundTab: false };
  }

  let candidates: CandidateTab[] = [];
  try {
    const tabs = await browser.tabs.query({});
    candidates = getCandidateTabs(tabs, targetOrigin, targetHost, request.fallbackTabOrigin);
  } catch {
    return { foundTab: false };
  }
  if (candidates.length === 0) {
    return { foundTab: false };
  }

  let fallbackCloudflareResult: TabProxyFetchResult | null = null;

  for (const tab of candidates) {
    const isCrossOrigin = !tab.exactOrigin;
    if (isCrossOrigin) {
      await ensureCrossSubdomainCorsDnrRule(targetHost, tab.tabOrigin);
    }

    const payload = {
      url: request.url,
      method: request.method ?? 'GET',
      headers: request.headers ?? {},
      body: request.body,
      responseMode: request.responseMode ?? 'text',
      timeoutMs: request.timeoutMs ?? 15_000,
      isCrossOrigin,
    };

    try {
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: inPageFetchExecutor,
        args: [payload],
      });
      const firstResult = results[0]?.result as TabProxyFetchResult | undefined;
      if (!firstResult?.foundTab) continue;

      if (isTabResultCloudflare(firstResult)) {
        fallbackCloudflareResult = firstResult;
        continue;
      }

      return firstResult;
    } catch {
      // Onglet inaccessible ou fermé : essai sur le candidat suivant
    }
  }

  if (fallbackCloudflareResult) {
    return fallbackCloudflareResult;
  }

  return { foundTab: false };
}
