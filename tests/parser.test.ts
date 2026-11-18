import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db, DEFAULT_APP_SETTINGS, normalizeMangaKey } from '@/src/core/db/db';
import { addCustomCategory, setMangaCategories } from '@/src/core/db/mangaRepository';
import { LOCALE_OPTIONS, translate } from '@/src/core/i18n';
import { en } from '@/src/core/i18n/locales/en';
import { es } from '@/src/core/i18n/locales/es';
import { fr } from '@/src/core/i18n/locales/fr';
import { zh } from '@/src/core/i18n/locales/zh';
import type { TranslationKey } from '@/src/core/i18n/types';
import { formatBytes } from '@/src/core/offline/offlineCache';
import { extractChapterNumber } from '@/src/core/parser/chapterNumber';
import { parseFlexibleDate } from '@/src/core/parser/dateParser';
import { parserEngine, UniversalParserEngine } from '@/src/core/parser/engine';
import {
  parseKeiyoushiGradleBuild,
  parseKeiyoushiRepoUrl,
} from '@/src/core/parser/keiyoushiImporter';
import {
  BUILT_IN_KEIYOUSHI_TEMPLATES,
  buildThemeSourceConfig,
  compileFrenchKotlinSource,
  FRENCH_CUSTOM_RECIPES,
} from '@/src/core/parser/keiyoushiThemes';
import {
  getLastCloudflareUnlockTime,
  notifyCloudflareDomainUnlocked,
  onCloudflareDomainUnlocked,
  registerInProcessTabProxyHandler,
} from '@/src/core/extension/browserBridge';
import { runWithAutoCloudflarePopup } from '@/src/core/extension/cfAutoVerify';
import * as cfPopup from '@/src/core/extension/cfPopup';
import {
  clearImageProxyCache,
  fetchImageAsBlobUrl,
  revokeScopeBlobUrls,
} from '@/src/core/image-loader/blobImageLoader';
import {
  clearTabProxyCache,
  CloudflareChallengeError,
} from '@/src/core/parser/httpClient';
import { removeSource } from '@/src/core/parser/repositoryService';
import {
  resolveSourceWithTemplates,
  validateRawSourceConfig,
  validateTemplateConfig,
} from '@/src/core/parser/validator';
import type { SourceTemplateConfig } from '@/src/core/types/source';
import { checkLibraryUpdates } from '@/src/core/updater/updateChecker';
import { convertKeiyoushiDirectory } from '~/tools/mihon-converter/convert.mjs';

function loadFixtureJson<T>(relativePath: string): T {
  const full = resolve(__dirname, 'fixtures', relativePath);
  return JSON.parse(readFileSync(full, 'utf8')) as T;
}

