import { db } from '@/src/core/db/db';
import {
  clearAllSiteTabProxyHints,
  clearSiteTabProxied,
  isSiteTabProxied,
  markSiteTabProxied,
  requestTabProxyFetch,
  sendBackgroundMessage,
} from '@/src/core/extension/browserBridge';
import { isCloudflareResponse } from '@/src/core/parser/httpClient';

const scopeUrls = new Map<string, Map<string, string>>();
const inflightRequests = new Map<string, Promise<string>>();
const ensuredRefererPairs = new Set<string>();

const MAX_COVER_CACHE_ENTRIES = 160;
const MAX_CONCURRENT_IMAGE_FETCHES = 2;

export type ImageFetchPriority = 'high' | 'normal';

interface QueueWaiter {
  priority: ImageFetchPriority;
  run: () => void;
}

let activeImageFetches = 0;
const imageFetchWaiters: QueueWaiter[] = [];

async function withImageConcurrency<T>(
  priority: ImageFetchPriority,
  task: () => Promise<T>,
): Promise<T> {
  if (activeImageFetches >= MAX_CONCURRENT_IMAGE_FETCHES) {
    await new Promise<void>((resolve) => {
      const waiter: QueueWaiter = { priority, run: resolve };
      if (priority === 'high') {
        const firstNormalIdx = imageFetchWaiters.findIndex((w) => w.priority !== 'high');
        if (firstNormalIdx === -1) {
          imageFetchWaiters.push(waiter);
        } else {
          imageFetchWaiters.splice(firstNormalIdx, 0, waiter);
        }
      } else {
        imageFetchWaiters.push(waiter);
      }
    });
  }
  activeImageFetches += 1;
  try {
    return await task();
  } finally {
    activeImageFetches -= 1;
    const next = imageFetchWaiters.shift();
    if (next) next.run();
  }
}

export function clearImageProxyCache(): void {
  clearAllSiteTabProxyHints();
}

