import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeMangaKey } from '@/src/core/db/db';
import { extractChapterNumber } from '@/src/core/parser/chapterNumber';
import { parseFlexibleDate } from '@/src/core/parser/dateParser';
import { UniversalParserEngine } from '@/src/core/parser/engine';
import { CloudflareChallengeError } from '@/src/core/parser/httpClient';
import {
  resolveSourceWithTemplates,
  validateRawSourceConfig,
  validateTemplateConfig,
} from '@/src/core/parser/validator';
import type { SourceTemplateConfig } from '@/src/core/types/source';
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

  it('normalise les clés manga, numéros de chapitre et dates FR/EN', () => {
    expect(normalizeMangaKey('Les Chroniques de Kumo !')).toBe(
      normalizeMangaKey('les-chroniques-de-kumo'),
    );
    expect(extractChapterNumber('Tome 2 - Chapitre 14.5 : Final')).toBe(14.5);
    expect(extractChapterNumber('Prologue')).toBeNull();
    expect(parseFlexibleDate('8 Août 2026')).toBe(new Date(2026, 7, 8).getTime());
    expect(parseFlexibleDate('il y a 2 heures', 1_700_000_000_000)).toBe(
      1_700_000_000_000 - 7_200_000,
    );
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
});