describe('KumoYomi Universal Parser & Templates', () => {
  const originesTpl = validateTemplateConfig(loadFixtureJson('template-origines.json'));
  const madaraTpl = validateTemplateConfig(loadFixtureJson('template-madara.json'));
  const demoOriginesRaw = validateRawSourceConfig(
    loadFixtureJson('source-demo-origines.json'),
  );

  const templateMap = new Map<string, SourceTemplateConfig>([
    [originesTpl.id, originesTpl],
    [madaraTpl.id, madaraTpl],
  ]);

  afterEach(() => {
    vi.restoreAllMocks();
    registerInProcessTabProxyHandler(null);
    clearTabProxyCache();
    clearImageProxyCache();
    revokeScopeBlobUrls('reader-test');
  });

  it('résout correctement l’héritage extends="origines"', () => {
    const resolved = resolveSourceWithTemplates(demoOriginesRaw, templateMap);
    expect(resolved.id).toBe('demo-origines-fr');
    expect(resolved.baseUrl).toBe('https://demo-origines.example');
    expect(resolved.popular?.request.method).toBe('POST');
    expect(resolved.popular?.request.responseType).toBe('json-html');
    expect(resolved.chapters.request?.url).toBe('{{mangaUrlSlash}}ajax/chapters/');
    expect(resolved.pages.request.queryParams).toEqual({ style: 'list' });
  });

  it('parse le catalogue JSON-HTML, les détails <dt>/<dd>, les chapitres FR et les planches ?style=list (Origines)', async () => {
    const resolved = resolveSourceWithTemplates(demoOriginesRaw, templateMap);
    const engine = new UniversalParserEngine();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://demo-origines.example/wp-admin/admin-ajax.php') {
        expect(init?.method).toBe('POST');
        expect(String(init?.body)).toContain('action=madara_child_catalogue');
        expect(String(init?.body)).toContain('s=Kumo');
        return new Response(
          JSON.stringify({
            data: {
              more: true,
              html: `
                <a class="ori-card" href="/oeuvre/les-chroniques-de-kumo/">
                  <img data-src="/wp-content/uploads/kumo.jpg" />
                  <span class="ori-card-title">Les Chroniques de Kumo</span>
                </a>
              `,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url === 'https://demo-origines.example/oeuvre/les-chroniques-de-kumo/') {
        return new Response(
          `
          <html><body>
            <h1 class="ori-sr-title">Les Chroniques de Kumo</h1>
            <div class="ori-sr-cover"><img src="https://demo-origines.example/cover-kumo.webp" /></div>
            <div class="ori-sr-infos">
              <dl>
                <dt>Auteur</dt><dd>Kumo Studio</dd>
                <dt>Artiste</dt><dd>Yomi Art</dd>
                <dt>Statut</dt><dd>En cours</dd>
                <dt>Nom alternatif</dt><dd>Kumo Chronicles; Kumo no Kioku</dd>
              </dl>
            </div>
            <div class="ori-sr-syn-texte">
              <p>Paragraphe un du synopsis.</p>
              <p>Paragraphe deux du synopsis.</p>
            </div>
            <div class="ori-sr-genres">
              <a class="ori-sr-genre">Action</a>
              <a class="ori-sr-genre">Fantastique</a>
            </div>
          </body></html>
        `,
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        );
      }

      if (url === 'https://demo-origines.example/oeuvre/les-chroniques-de-kumo/ajax/chapters/') {
        expect(init?.method).toBe('POST');
        return new Response(
          `
          <div class="ori-chl-row">
            <a class="ori-chl-corps" href="/oeuvre/les-chroniques-de-kumo/chapitre-142-5/">
              <span class="ori-chl-nom">Chapitre 142.5 - Éveil</span>
              <span class="ori-chl-date" title="8 Août 2026">Il y a 2 jours</span>
            </a>
          </div>
          <div class="ori-chl-row">
            <a class="ori-chl-corps" href="/oeuvre/les-chroniques-de-kumo/chapitre-1/">
              <span class="ori-chl-nom">Chapitre 1</span>
              <span class="ori-chl-date" title="12 Févr 2025">12 Févr 2025</span>
            </a>
          </div>
        `,
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        );
      }

      if (url === 'https://demo-origines.example/oeuvre/les-chroniques-de-kumo/chapitre-142-5/?style=list') {
        return new Response(
          `
          <div class="reading-content">
            <img class="wp-manga-chapter-img" data-src="\n\t  https://cdn.demo-origines.example/pages/01.webp  \n" />
            <img class="wp-manga-chapter-img" src="/pages/02.webp" />
          </div>
        `,
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const searchRes = await engine.search(resolved, 'Kumo', 1);
    expect(searchRes.hasNextPage).toBe(true);
    expect(searchRes.items).toEqual([
      {
        sourceId: 'demo-origines-fr',
        title: 'Les Chroniques de Kumo',
        url: 'https://demo-origines.example/oeuvre/les-chroniques-de-kumo/',
        coverUrl: 'https://demo-origines.example/wp-content/uploads/kumo.jpg',
        latestChapter: undefined,
      },
    ]);

    const mangaUrl = searchRes.items[0]!.url;
    const details = await engine.getMangaDetails(resolved, mangaUrl);
    expect(details.title).toBe('Les Chroniques de Kumo');
    expect(details.author).toBe('Kumo Studio');
    expect(details.artist).toBe('Yomi Art');
    expect(details.status).toBe('ongoing');
    expect(details.genres).toEqual(['Action', 'Fantastique']);
    expect(details.altTitles).toEqual(['Kumo Chronicles', 'Kumo no Kioku']);
    expect(details.description).toBe('Paragraphe un du synopsis.\n\nParagraphe deux du synopsis.');

    const chapters = await engine.getChapters(resolved, mangaUrl, details.rawHtml);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toBe('Chapitre 142.5 - Éveil');
    expect(chapters[0]?.chapterNumber).toBe(142.5);
    expect(chapters[0]?.url).toBe('https://demo-origines.example/oeuvre/les-chroniques-de-kumo/chapitre-142-5/');
    expect(chapters[0]?.publishedAt).toBe(new Date(2026, 7, 8).getTime());

    const pages = await engine.getChapterPages(resolved, chapters[0]!.url);
    expect(pages).toEqual([
      { index: 0, imageUrl: 'https://cdn.demo-origines.example/pages/01.webp' },
      { index: 1, imageUrl: 'https://demo-origines.example/pages/02.webp' },
    ]);
  });

  it('parse correctement un site Madara et gère le fallbackInline des chapitres', async () => {
    const madaraSource = resolveSourceWithTemplates(
      {
        id: 'madara-demo',
        name: 'Madara Demo',
        lang: 'fr',
        extends: 'madara',
        baseUrl: 'https://madara.example.org',
      },
      templateMap,
    );
    const engine = new UniversalParserEngine();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/manga/hero-return/')) {
          return new Response(
            `
            <html><body>
              <div class="post-title"><h1><span class="manga-title-badges">HOT</span> Hero Return</h1></div>
              <div class="summary_image"><img data-lazy-src="/covers/hero.jpg" /></div>
              <div class="post-content_item">
                <div class="summary-heading"><h5>Statut</h5></div>
                <div class="summary-content">Terminé</div>
              </div>
              <div class="description-summary"><div class="summary__content"><p>Histoire complète.</p></div></div>
              <ul class="main version-chap">
                <li class="wp-manga-chapter">
                  <a href="/manga/hero-return/chapitre-10/">Chapitre 10</a>
                  <span class="chapter-release-date"><i>15/10/2026</i></span>
                </li>
              </ul>
            </body></html>
          `,
            { status: 200 },
          );
        }
        if (url.endsWith('/ajax/chapters/')) {
          return new Response('Not Found', { status: 404, statusText: 'Not Found' });
        }
        throw new Error(`Unexpected URL ${url}`);
      }),
    );

    const details = await engine.getMangaDetails(
      madaraSource,
      'https://madara.example.org/manga/hero-return/',
    );
    expect(details.title).toBe('Hero Return');
    expect(details.status).toBe('completed');
    expect(details.coverUrl).toBe('https://madara.example.org/covers/hero.jpg');

    const chapters = await engine.getChapters(
      madaraSource,
      'https://madara.example.org/manga/hero-return/',
      details.rawHtml,
    );
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe('Chapitre 10');
    expect(chapters[0]?.chapterNumber).toBe(10);
  });

  it('détecte proprement les challenges Cloudflare (HTTP 403 + cf-mitigated)', async () => {
    const resolved = resolveSourceWithTemplates(demoOriginesRaw, templateMap);
    const engine = new UniversalParserEngine();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf</body></html>',
          {
            status: 403,
            headers: { 'cf-mitigated': 'challenge' },
          },
        );
      }),
    );

    await expect(engine.getPopular(resolved, 1)).rejects.toBeInstanceOf(CloudflareChallengeError);
  });

  it('normalise les clés manga, numéros de chapitre et dates FR/EN + Unix epoch', () => {
    expect(normalizeMangaKey('Les Chroniques de Kumo !')).toBe(
      normalizeMangaKey('les-chroniques-de-kumo'),
    );
    expect(extractChapterNumber('Tome 2 - Chapitre 14.5 : Final')).toBe(14.5);
    expect(extractChapterNumber('Prologue')).toBeNull();
    expect(parseFlexibleDate('8 Août 2026')).toBe(new Date(2026, 7, 8).getTime());
    expect(parseFlexibleDate('il y a 2 heures', 1_700_000_000_000)).toBe(
      1_700_000_000_000 - 7_200_000,
    );
    expect(parseFlexibleDate('1700000000')).toBe(1_700_000_000_000);
    expect(parseFlexibleDate('1700000000000')).toBe(1_700_000_000_000);
  });

  it('supporte API JSON générique, warmupUrl non-Cloudflare et pages numérotées désobfusquées', async () => {
    const jsonApiSource = resolveSourceWithTemplates(
      validateRawSourceConfig({
        id: 'api-demo-fr',
        name: 'API Demo',
        lang: 'fr',
        baseUrl: 'https://api-demo.example',
        warmupUrl: '{{baseUrl}}',
        popular: {
          request: { method: 'GET', url: '{{baseUrl}}/api/v1/trend', responseType: 'json' },
          itemsPath: 'data',
          fields: {
            title: { jsonPath: 'title', decodeHtmlEntities: true },
            url: { jsonPath: ['mangaSlug', 'slug'], prefix: '{{baseUrl}}/manga/' },
            cover: { jsonPath: 'cover', absoluteUrl: true },
          },
        },
        latest: {
          request: {
            method: 'GET',
            url: '{{baseUrl}}/api/v1/latest',
            queryParams: { page: '{{page}}', limit: '20' },
            responseType: 'json',
          },
          itemsPath: 'data',
          fields: {
            title: { jsonPath: 'title', decodeHtmlEntities: true },
            url: { jsonPath: ['mangaSlug', 'slug'], prefix: '{{baseUrl}}/manga/' },
            latestChapter: { jsonPath: 'chapitre', prefix: 'Chapitre ' },
          },
          hasNextPageCalc: { totalPath: 'total', limitPath: 'limit', pagePath: 'page', pageSize: 20 },
          pageSize: 20,
        },
        mangaDetails: {
          request: {
            method: 'GET',
            url: '{{baseUrl}}/api/v1/manga',
            queryParams: { manga: '{{mangaSlug}}' },
            responseType: 'json',
          },
          fields: {
            title: { jsonPath: 'info.title', decodeHtmlEntities: true },
            cover: { jsonPath: 'info.cover', absoluteUrl: true },
            author: { jsonPath: 'info.author', decodeHtmlEntities: true },
            description: { jsonPath: 'info.description', decodeHtmlEntities: true },
            status: { jsonPath: 'info.status' },
          },
        },
        chapters: {
          request: {
            method: 'GET',
            url: '{{baseUrl}}/api/v1/manga',
            queryParams: { manga: '{{mangaSlug}}' },
            responseType: 'json',
          },
          itemsPath: 'chapters',
          fields: {
            title: {
              jsonTemplate: 'Chapitre {{num}} - {{title}}',
              decodeHtmlEntities: true,
              replace: [
                { pattern: '\\s*-\\s*$', replacement: '' },
                { pattern: '^(Chapitre\\s+\\S+)\\s*-\\s*\\1$', replacement: '$1', flags: 'i' },
              ],
            },
            url: {
              jsonPath: 'slug',
              replace: [{ pattern: '^/?\\??scan/', replacement: '' }],
              prefix: '{{baseUrl}}/scan/',
            },
            chapterNumber: { jsonPath: 'num' },
            date: { jsonPath: 'time' },
          },
        },
        pages: {
          request: {
            method: 'GET',
            url: '{{baseUrl}}/api/v1/scan',
            queryParams: { slug: '{{chapterSlug}}' },
            responseType: 'json',
          },
          numberedPages: {
            countJsonPath: 'pageNumbers',
            baseUrlJsonPath: 'pagesBaseUrl',
            padStart: 2,
            extension: 'webp',
            stripSuffixes: ['_b'],
            stripTokensFromScript: {
              url: '{{baseUrl}}/js/reader.js',
              regexes: ["salt\\s*=\\s*['\"]([^'\"]+)['\"]"],
              minLength: 3,
              fallbackTokens: ['Z9_x'],
            },
          },
        },
      }),
      new Map(),
    );

    let warmedUp = false;
    let scriptFetchCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api-demo.example/') {
        warmedUp = true;
        return new Response('<html>ok</html>', { status: 200 });
      }
      if (url.startsWith('https://api-demo.example/api/v1/trend')) {
        if (!warmedUp) {
          return new Response('Session cookie required', { status: 403 });
        }
        return new Response(
          JSON.stringify({
            data: [{ title: 'Blade &amp; Soul', slug: 'blade_soul', cover: '/covers/bs.png' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith('https://api-demo.example/api/v1/latest')) {
        return new Response(
          JSON.stringify({
            total: 25,
            page: 1,
            limit: 20,
            data: [{ title: 'Alpha', mangaSlug: 'alpha', chapitre: '42' }],
          }),
          { status: 200 },
        );
      }
      if (url === 'https://api-demo.example/api/v1/manga?manga=blade_soul') {
        return new Response(
          JSON.stringify({
            info: {
              title: 'Blade &amp; Soul',
              author: 'Kuro',
              status: 'En cours',
              cover: '/covers/bs.png',
              description: 'L&#039;histoire d&#039;un héros.',
            },
            chapters: [
              { slug: '/?scan/BS12', num: 12, title: 'Chapitre 12', time: 1_700_000_000 },
              { slug: 'BS11', num: 11, title: '', time: 1_699_900_000 },
              { slug: 'BS10', num: 10, title: 'Sp&eacute;cial', time: 1_699_800_000 },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === 'https://api-demo.example/api/v1/scan?slug=BS12') {
        return new Response(
          JSON.stringify({
            pageNumbers: 3,
            pagesBaseUrl: 'https://cdn.api-demo.example/scans/bs12_x7q_b/',
          }),
          { status: 200 },
        );
      }
      if (url === 'https://api-demo.example/js/reader.js') {
        scriptFetchCount += 1;
        return new Response(`const salt = "\\x5f\\x78\\x37\\x71";`, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const localEngine = new UniversalParserEngine();
    const pop = await localEngine.getPopular(jsonApiSource, 1);
    expect(warmedUp).toBe(true);
    expect(pop.hasNextPage).toBe(false);
    expect(pop.items[0]).toEqual({
      sourceId: 'api-demo-fr',
      title: 'Blade & Soul',
      url: 'https://api-demo.example/manga/blade_soul',
      coverUrl: 'https://api-demo.example/covers/bs.png',
      latestChapter: undefined,
    });

    const latest = await localEngine.getLatest(jsonApiSource, 1);
    expect(latest.hasNextPage).toBe(true);
    expect(latest.items[0]?.latestChapter).toBe('Chapitre 42');
    expect(latest.items[0]?.url).toBe('https://api-demo.example/manga/alpha');

    const details = await localEngine.getMangaDetails(
      jsonApiSource,
      'https://api-demo.example/manga/blade_soul',
    );
    expect(details.description).toBe("L'histoire d'un héros.");
    expect(details.status).toBe('ongoing');

    const chapters = await localEngine.getChapters(
      jsonApiSource,
      'https://api-demo.example/manga/blade_soul',
    );
    expect(chapters.map((c) => [c.title, c.url, c.publishedAt])).toEqual([
      ['Chapitre 12', 'https://api-demo.example/scan/BS12', 1_700_000_000_000],
      ['Chapitre 11', 'https://api-demo.example/scan/BS11', 1_699_900_000_000],
      ['Chapitre 10 - Spécial', 'https://api-demo.example/scan/BS10', 1_699_800_000_000],
    ]);

    const pages1 = await localEngine.getChapterPages(
      jsonApiSource,
      'https://api-demo.example/scan/BS12',
    );
    const pages2 = await localEngine.getChapterPages(
      jsonApiSource,
      'https://api-demo.example/scan/BS12',
    );
    expect(scriptFetchCount).toBe(1);
    expect(pages1).toEqual([
      { index: 0, imageUrl: 'https://cdn.api-demo.example/scans/bs12/01.webp' },
      { index: 1, imageUrl: 'https://cdn.api-demo.example/scans/bs12/02.webp' },
      { index: 2, imageUrl: 'https://cdn.api-demo.example/scans/bs12/03.webp' },
    ]);
    expect(pages2).toEqual(pages1);

    // Un 403 Cloudflare doit lever CloudflareChallengeError sans déclencher warmupUrl
    let cfWarmupCalled = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === 'https://api-demo.example/') {
          cfWarmupCalled = true;
          return new Response('ok', { status: 200 });
        }
        return new Response('<title>Just a moment...</title>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' },
        });
      }),
    );
    await expect(localEngine.getLatest(jsonApiSource, 1)).rejects.toBeInstanceOf(
      CloudflareChallengeError,
    );
    expect(cfWarmupCalled).toBe(false);
  });

  it('bascule sur un onglet ouvert débloqué si le fetch direct subit Cloudflare', async () => {
    const resolved = resolveSourceWithTemplates(demoOriginesRaw, templateMap);
    const engine = new UniversalParserEngine();

    const directFetch = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response('<title>Just a moment...</title>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' },
        }),
    );
    vi.stubGlobal('fetch', directFetch);

    const proxyHandler = vi.fn(async () => ({
      foundTab: true,
      ok: true,
      status: 200,
      statusText: 'OK',
      finalUrl: 'https://demo-origines.example/wp-admin/admin-ajax.php',
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({
        data: {
          html: `<a class="ori-card" href="/oeuvre/sky-blade/">
            <img data-src="https://demo-origines.example/uploads/sky.jpg" />
            <span class="ori-card-title">Sky Blade</span>
          </a>`,
          more: false,
        },
      }),
    }));
    registerInProcessTabProxyHandler(proxyHandler);

    const first = await engine.getPopular(resolved, 1);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.title).toBe('Sky Blade');
    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(proxyHandler).toHaveBeenCalledTimes(1);

    // L'appel suivant doit passer directement par l'onglet ouvert sans refaire un 403 direct inutile
    const second = await engine.getPopular(resolved, 1);
    expect(second.items[0]?.title).toBe('Sky Blade');
    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(proxyHandler).toHaveBeenCalledTimes(2);

    // Si l'onglet lui-même reçoit encore un challenge Cloudflare, l'erreur remonte avec reason='tab_blocked'
    registerInProcessTabProxyHandler(async () => ({
      foundTab: true,
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: { 'cf-mitigated': 'challenge' },
      bodyText: '<title>Just a moment...</title>',
    }));
    await expect(engine.getPopular(resolved, 1)).rejects.toMatchObject({
      name: 'CloudflareChallengeError',
      reason: 'tab_blocked',
    });

    // Sans aucun onglet ouvert, l'erreur remonte avec reason='no_tab'
    registerInProcessTabProxyHandler(async () => ({ foundTab: false }));
    await expect(engine.getPopular(resolved, 1)).rejects.toMatchObject({
      name: 'CloudflareChallengeError',
      reason: 'no_tab',
    });
  });

  it('récupère les images de sous-domaines CDN Cloudflare via l’onglet parent ouvert et retente sur HTTP 429', async () => {
    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:test-image-${Math.random()}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const directFetch = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response('<title>Just a moment...</title>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' },
        }),
    );
    vi.stubGlobal('fetch', directFetch);

    const sampleBase64 = Buffer.from('fake-webp-bytes').toString('base64');
    let attemptCount = 0;
    const proxyHandler = vi.fn(async (req) => {
      expect(req.fallbackTabOrigin).toBe('https://demo-origines.example');
      expect(req.responseMode).toBe('base64');
      attemptCount += 1;
      if (attemptCount === 2) {
        return {
          foundTab: true,
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: {} as Record<string, string>,
          bodyText: 'rate limit',
        };
      }
      return {
        foundTab: true,
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'image/webp' } as Record<string, string>,
        bodyBase64: sampleBase64,
      };
    });
    registerInProcessTabProxyHandler(proxyHandler);

    const blob1 = await fetchImageAsBlobUrl(
      'https://cdn.demo-origines.example/scans/01.webp',
      'https://demo-origines.example',
      'reader-test',
      { priority: 'high' },
    );
    const blob2 = await fetchImageAsBlobUrl(
      'https://cdn.demo-origines.example/scans/02.webp',
      'https://demo-origines.example',
      'reader-test',
      { priority: 'normal' },
    );

    const httpsCalls = directFetch.mock.calls.filter(([u]) => String(u).startsWith('https://'));
    expect(blob1.startsWith('blob:')).toBe(true);
    expect(blob2.startsWith('blob:')).toBe(true);
    expect(httpsCalls).toHaveLength(1);
    expect(proxyHandler).toHaveBeenCalledTimes(3);
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(2);
  });

  it('convertit une extension Keiyoushi Origines via convert.mjs', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kumoyomi-conv-'));
    try {
      const srcKtDir = join(tempDir, 'src', 'eu', 'kanade');
      mkdirSync(srcKtDir, { recursive: true });
      writeFileSync(
        join(tempDir, 'build.gradle.kts'),
        `keiyoushi {
          name = "Demo Origines"
          theme = "origines"
          source {
            lang = "fr"
            baseUrl = "https://demo-origines.example"
          }
        }`,
      );
      writeFileSync(
        join(srcKtDir, 'DemoOrigines.kt'),
        `class DemoOrigines : Origines() { override val mangaPath = "oeuvre" }`,
      );

      const res = convertKeiyoushiDirectory(tempDir);
      expect(res.ok).toBe(true);
      expect(res.config).toEqual({
        id: 'demo-origines-fr',
        name: 'Demo Origines',
        lang: 'fr',
        extends: 'origines',
        baseUrl: 'https://demo-origines.example',
        vars: { mangaPath: 'oeuvre' },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('réutilise rawJson entre getMangaDetails et getChapters, persiste tabProxy et absorbe un flicker Cloudflare', async () => {
    const jsonSource = validateRawSourceConfig({
      id: 'demo-json-api',
      name: 'Demo JSON',
      lang: 'fr',
      baseUrl: 'https://demo-json.example',
      mangaDetails: {
        request: {
          method: 'GET',
          url: '/api/v1/manga',
          queryParams: { manga: '{{mangaSlug}}' },
          responseType: 'json',
        },
        fields: {
          title: { jsonPath: 'info.title' },
          author: { jsonPath: 'info.author' },
        },
      },
      chapters: {
        request: {
          method: 'GET',
          url: '/api/v1/manga',
          queryParams: { manga: '{{mangaSlug}}' },
          responseType: 'json',
        },
        itemsPath: 'chapters',
        fields: {
          title: { jsonPath: 'title' },
          url: { jsonTemplate: '/scan/{{id}}', absoluteUrl: true },
          chapterNumber: { jsonPath: 'num' },
        },
      },
      pages: {
        request: {
          method: 'GET',
          url: '/api/v1/chapter',
          queryParams: { chapter: '{{chapterSlug}}' },
          responseType: 'json',
        },
        itemsPath: 'pages',
        imageUrl: { jsonPath: 'url' },
      },
    });
    const resolved = resolveSourceWithTemplates(jsonSource, templateMap);
    const engine = new UniversalParserEngine();

    const directFetch = vi.fn(
      async () =>
        new Response('<title>Just a moment...</title>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' },
        }),
    );
    vi.stubGlobal('fetch', directFetch);

    let proxyAttempts = 0;
    const proxyHandler = vi.fn(async () => {
      proxyAttempts += 1;
      if (proxyAttempts === 1) {
        return {
          foundTab: true,
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: { 'cf-mitigated': 'challenge' } as Record<string, string>,
          bodyText: '<title>Just a moment...</title>',
        };
      }
      return {
        foundTab: true,
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' } as Record<string, string>,
        bodyText: JSON.stringify({
          info: { title: 'Test JSON Manga', author: 'Auteur Test' },
          chapters: [{ id: 'ch-10', title: 'Chapitre 10', num: 10 }],
        }),
      };
    });
    registerInProcessTabProxyHandler(proxyHandler);

    const details = await engine.getMangaDetails(
      resolved,
      'https://demo-json.example/manga/test-slug',
    );
    expect(details.title).toBe('Test JSON Manga');
    expect(details.rawJson).toBeDefined();
    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(proxyHandler).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem('kumoyomi:tab_proxied_domains')).toContain('demo-json.example');

    const chapters = await engine.getChapters(
      resolved,
      details.url,
      details.rawHtml,
      details.rawJson,
    );
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.url).toBe('https://demo-json.example/scan/ch-10');
    // Aucune requête réseau supplémentaire pour les chapitres
    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(proxyHandler).toHaveBeenCalledTimes(2);

    clearTabProxyCache();
    expect(sessionStorage.getItem('kumoyomi:tab_proxied_domains')).toBeNull();
  });

  it('lit une planche hors-ligne depuis IndexedDB sans requête réseau et formate les tailles', async () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');

    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:offline-cached-page');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const blob = new Blob(['cached-bytes'], { type: 'image/webp' });
    const getSpy = vi.spyOn(db.chapterPageBlobs, 'get').mockResolvedValue({
      id: 'ch-offline:2',
      chapterId: 'ch-offline',
      pageIndex: 2,
      imageUrl: 'https://cdn.example.invalid/ch/03.webp',
      mimeType: 'image/webp',
      blob,
    });

    const url = await fetchImageAsBlobUrl(
      'https://cdn.example.invalid/ch/03.webp',
      'https://example.invalid',
      'reader-offline-test',
      { offlineChapterId: 'ch-offline', pageIndex: 2 },
    );

    expect(url).toBe('blob:offline-cached-page');
    expect(getSpy).toHaveBeenCalledWith('ch-offline:2');
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    revokeScopeBlobUrls('reader-offline-test');
  });

  it('couvre toutes les clés i18n dans les 4 langues (en, fr, es, zh) avec interpolation', () => {
    const keys = Object.keys(en) as TranslationKey[];
    expect(LOCALE_OPTIONS.map((o) => o.value)).toEqual(['en', 'fr', 'es', 'zh']);
    for (const dict of [en, fr, es, zh]) {
      for (const k of keys) {
        expect(typeof dict[k]).toBe('string');
        expect(dict[k].trim().length).toBeGreaterThan(0);
      }
    }
    expect(translate('en', 'library.subtitle', { count: 4 })).toContain('4');
    expect(translate('zh', 'library.subtitle', { count: 4 })).toContain('4');
    expect(translate('es', 'library.subtitle', { count: 4 })).toContain('4');
  });

  it('extrait le JSON embarqué dans <script> (__NEXT_DATA__ & ts_reader.run) avec réutilisation details/chapters', async () => {
    const scriptSourceRaw = validateRawSourceConfig({
      id: 'script-hydration-demo',
      name: 'Script Hydration Demo',
      lang: 'en',
      baseUrl: 'https://hydration-demo.example',
      popular: {
        request: {
          method: 'GET',
          url: '/catalogue?page={{page}}',
          responseType: 'json',
          scriptJson: { selector: 'script#__NEXT_DATA__' },
        },
        itemsPath: 'props.pageProps.items',
        fields: {
          title: { jsonPath: 'name' },
          url: { jsonPath: 'slug', prefix: '/series/', absoluteUrl: true },
          cover: { jsonPath: 'cover', absoluteUrl: true },
        },
      },
      mangaDetails: {
        request: {
          method: 'GET',
          url: '{{mangaUrl}}',
          responseType: 'json',
          scriptJson: { selector: 'script#__NEXT_DATA__' },
        },
        fields: {
          title: { jsonPath: 'props.pageProps.series.title' },
          author: { jsonPath: 'props.pageProps.series.author' },
          status: { jsonPath: 'props.pageProps.series.status' },
          genres: { jsonPath: 'props.pageProps.series.genres', joinAll: ', ' },
        },
      },
      chapters: {
        request: {
          method: 'GET',
          url: '{{mangaUrl}}',
          responseType: 'json',
          scriptJson: { selector: 'script#__NEXT_DATA__' },
        },
        itemsPath: 'props.pageProps.series.chapters',
        fields: {
          title: { jsonPath: 'title' },
          url: { jsonPath: 'path', absoluteUrl: true },
          chapterNumber: { jsonPath: 'number' },
        },
      },
      pages: {
        request: {
          method: 'GET',
          url: '{{chapterUrl}}',
          responseType: 'json',
          scriptJson: { regex: 'ts_reader\\.run\\((\\{[\\s\\S]*?\\})\\)\\s*;?' },
        },
        itemsPath: 'sources.0.images',
        imageUrl: { jsonPath: '' },
      },
    });
    const resolved = resolveSourceWithTemplates(scriptSourceRaw, templateMap);
    const engine = new UniversalParserEngine();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://hydration-demo.example/catalogue?page=1') {
        const nextPayload = {
          props: { pageProps: { items: [{ name: 'Cloud Reader', slug: 'cloud-reader', cover: '/c.jpg' }] } },
        };
        return new Response(
          `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextPayload)}</script></body></html>`,
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      if (url === 'https://hydration-demo.example/series/cloud-reader') {
        const detailPayload = {
          props: {
            pageProps: {
              series: {
                title: 'Cloud Reader',
                author: 'Sora K.',
                status: 'ongoing',
                genres: ['Action', 'Sci-Fi'],
                chapters: [{ title: 'Chapter 1', path: '/read/ch-1', number: 1 }],
              },
            },
          },
        };
        return new Response(
          `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(detailPayload)}</script></body></html>`,
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      if (url === 'https://hydration-demo.example/read/ch-1') {
        const tsReader = { sources: [{ source: 'CDN1', images: ['https://cdn.example/1.webp', 'https://cdn.example/2.webp'] }] };
        return new Response(
          `<html><body><script>var ignored = 1;</script><script>ts_reader.run(${JSON.stringify(tsReader)});</script></body></html>`,
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const cat = await engine.getPopular(resolved, 1);
    expect(cat.items).toHaveLength(1);
    expect(cat.items[0]?.url).toBe('https://hydration-demo.example/series/cloud-reader');

    const details = await engine.getMangaDetails(resolved, cat.items[0]!.url);
    expect(details.title).toBe('Cloud Reader');
    expect(details.genres).toEqual(['Action', 'Sci-Fi']);

    const chapters = await engine.getChapters(
      resolved,
      details.url,
      details.rawHtml,
      details.rawJson,
    );
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.chapterNumber).toBe(1);
    // Details and chapters share one HTTP fetch
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const pages = await engine.getChapterPages(resolved, chapters[0]!.url);
    expect(pages).toHaveLength(2);
    expect(pages[1]?.imageUrl).toBe('https://cdn.example/2.webp');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('notifie le déblocage Cloudflare aux bannières et stabilise les réessais post-popup', async () => {
    const unlockedSpy = vi.fn();
    const unsub = onCloudflareDomainUnlocked('https://cf-site.example', unlockedSpy);
    notifyCloudflareDomainUnlocked('https://cdn.cf-site.example/page1.jpg');
    expect(unlockedSpy).toHaveBeenCalledTimes(1);
    expect(getLastCloudflareUnlockTime('https://cf-site.example')).toBeGreaterThan(0);
    unsub();

    const g = globalThis as { browser?: unknown };
    const prevBrowser = g.browser;
    g.browser = { runtime: { id: 'kumoyomi-test' } };
    vi.spyOn(db.settings, 'get').mockResolvedValue(DEFAULT_APP_SETTINGS);
    const popupSpy = vi
      .spyOn(cfPopup, 'openCloudflareVerificationPopup')
      .mockResolvedValue({ unlocked: true, mode: 'pinned_tab' });

    let attempts = 0;
    try {
      const res = await runWithAutoCloudflarePopup(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new CloudflareChallengeError({
            sourceId: 'cf-src',
            sourceName: 'CF Site',
            url: 'https://cf-site.example',
            status: 403,
            reason: 'no_tab',
          });
        }
        if (attempts === 2) {
          throw new Error('Transient docked tab settle error');
        }
        return 'unlocked-ok';
      });
      expect(res).toBe('unlocked-ok');
      expect(attempts).toBe(3);
      expect(popupSpy).toHaveBeenCalledTimes(1);
    } finally {
      g.browser = prevBrowser;
    }
  });

  it('alterne les domaines lors de checkLibraryUpdates et court-circuite une source bloquée Cloudflare', async () => {
    const srcA = {
      id: 'src-a',
      repoId: 'r1',
      name: 'Source A',
      lang: 'en',
      baseUrl: 'https://a.example',
      enabled: true,
      rawConfig: demoOriginesRaw,
      resolvedConfig: resolveSourceWithTemplates(
        { ...demoOriginesRaw, id: 'src-a', baseUrl: 'https://a.example' },
        templateMap,
      ),
      updatedAt: 1,
    };
    const srcB = {
      ...srcA,
      id: 'src-b',
      name: 'Source B',
      baseUrl: 'https://b.example',
      resolvedConfig: resolveSourceWithTemplates(
        { ...demoOriginesRaw, id: 'src-b', baseUrl: 'https://b.example' },
        templateMap,
      ),
    };

    const favorites = [
      { id: 'm1', title: 'A1', favorite: true, preferredSourceId: 'src-a' },
      { id: 'm2', title: 'A2', favorite: true, preferredSourceId: 'src-a' },
      { id: 'm3', title: 'B1', favorite: true, preferredSourceId: 'src-b' },
    ];
    vi.spyOn(db.mangas, 'filter').mockReturnValue({
      toArray: async () => favorites,
    } as never);
    vi.spyOn(db.sources, 'toArray').mockResolvedValue([srcA, srcB] as never);
    vi.spyOn(db.mangaSources, 'where').mockImplementation(
      () =>
        ({
          equals: (mangaId: string) => ({
            toArray: async () => [
              {
                id: `ms-${mangaId}`,
                mangaId,
                sourceId: mangaId === 'm3' ? 'src-b' : 'src-a',
                sourceMangaUrl:
                  mangaId === 'm3'
                    ? 'https://b.example/m/b1'
                    : `https://a.example/m/${mangaId}`,
              },
            ],
          }),
        }) as never,
    );
    vi.spyOn(db.settings, 'get').mockResolvedValue(DEFAULT_APP_SETTINGS);
    vi.spyOn(db.settings, 'put').mockResolvedValue('default' as never);
    vi.spyOn(db.chapters, 'filter').mockReturnValue({ count: async () => 0 } as never);
    vi.spyOn(db, 'transaction').mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1] as () => Promise<unknown>;
      return cb();
    }) as never);
    vi.spyOn(db.mangas, 'get').mockResolvedValue(undefined);
    vi.spyOn(db.chapters, 'where').mockImplementation(
      () =>
        ({
          equals: () => ({ toArray: async () => [], delete: async () => 0 }),
        }) as never,
    );
    vi.spyOn(db.chapters, 'bulkPut').mockResolvedValue(undefined as never);

    const calledUrls: string[] = [];
    vi.spyOn(parserEngine, 'getChapters').mockImplementation(async (cfg, url) => {
      calledUrls.push(`${cfg.id}:${url}`);
      if (cfg.id === 'src-a') {
        throw new CloudflareChallengeError({
          sourceId: 'src-a',
          sourceName: 'Source A',
          url: 'https://a.example',
          requestUrl: url,
          status: 403,
        });
      }
      return [{ title: 'Chapter 1', url: `${url}/ch1`, chapterNumber: 1 }];
    });

    const summary = await checkLibraryUpdates(undefined, { minHostIntervalMs: 0 });
    expect(summary.checkedMangas).toBe(3);
    // Source A was queried ONCE and short-circuited on its second title; Source B still succeeded
    expect(calledUrls).toEqual(['src-a:https://a.example/m/m1', 'src-b:https://b.example/m/b1']);
    expect(summary.errors).toHaveLength(2);
    expect(summary.errors[0]?.isCloudflare).toBe(true);
    expect(summary.errors[1]?.isCloudflare).toBe(true);
  });

  it('supprime le cache hors-ligne via removeSource et gère les catégories personnalisées', async () => {
    vi.spyOn(db, 'transaction').mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1] as () => Promise<unknown>;
      return cb();
    }) as never);
    vi.spyOn(db.sources, 'get').mockResolvedValue({
      id: 'manual-1',
      repoId: 'local_manual',
      name: 'Manual',
      lang: 'en',
      baseUrl: 'https://manual.example',
      enabled: true,
      rawConfig: demoOriginesRaw,
      resolvedConfig: resolveSourceWithTemplates(demoOriginesRaw, templateMap),
      updatedAt: 1,
    });
    const sourceDeleteSpy = vi.spyOn(db.sources, 'delete').mockResolvedValue(undefined);
    const offlineDeleteSpy = vi.spyOn(db.offlineChapters, 'delete').mockResolvedValue(undefined);
    const blobDeleteSpy = vi.fn().mockResolvedValue(1);
    vi.spyOn(db.offlineChapters, 'where').mockImplementation(
      () =>
        ({
          equals: () => ({ primaryKeys: async () => ['ch-101'] }),
        }) as never,
    );
    vi.spyOn(db.chapterPageBlobs, 'where').mockImplementation(
      () =>
        ({
          equals: () => ({ delete: blobDeleteSpy }),
        }) as never,
    );
    vi.spyOn(db.sources, 'where').mockImplementation(
      () => ({ equals: () => ({ count: async () => 0 }) }) as never,
    );
    vi.spyOn(db.templates, 'where').mockImplementation(
      () => ({ equals: () => ({ count: async () => 0 }) }) as never,
    );
    const repoDeleteSpy = vi.spyOn(db.repositories, 'delete').mockResolvedValue(undefined);
    vi.spyOn(db.sources, 'toArray').mockResolvedValue([]);

    await removeSource('manual-1');
    expect(sourceDeleteSpy).toHaveBeenCalledWith('manual-1');
    expect(blobDeleteSpy).toHaveBeenCalledTimes(1);
    expect(offlineDeleteSpy).toHaveBeenCalledWith('ch-101');
    expect(repoDeleteSpy).toHaveBeenCalledWith('local_manual');

    vi.spyOn(db.settings, 'get').mockResolvedValue({ ...DEFAULT_APP_SETTINGS, customCategories: [] });
    const putSettingsSpy = vi.spyOn(db.settings, 'put').mockResolvedValue('default' as never);
    const mangaUpdateSpy = vi.spyOn(db.mangas, 'update').mockResolvedValue(1);

    const cats = await addCustomCategory('  Action  ');
    expect(cats).toEqual(['Action']);
    expect(putSettingsSpy).toHaveBeenCalled();

    await setMangaCategories('m1', ['Action', 'action', 'Favorites', '']);
    expect(mangaUpdateSpy).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ categories: ['Action', 'Favorites'] }),
    );
  });
});