function safeOrigin(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function decodeBase64ToBlob(base64: string, contentType?: string): Promise<Blob> {
  const mime = contentType || 'image/jpeg';
  try {
    const res = await fetch(`data:${mime};base64,${base64}`);
    if (res.ok) {
      return await res.blob();
    }
  } catch {
    // Repli synchrone si les data-URLs ne sont pas supportées par fetch (ex: jsdom)
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

type TabImageResult =
  | { kind: 'blob'; blob: Blob }
  | { kind: 'cloudflare'; status: number }
  | { kind: 'retryable'; status: number }
  | { kind: 'error'; status: number }
  | { kind: 'no_tab' };

async function tryFetchImageViaTab(
  imageUrl: string,
  refererUrl?: string,
): Promise<TabImageResult> {
  const proxied = await requestTabProxyFetch({
    url: imageUrl,
    method: 'GET',
    responseMode: 'base64',
    fallbackTabOrigin: safeOrigin(refererUrl),
  });
  if (!proxied?.foundTab) {
    return { kind: 'no_tab' };
  }
  if (proxied.ok && proxied.bodyBase64) {
    const blob = await decodeBase64ToBlob(proxied.bodyBase64, proxied.headers?.['content-type']);
    return { kind: 'blob', blob };
  }
  const status = proxied.status ?? 0;
  const headers = new Headers(proxied.headers ?? {});
  if (isCloudflareResponse(status, headers, proxied.bodyText ?? '')) {
    return { kind: 'cloudflare', status };
  }
  if (status === 429 || status === 502 || status === 503 || status === 504 || proxied.error) {
    return { kind: 'retryable', status };
  }
  return { kind: 'error', status };
}

async function downloadImageBlobOnce(imageUrl: string, refererUrl?: string): Promise<Blob> {
  const useTabFirst =
    isSiteTabProxied(imageUrl) || (refererUrl ? isSiteTabProxied(refererUrl) : false);

  if (useTabFirst) {
    const tabRes = await tryFetchImageViaTab(imageUrl, refererUrl);
    if (tabRes.kind === 'blob') {
      markSiteTabProxied(imageUrl);
      return tabRes.blob;
    }
    if (tabRes.kind === 'cloudflare') {
      throw new Error(`Cloudflare HTTP ${tabRes.status} sur l'image`);
    }
    if (tabRes.kind === 'retryable') {
      throw Object.assign(new Error(`HTTP ${tabRes.status} temporaire sur l'image`), {
        retryable: true,
      });
    }
    if (tabRes.kind === 'error') {
      throw new Error(`HTTP ${tabRes.status} sur l'image`);
    }
    // Onglet fermé : on efface le hint et on retente en direct
    clearSiteTabProxied(imageUrl);
  }

  const response = await fetch(imageUrl, { credentials: 'include' });
  if (response.ok) {
    if (response.url.includes('/lelsec')) {
      throw new Error('Image refused by host');
    }
    return response.blob();
  }

  let cfDetected = response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge';
  if (
    !cfDetected &&
    (response.status === 403 || response.status === 503 || response.status === 429)
  ) {
    const errText = await response.text().catch(() => '');
    cfDetected = isCloudflareResponse(response.status, response.headers, errText);
  }

  if (cfDetected) {
    const tabRes = await tryFetchImageViaTab(imageUrl, refererUrl);
    if (tabRes.kind === 'blob') {
      markSiteTabProxied(imageUrl);
      return tabRes.blob;
    }
    if (tabRes.kind === 'cloudflare') {
      throw new Error(`Cloudflare HTTP ${tabRes.status} sur l'image`);
    }
    if (tabRes.kind === 'retryable') {
      throw Object.assign(new Error(`HTTP ${tabRes.status} temporaire sur l'image`), {
        retryable: true,
      });
    }
    throw new Error(`Cloudflare HTTP ${response.status} sur l'image`);
  }

  if (
    response.status === 429 ||
    response.status === 502 ||
    response.status === 503 ||
    response.status === 504
  ) {
    throw Object.assign(new Error(`Temporary HTTP ${response.status} on image`), {
      retryable: true,
    });
  }

  throw new Error(`HTTP ${response.status} on image`);
}

async function ensureReferer(imageUrl: string, refererUrl?: string): Promise<void> {
  if (!refererUrl) return;
  try {
    const imgHost = new URL(imageUrl).host;
    const parsedRef = new URL(refererUrl);
    const refererValue =
      parsedRef.pathname && parsedRef.pathname !== '/' ? parsedRef.toString() : parsedRef.origin;
    const key = `${imgHost}::${refererValue}`;
    if (ensuredRefererPairs.has(key)) return;
    ensuredRefererPairs.add(key);
    await sendBackgroundMessage({
      type: 'ENSURE_IMAGE_REFERER',
      imageUrl,
      refererOrigin: refererValue,
    });
  } catch {
    // Ignore invalid URLs
  }
}

function trackScopeUrl(scopeId: string, originalUrl: string, objectUrl: string): void {
  let map = scopeUrls.get(scopeId);
  if (!map) {
    map = new Map();
    scopeUrls.set(scopeId, map);
  }
  map.set(originalUrl, objectUrl);
}

async function trimCoverCacheIfNeeded(): Promise<void> {
  const count = await db.coverBlobs.count();
  if (count <= MAX_COVER_CACHE_ENTRIES) return;
  const excess = count - MAX_COVER_CACHE_ENTRIES;
  const oldest = await db.coverBlobs.orderBy('cachedAt').limit(excess).primaryKeys();
  if (oldest.length > 0) {
    await db.coverBlobs.bulkDelete(oldest);
  }
}

export async function fetchImageBlob(
  imageUrl: string,
  refererUrl?: string,
  priority: ImageFetchPriority = 'high',
): Promise<Blob> {
  const trimmed = imageUrl.trim();
  if (!trimmed) {
    throw new Error('Empty image URL.');
  }

  await ensureReferer(trimmed, refererUrl);

  const blob = await withImageConcurrency(priority, async () => {
    const backoffs = [0, 500, 1200];
    let lastErr: unknown;
    for (let attempt = 0; attempt < backoffs.length; attempt += 1) {
      const wait = backoffs[attempt] ?? 0;
      if (wait > 0) await delayMs(wait);
      try {
        return await downloadImageBlobOnce(trimmed, refererUrl);
      } catch (err) {
        lastErr = err;
        const retryable = Boolean(
          err && typeof err === 'object' && 'retryable' in err && (err as { retryable?: boolean }).retryable,
        );
        if (!retryable || attempt === backoffs.length - 1) {
          throw err;
        }
      }
    }
    throw lastErr;
  });

  if (!blob || blob.size === 0) {
    throw new Error('Empty image received');
  }
  return blob;
}

export async function fetchImageAsBlobUrl(
  imageUrl: string,
  refererUrl?: string,
  scopeId = 'covers',
  options?: {
    priority?: ImageFetchPriority;
    offlineChapterId?: string;
    pageIndex?: number;
  },
): Promise<string> {
  const trimmed = imageUrl.trim();
  if (!trimmed) {
    throw new Error('Empty image URL.');
  }
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  const existingInScope = scopeUrls.get(scopeId)?.get(trimmed);
  if (existingInScope) {
    return existingInScope;
  }

  const inflightKey = `${scopeId}::${trimmed}`;
  const existingInflight = inflightRequests.get(inflightKey);
  if (existingInflight) {
    return existingInflight;
  }

  const priority = options?.priority ?? 'high';
  const task = (async () => {
    try {
      if (options?.offlineChapterId && options.pageIndex !== undefined) {
        const offlinePage = await db.chapterPageBlobs.get(
          `${options.offlineChapterId}:${options.pageIndex}`,
        );
        if (offlinePage?.blob) {
          const objectUrl = URL.createObjectURL(offlinePage.blob);
          trackScopeUrl(scopeId, trimmed, objectUrl);
          return objectUrl;
        }
      }

      if (scopeId === 'covers') {
        const cached = await db.coverBlobs.get(trimmed);
        if (cached?.blob) {
          const objectUrl = URL.createObjectURL(cached.blob);
          trackScopeUrl(scopeId, trimmed, objectUrl);
          return objectUrl;
        }
      }

      const blob = await fetchImageBlob(trimmed, refererUrl, priority);

      if (scopeId === 'covers' && blob.size < 2_500_000) {
        try {
          await db.coverBlobs.put({
            url: trimmed,
            referer: refererUrl ?? '',
            mimeType: blob.type || 'image/jpeg',
            blob,
            cachedAt: Date.now(),
          });
          void trimCoverCacheIfNeeded();
        } catch {
          // Quota ou transaction ignorée pour le cache optionnel
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      trackScopeUrl(scopeId, trimmed, objectUrl);
      return objectUrl;
    } finally {
      inflightRequests.delete(inflightKey);
    }
  })();

  inflightRequests.set(inflightKey, task);
  return task;
}

export function revokeScopeBlobUrls(scopeId: string): void {
  const map = scopeUrls.get(scopeId);
  if (!map) return;
  for (const objectUrl of map.values()) {
    if (objectUrl.startsWith('blob:')) {
      URL.revokeObjectURL(objectUrl);
    }
  }
  scopeUrls.delete(scopeId);
}

export async function clearCoverBlobCache(): Promise<void> {
  revokeScopeBlobUrls('covers');
  await db.coverBlobs.clear();
}
