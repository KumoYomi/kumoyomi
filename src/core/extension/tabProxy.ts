import { browser } from 'wxt/browser';
import type {
  TabProxyFetchRequest,
  TabProxyFetchResult,
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

function getSiteRoot(hostname: string): string {
  const parts = hostname.toLowerCase().split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname.toLowerCase();
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
    const isParentSubdomain =
      targetHost === tabHost ||
      targetHost.endsWith(`.${tabHost}`) ||
      (fallbackTabOrigin === parsed.origin && getSiteRoot(tabHost) === getSiteRoot(targetHost));

    if (isParentSubdomain) {
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
}

function getCandidateTabs(
  tabs: Array<{ id?: number; url?: string; title?: string; active?: boolean; discarded?: boolean }>,
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
      (looksLikeChallengeTitle(tab.title) ? 0 : 10) +
      (tab.discarded ? 0 : 4) +
      (tab.active ? 2 : 0);
    candidates.push({
      id: tab.id,
      tabOrigin: match.tabOrigin,
      exactOrigin: match.exactOrigin,
      score,
    });
  }

  return candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return b.id - a.id;
  });
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

  try {
    const response = await fetch(params.url, {
      method: params.method,
      headers: cleanHeaders,
      body: params.body,
      credentials: 'include',
      cache: params.isCrossOrigin ? 'no-store' : 'default',
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
 * Exécute une requête fetch dans un onglet déjà ouvert et débloqué du site (ou domaine parent)
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
      if (firstResult?.foundTab) {
        return firstResult;
      }
    } catch {
      // Onglet inaccessible ou fermé : essai sur le candidat suivant
    }
  }

  return { foundTab: false };
}