describe('Keiyoushi / Mihon FR Importer & Compiler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recognizes Keiyoushi GitHub URLs while leaving standard KumoYomi JSON URLs untouched', () => {
    const repo = parseKeiyoushiRepoUrl('https://github.com/keiyoushi/extensions-source');
    expect(repo).not.toBeNull();
    expect(repo?.owner).toBe('keiyoushi');
    expect(repo?.repo).toBe('extensions-source');
    expect(repo?.langPath).toBe('src/fr');

    const branchRepo = parseKeiyoushiRepoUrl(
      'https://github.com/keiyoushi/extensions-source/tree/dev/src/fr',
    );
    expect(branchRepo?.branch).toBe('dev');
    expect(branchRepo?.langPath).toBe('src/fr');

    expect(parseKeiyoushiRepoUrl('https://github.com/user/my-kumoyomi-repo')).toBeNull();
    expect(
      parseKeiyoushiRepoUrl('https://github.com/keiyoushi/custom/blob/main/index.json'),
    ).toBeNull();
  });

  it('parses modern keiyoushi {} DSL and legacy build.gradle formats including NSFW and multi-source blocks', () => {
    const modernDsl = `
      plugins { alias(kei.plugins.extension) }
      keiyoushi {
        name = "Demo Manga"
        theme = "mangathemesia"
        contentWarning = ContentWarning.NSFW
        source {
          lang = "en"
          baseUrl = "https://en.demo-site.example"
        }
        source {
          lang = "fr"
          baseUrl = "https://fr.demo-site.example/"
        }
      }
    `;
    const metaModern = parseKeiyoushiGradleBuild(modernDsl, 'demomanga', 'fr');
    expect(metaModern).toEqual({
      slug: 'demomanga',
      id: 'demo-manga-fr',
      name: 'Demo Manga',
      lang: 'fr',
      baseUrl: 'https://fr.demo-site.example',
      nsfw: true,
      theme: 'mangathemesia',
    });

    const legacyGradle = `
      extName = 'Origines Demo'
      themePkg = 'origines'
      baseUrl = 'https://origines-demo.example'
      extLang = 'fr'
    `;
    const metaLegacy = parseKeiyoushiGradleBuild(legacyGradle, 'originesdemo', 'fr');
    expect(metaLegacy).toEqual({
      slug: 'originesdemo',
      id: 'origines-demo-fr',
      name: 'Origines Demo',
      lang: 'fr',
      baseUrl: 'https://origines-demo.example',
      theme: 'origines',
    });
  });

  it('validates all 7 built-in generic Keiyoushi multisrc templates and resolves theme overrides', () => {
    const tplMap = new Map<string, SourceTemplateConfig>();
    for (const [id, rawTpl] of Object.entries(BUILT_IN_KEIYOUSHI_TEMPLATES)) {
      const validated = validateTemplateConfig(rawTpl);
      tplMap.set(id, validated);
    }

    const madaraRaw = buildThemeSourceConfig(
      {
        slug: 'demo-madara',
        id: 'demo-madara-fr',
        name: 'Demo Madara',
        lang: 'fr',
        baseUrl: 'https://madara-demo.example',
        theme: 'madara',
      },
      'madara',
      `
        class DemoMadara : MadaraNoAjax() {
          override val mangaSubString = "webtoon"
          override fun archiveSelector() = ".mo2-archive-card"
        }
      `,
    );
    const madaraResolved = resolveSourceWithTemplates(madaraRaw, tplMap);
    expect(madaraResolved.vars?.mangaSubString).toBe('webtoon');
    expect(madaraResolved.popular?.itemSelector).toBe('.mo2-archive-card');
    expect(madaraResolved.chapters.request).toBeUndefined();
    expect(madaraResolved.chapters.fallbackInline).toBe(true);

    for (const themeId of [
      'origines',
      'mangathemesia',
      'pizzareader',
      'fuzzydoodle',
      'mmrcms',
      'scanreader',
    ]) {
      const raw = buildThemeSourceConfig(
        {
          slug: `demo-${themeId}`,
          id: `demo-${themeId}-fr`,
          name: `Demo ${themeId}`,
          lang: 'fr',
          baseUrl: `https://${themeId}-demo.example`,
          theme: themeId,
        },
        themeId,
        themeId === 'fuzzydoodle' ? 'override val latestFromHomePage = true' : '',
      );
      const resolved = resolveSourceWithTemplates(raw, tplMap);
      expect(resolved.extends).toBe(themeId);
      if (themeId === 'fuzzydoodle') {
        expect(resolved.latest?.request.url).toBe('{{baseUrl}}/?page={{page}}');
      }
    }
  });

  it('compiles French custom recipes cleanly and honestly flags Canvas/Turnstile/NextJS sources', () => {
    const tplMap = new Map<string, SourceTemplateConfig>();
    const punkRes = compileFrenchKotlinSource(
      {
        slug: 'punkrecords',
        id: 'punk-demo-fr',
        name: 'Punk Demo',
        lang: 'fr',
        baseUrl: 'https://punk-demo.example',
      },
      '',
    );
    expect(punkRes.compatible).toBe(true);
    expect(punkRes.reason).toBe('supported_recipe');
    const resolvedPunk = resolveSourceWithTemplates(punkRes.config!, tplMap);
    expect(resolvedPunk.pages.request.url).toContain('{{chapterParentSlug}}');

    for (const slug of Object.keys(FRENCH_CUSTOM_RECIPES)) {
      const customRes = compileFrenchKotlinSource(
        {
          slug,
          id: `${slug}-fr`,
          name: `Test ${slug}`,
          lang: 'fr',
          baseUrl: `https://${slug}.example`,
        },
        '',
      );
      expect(customRes.compatible).toBe(true);
      const resolved = resolveSourceWithTemplates(customRes.config!, tplMap);
      expect(resolved.id).toBe(`${slug}-fr`);
    }

    const canvasRes = compileFrenchKotlinSource(
      {
        slug: 'canvas-demo',
        id: 'canvas-demo-fr',
        name: 'Canvas Demo',
        lang: 'fr',
        baseUrl: 'https://canvas-demo.example',
      },
      'class Demo { fun descramble(bmp: Bitmap) { val c = Canvas(bmp) } }',
    );
    expect(canvasRes.compatible).toBe(false);
    expect(canvasRes.reason).toBe('incompatible_canvas');

    const turnstileRes = compileFrenchKotlinSource(
      {
        slug: 'cf-demo',
        id: 'cf-demo-fr',
        name: 'Turnstile Demo',
        lang: 'fr',
        baseUrl: 'https://cf-demo.example',
      },
      'if (doc.selectFirst(".cf-turnstile") != null) throw Exception("turnstile")',
    );
    expect(turnstileRes.compatible).toBe(false);
    expect(turnstileRes.reason).toBe('incompatible_turnstile');

    const nextRes = compileFrenchKotlinSource(
      {
        slug: 'next-demo',
        id: 'next-demo-fr',
        name: 'NextJS Demo',
        lang: 'fr',
        baseUrl: 'https://next-demo.example',
      },
      'client.get(url, Fetch.XHR).extractNextJs<ReaderDto>()',
    );
    expect(nextRes.compatible).toBe(false);
    expect(nextRes.reason).toBe('incompatible_nextjs_rsc');
  });

  it('executes ScanReader extractVarsFromDetails + base64Reverse and MangaThemesia ts_reader JSON parsing', async () => {
    const tplMap = new Map<string, SourceTemplateConfig>(
      Object.entries(BUILT_IN_KEIYOUSHI_TEMPLATES),
    );
    const scanReader = resolveSourceWithTemplates(
      {
        id: 'sr-demo-fr',
        name: 'ScanReader Demo',
        lang: 'fr',
        extends: 'scanreader',
        baseUrl: 'https://sr-demo.example',
      },
      tplMap,
    );

    const reversed1 = Buffer.from('https://sr-demo.example/p/1.webp'.split('').reverse().join('')).toString('base64');
    const reversed2 = Buffer.from('https://sr-demo.example/p/2.webp'.split('').reverse().join('')).toString('base64');

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://sr-demo.example/mangas/test-title/') {
        return new Response(
          `<html><body>
            <h1 class="manga-title">Test Title</h1>
            <div id="secure-chapters-container" data-manga-id="42" data-nonce="abc999"></div>
          </body></html>`,
          { status: 200 },
        );
      }
      if (url === 'https://sr-demo.example/wp-admin/admin-ajax.php' && init?.method === 'POST') {
        expect(String(init.body)).toContain('manga_id=42');
        expect(String(init.body)).toContain('nonce=abc999');
        return new Response(
          JSON.stringify({
            data: `<div><a href="https://sr-demo.example/chapitre/10">Chapitre 10</a></div>`,
          }),
          { status: 200 },
        );
      }
      if (url === 'https://sr-demo.example/chapitre/10') {
        return new Response(
          `<html><script>const imgs = ["${reversed1}", "${reversed2}"];</script></html>`,
          { status: 200 },
        );
      }
      if (url === 'https://mt-demo.example/ch-1') {
        return new Response(
          `<html><script>ts_reader.run({"sources":[{"images":["https://mt-demo.example/1.jpg","https://mt-demo.example/2.jpg"]}]});</script></html>`,
          { status: 200 },
        );
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const chapters = await parserEngine.getChapters(
      scanReader,
      'https://sr-demo.example/mangas/test-title/',
    );
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.url).toBe('https://sr-demo.example/chapitre/10');

    const pages = await parserEngine.getChapterPages(
      scanReader,
      'https://sr-demo.example/chapitre/10',
    );
    expect(pages.map((p) => p.imageUrl)).toEqual([
      'https://sr-demo.example/p/1.webp',
      'https://sr-demo.example/p/2.webp',
    ]);

    const mtSource = resolveSourceWithTemplates(
      {
        id: 'mt-demo-fr',
        name: 'MT Demo',
        lang: 'fr',
        extends: 'mangathemesia',
        baseUrl: 'https://mt-demo.example',
      },
      tplMap,
    );
    const mtPages = await parserEngine.getChapterPages(
      mtSource,
      'https://mt-demo.example/ch-1',
    );
    expect(mtPages.map((p) => p.imageUrl)).toEqual([
      'https://mt-demo.example/1.jpg',
      'https://mt-demo.example/2.jpg',
    ]);
  });

  it('converts modern keiyoushi {} extension directory via CLI converter', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'kei-conv-'));
    try {
      const extDir = join(tmpDir, 'demopizza');
      mkdirSync(join(extDir, 'src'), { recursive: true });
      writeFileSync(
        join(extDir, 'build.gradle.kts'),
        `
        keiyoushi {
          name = "Pizza Demo"
          theme = "pizzareader"
          source {
            lang = "fr"
            baseUrl = "https://pizza-demo.example"
          }
        }
        `,
        'utf8',
      );
      writeFileSync(
        join(extDir, 'src', 'PizzaDemo.kt'),
        `class PizzaDemo : PizzaReader() { override val apiPath = "/v2" }`,
        'utf8',
      );
      const res = convertKeiyoushiDirectory(extDir);
      expect(res.ok).toBe(true);
      expect(res.config?.extends).toBe('pizzareader');
      expect(res.config?.baseUrl).toBe('https://pizza-demo.example');
      expect(res.config?.vars?.apiPath).toBe('/v2');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('supports iken multisrc theme with apiUrl derivation and chapterQueryId pages', async () => {
    const rawCfg = buildThemeSourceConfig(
      {
        slug: 'vortexdemo',
        id: 'vortex-demo-en',
        name: 'Vortex Demo',
        lang: 'en',
        baseUrl: 'https://vortex-demo.example',
        theme: 'iken',
      },
      'iken',
      `class VortexDemo : Iken("Vortex Demo", "en", "https://vortex-demo.example", "https://api.vortex-demo.example")`,
    );
    const tplMap = new Map(Object.entries(BUILT_IN_KEIYOUSHI_TEMPLATES));
    const resolved = resolveSourceWithTemplates(rawCfg, tplMap);
    expect(resolved.vars?.apiUrl).toBe('https://api.vortex-demo.example');

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://api.vortex-demo.example/api/post?postSlug=solo-demo') {
        return new Response(
          JSON.stringify({
            post: {
              postTitle: 'Solo Demo',
              featuredImage: 'https://cdn.vortex-demo.example/cover.webp',
              chapters: [
                { id: 901, slug: 'chapter-1', number: '1', title: 'Awaken', createdAt: '2026-10-01' },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (url === 'https://api.vortex-demo.example/api/chapter?chapterId=901') {
        return new Response(
          JSON.stringify({
            chapter: {
              images: [
                { url: 'https://cdn.vortex-demo.example/p1.webp' },
                { url: 'https://cdn.vortex-demo.example/p2.webp' },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const chapters = await parserEngine.getChapters(
      resolved,
      'https://vortex-demo.example/series/solo-demo',
    );
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.url).toBe('https://vortex-demo.example/series/solo-demo/chapter-1?id=901');

    const pages = await parserEngine.getChapterPages(
      resolved,
      chapters[0]!.url,
    );
    expect(pages.map((p) => p.imageUrl)).toEqual([
      'https://cdn.vortex-demo.example/p1.webp',
      'https://cdn.vortex-demo.example/p2.webp',
    ]);
  });

  it('supports objectEntriesKeyField, findEntry+parseJsonArrayField, followPageLinks, and nextjs-flight recipes', async () => {
    const tplMap = new Map(Object.entries(BUILT_IN_KEIYOUSHI_TEMPLATES));

    const bigsolo = resolveSourceWithTemplates(
      FRENCH_CUSTOM_RECIPES.bigsolo!(
        { slug: 'bigsolo', id: 'bigsolo-fr', name: 'BigSolo', lang: 'fr', baseUrl: 'https://bs-demo.example' },
        '',
      ),
      tplMap,
    );
    const blossom = resolveSourceWithTemplates(
      FRENCH_CUSTOM_RECIPES.blossomscans!(
        { slug: 'blossomscans', id: 'blossomscans-fr', name: 'Blossom Scans', lang: 'fr', baseUrl: 'https://blossom-demo.example' },
        '',
      ),
      tplMap,
    );
    const lelscan = resolveSourceWithTemplates(
      FRENCH_CUSTOM_RECIPES.lelscan!(
        { slug: 'lelscan', id: 'lelscan-fr', name: 'Lelscan', lang: 'fr', baseUrl: 'https://lel-demo.example' },
        '',
      ),
      tplMap,
    );
    const rimu = resolveSourceWithTemplates(
      FRENCH_CUSTOM_RECIPES.rimuscans!(
        { slug: 'rimuscans', id: 'rimuscans-fr', name: 'Rimu Scans', lang: 'fr', baseUrl: 'https://rimu-demo.example' },
        '',
      ),
      tplMap,
    );
    const aniverse = resolveSourceWithTemplates(
      FRENCH_CUSTOM_RECIPES.aniverse!(
        { slug: 'aniverse', id: 'aniverse-fr', name: 'Aniverse', lang: 'fr', baseUrl: 'https://ani-demo.example' },
        '',
      ),
      tplMap,
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://bs-demo.example/data/series/one-demo') {
        return new Response(
          JSON.stringify({
            title: 'One Demo',
            chapters: {
              '10': { title: 'Dix', timestamp: 1700000000 },
              '11': { title: 'Onze', timestamp: 1700001000 },
            },
          }),
          { status: 200 },
        );
      }
      if (url === 'https://bs-demo.example/data/series/one-demo/11') {
        return new Response(
          JSON.stringify({ images: ['https://bs-demo.example/11/01.jpg'] }),
          { status: 200 },
        );
      }
      if (url === 'https://blossom-demo.example/api/series/flower-demo') {
        return new Response(
          JSON.stringify({
            title: 'Flower Demo',
            chapters: [
              {
                chapterId: 'ch-abc',
                number: '5',
                title: 'Bloom',
                pages: JSON.stringify([
                  'https://cdn.blossom-demo.example/5/1.webp',
                  'https://cdn.blossom-demo.example/5/2.webp',
                ]),
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === 'https://lel-demo.example/scan-demo/100/1') {
        return new Response(
          `<html>
            <div id="navigation">
              <select></select>
              <select></select>
              <select>
                <option value="/scan-demo/100/1">1</option>
                <option value="/scan-demo/100/2">2</option>
              </select>
            </div>
            <div id="image"><img src="/imgs/p1.png" /></div>
          </html>`,
          { status: 200 },
        );
      }
      if (url === 'https://lel-demo.example/scan-demo/100/2') {
        return new Response(
          `<html><div id="image"><img src="/imgs/p2.png" /></div></html>`,
          { status: 200 },
        );
      }
      if (url === 'https://rimu-demo.example/manga/slime-demo') {
        const flightPayload = JSON.stringify([
          '0',
          {
            initialChapters: [
              { number: 12, title: 'Tempest', type: 'chapter', images: [{ url: '/p/1.jpg' }], releaseDate: '2026-10-10' },
            ],
          },
        ]);
        return new Response(
          `<html><script>self.__next_f.push([1,${JSON.stringify(`5:${flightPayload}\n`)}])</script></html>`,
          { status: 200 },
        );
      }
      if (url === 'https://rimu-demo.example/read/slime-demo/12') {
        const flightPayload = JSON.stringify([
          '0',
          {
            chapters: [
              { number: '12', images: [{ url: '/rimu/12/1.webp' }, { url: '/rimu/12/2.webp' }] },
            ],
          },
        ]);
        return new Response(
          `<html><script>self.__next_f.push([1,${JSON.stringify(`6:${flightPayload}\n`)}])</script></html>`,
          { status: 200 },
        );
      }
      if (url === 'https://ani-demo.example/read/hero-demo/ch99') {
        const flightPayload = JSON.stringify([
          '0',
          {
            locked: false,
            pages: [{ src: 'https://cdn.ani-demo.example/ch99/1.webp' }],
          },
        ]);
        return new Response(
          `<html><script>self.__next_f.push([1,${JSON.stringify(`9:${flightPayload}\n`)}])</script></html>`,
          { status: 200 },
        );
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    // BigSolo keyed object chapters & images
    const bsChapters = await parserEngine.getChapters(bigsolo, 'https://bs-demo.example/manga/one-demo');
    expect(bsChapters.map((c) => c.title)).toEqual(['Ch. 11 – Onze', 'Ch. 10 – Dix']);
    const bsPages = await parserEngine.getChapterPages(bigsolo, bsChapters[0]!.url);
    expect(bsPages.map((p) => p.imageUrl)).toEqual(['https://bs-demo.example/11/01.jpg']);

    // BlossomScans findEntry + stringified JSON pages array
    const blPages = await parserEngine.getChapterPages(
      blossom,
      'https://blossom-demo.example/serie/flower-demo/chapitre/5?id=ch-abc',
    );
    expect(blPages.map((p) => p.imageUrl)).toEqual([
      'https://cdn.blossom-demo.example/5/1.webp',
      'https://cdn.blossom-demo.example/5/2.webp',
    ]);

    // Lelscan multi-page <option> crawling
    const lelPages = await parserEngine.getChapterPages(lelscan, 'https://lel-demo.example/scan-demo/100');
    expect(lelPages.map((p) => p.imageUrl)).toEqual([
      'https://lel-demo.example/imgs/p1.png',
      'https://lel-demo.example/imgs/p2.png',
    ]);

    // RimuScans nextjs-flight chapters & pages
    const rimuChs = await parserEngine.getChapters(rimu, 'https://rimu-demo.example/manga/slime-demo');
    expect(rimuChs).toHaveLength(1);
    expect(rimuChs[0]?.url).toBe('https://rimu-demo.example/read/slime-demo/12');
    const rimuPages = await parserEngine.getChapterPages(rimu, rimuChs[0]!.url);
    expect(rimuPages.map((p) => p.imageUrl)).toEqual([
      'https://rimu-demo.example/rimu/12/1.webp',
      'https://rimu-demo.example/rimu/12/2.webp',
    ]);

    // Aniverse nextjs-flight reader pages
    const aniPages = await parserEngine.getChapterPages(aniverse, 'https://ani-demo.example/read/hero-demo/ch99');
    expect(aniPages.map((p) => p.imageUrl)).toEqual(['https://cdn.ani-demo.example/ch99/1.webp']);

    // `:contains(...)` & `:has(...:containsOwn(...))` compat selectors in HTML catalogues/details
    const dassou = resolveSourceWithTemplates(
      FRENCH_CUSTOM_RECIPES.dassouscan!(
        { slug: 'dassouscan', id: 'dassouscan-fr', name: 'Dassou Scan', lang: 'fr', baseUrl: 'https://dassou-demo.example' },
        '',
      ),
      tplMap,
    );
    const mtDetailsSource = resolveSourceWithTemplates(
      { id: 'mt-contains-fr', name: 'MT Contains', lang: 'fr', extends: 'mangathemesia', baseUrl: 'https://mtc-demo.example' },
      tplMap,
    );
    const containsFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://dassou-demo.example/catalogue')) {
        return new Response(
          `<html>
            <article class="dsc-cat-card">
              <a class="dsc-cat-card__cover-link" href="/manga/demo-1"><img data-src="/c.jpg"/></a>
              <div class="dsc-cat-card__title"><a href="/manga/demo-1">Demo One</a></div>
            </article>
            <a class="dsc-cat__pager-btn" href="/catalogue?page=2">Suivant →</a>
          </html>`,
          { status: 200 },
        );
      }
      if (url === 'https://mtc-demo.example/manga/hero') {
        return new Response(
          `<html>
            <h1 class="entry-title">Hero Title</h1>
            <div class="fmed"><b>Author</b><span>Jane Author</span></div>
            <div class="imptdt">Status <i>Ongoing</i></div>
          </html>`,
          { status: 200 },
        );
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', containsFetch);
    const dassouPage = await parserEngine.getPopular(dassou, 1);
    expect(dassouPage.items).toHaveLength(1);
    expect(dassouPage.hasNextPage).toBe(true);
    const mtDetails = await parserEngine.getMangaDetails(mtDetailsSource, 'https://mtc-demo.example/manga/hero');
    expect(mtDetails.author).toBe('Jane Author');
    expect(mtDetails.status).toBe('ongoing');
  });

  it('supports langOverride and multi-source listOf gradle metadata in keiyoushiImporter', () => {
    const enTarget = parseKeiyoushiRepoUrl('https://github.com/keiyoushi/extensions-source', 'en');
    expect(enTarget?.langCode).toBe('en');
    expect(enTarget?.langPath).toBe('src/en');

    const explicitAll = parseKeiyoushiRepoUrl('https://github.com/keiyoushi/extensions-source/tree/main/src/all');
    expect(explicitAll?.langCode).toBe('all');

    const meta = parseKeiyoushiGradleBuild(
      `
      ext {
        extName = 'Multi Demo'
        extClass = '.MultiDemo'
        extVersionCode = 1
        isNsfw = true
      }
      baseUrl = "https://multi-demo.example"
      lang = listOf("fr", "en")
      `,
      'multidemo',
      'all',
    );
    expect(meta).not.toBeNull();
    expect(meta?.lang).toBe('fr');
    expect(meta?.nsfw).toBe(true);
    expect(meta?.baseUrl).toBe('https://multi-demo.example');
  });

  it('supports poseidonscans RSC endpoints and scanmanga LEL compressed page decoder', async () => {
    const { deflateSync } = await import('node:zlib');
    const tplMap = new Map(Object.entries(BUILT_IN_KEIYOUSHI_TEMPLATES));

    const poseidon = resolveSourceWithTemplates(
      FRENCH_CUSTOM_RECIPES.poseidonscans!(
        { slug: 'poseidonscans', id: 'poseidon-fr', name: 'Poseidon Scans', lang: 'fr', baseUrl: 'https://pos-demo.example' },
        '',
      ),
      tplMap,
    );
    const scanmanga = resolveSourceWithTemplates(
      FRENCH_CUSTOM_RECIPES.scanmanga!(
        { slug: 'scanmanga', id: 'scanmanga-fr', name: 'Scan-Manga', lang: 'fr', baseUrl: 'https://m.sm-demo.example' },
        '',
      ),
      tplMap,
    );

    const chapterId = 583837;
    const rawPayloadJson = JSON.stringify({
      dN: 'data.sm-demo.example',
      s: 'demo-series',
      v: '32209',
      c: String(chapterId),
      p: {
        '2': { f: '2_two', e: 'jpg' },
        '1': { f: '1_one', e: 'jpg' },
      },
    });
    const b64Payload = Buffer.from(rawPayloadJson, 'utf8').toString('base64');
    const reversedWithSuffix = b64Payload.split('').reverse().join('') + chapterId.toString(16);
    const compressedResp = deflateSync(Buffer.from(reversedWithSuffix, 'utf8')).toString('base64');

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://pos-demo.example/' || url === 'https://pos-demo.example') {
        return new Response(
          `18:${JSON.stringify([{ id: '1', position: 1, manga: { title: 'Pos Title', slug: 'pos-title' } }])}\n`,
          { status: 200 },
        );
      }
      if (url === 'https://pos-demo.example/serie/pos-title') {
        return new Response(
          `18:${JSON.stringify({
            manga: {
              title: 'Pos Title',
              slug: 'pos-title',
              description: 'Desc test',
              status: 'En cours',
              categories: [{ name: 'Action' }, { name: 'Magie' }],
              chapters: [{ number: 9, title: null, createdAt: '$D2026-10-24T19:59:53.926Z' }],
            },
          })}\n`,
          { status: 200 },
        );
      }
      if (url === 'https://pos-demo.example/serie/pos-title/chapter/9') {
        return new Response(
          `17:${JSON.stringify({
            currentChapter: { isPremium: false },
            initialData: { images: [{ originalUrl: '/api/chapters/pos-title/ch9/p1.webp', order: 0 }] },
          })}\n`,
          { status: 200 },
        );
      }
      if (url === 'https://m.sm-demo.example/TOP-Manga-Webtoon-47.html') {
        return new Response(
          `<html><div id="liste_series"><div class="image_listing"><a href="https://www.sm-demo.example/10834/Demo-Title.html"><img data-original="https://static.sm-demo.example/img/manga/demo.jpg" alt="Demo Title" /></a></div></div></html>`,
          { status: 200 },
        );
      }
      if (url === 'https://www.sm-demo.example/10834/Demo-Title.html') {
        return new Response(
          `<html>
            <meta itemprop="name" content="Demo Title" />
            <meta itemprop="image" content="https://static.sm-demo.example/img/manga/demo.jpg" />
            <div class="chapitre_nom"><a href="https://www.sm-demo.example/lecture-en-ligne/Demo-Chapitre-1_583837.html">Chapitre 1</a></div>
          </html>`,
          { status: 200 },
        );
      }
      if (url === 'https://www.sm-demo.example/lecture-en-ligne/Demo-Chapitre-1_583837.html') {
        return new Response(
          `<html><script>var sml='bVal';var sme='aVal';var smi='dVal';</script></html>`,
          { status: 200 },
        );
      }
      if (url === 'https://bqj.sm-demo.example/lel/583837.json') {
        return new Response(compressedResp, { status: 200 });
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    // Verify PoseidonScans flow
    const posPop = await parserEngine.getPopular(poseidon, 1);
    expect(posPop.items[0]?.title).toBe('Pos Title');
    expect(posPop.items[0]?.coverUrl).toBe('https://pos-demo.example/api/covers/pos-title.webp');
    const posDet = await parserEngine.getMangaDetails(poseidon, 'https://pos-demo.example/serie/pos-title');
    expect(posDet.genres).toEqual(['Action', 'Magie']);
    const posChs = await parserEngine.getChapters(poseidon, 'https://pos-demo.example/serie/pos-title');
    expect(posChs[0]?.title).toBe('Chapitre 9');
    expect(posChs[0]?.publishedAt).toBeGreaterThan(0);
    const posPages = await parserEngine.getChapterPages(poseidon, posChs[0]!.url);
    expect(posPages.map((p) => p.imageUrl)).toEqual(['https://pos-demo.example/api/chapters/pos-title/ch9/p1.webp']);

    // Verify Scan-Manga flow
    const smPop = await parserEngine.getPopular(scanmanga, 1);
    expect(smPop.items[0]?.title).toBe('Demo Title');
    const smChs = await parserEngine.getChapters(scanmanga, smPop.items[0]!.url);
    expect(smChs[0]?.url).toBe('https://www.sm-demo.example/lecture-en-ligne/Demo-Chapitre-1_583837.html');
    const smPages = await parserEngine.getChapterPages(scanmanga, smChs[0]!.url);
    expect(smPages.map((p) => p.imageUrl)).toEqual([
      'https://data.sm-demo.example/demo-series/32209/583837/1_one.jpg',
      'https://data.sm-demo.example/demo-series/32209/583837/2_two.jpg',
    ]);
    expect(smPages[0]?.headers?.Referer).toBe('https://www.sm-demo.example/lecture-en-ligne/Demo-Chapitre-1_583837.html');
  });
});
