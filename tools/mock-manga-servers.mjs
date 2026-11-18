import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '..', 'tests', 'fixtures');
const ENFORCE_HOTLINK = !process.argv.includes('--no-hotlink');

function readFixtureJson(fileName) {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, fileName), 'utf8'));
}

function makeSvg(title, subtitle, accent = '#e11d48', width = 600, height = 840) {
  const safeTitle = String(title).replace(/[<>&]/g, '');
  const safeSub = String(subtitle).replace(/[<>&]/g, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#111119" />
      <stop offset="100%" stop-color="#1c1627" />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)" />
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="20" fill="none" stroke="${accent}" stroke-width="4" opacity="0.7" />
  <circle cx="${width / 2}" cy="${height * 0.38}" r="96" fill="${accent}" opacity="0.18" />
  <text x="${width / 2}" y="${height * 0.40}" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="34" font-weight="700">${safeTitle}</text>
  <text x="${width / 2}" y="${height * 0.48}" text-anchor="middle" fill="#d4d4d8" font-family="sans-serif" font-size="22">${safeSub}</text>
  <text x="${width / 2}" y="${height - 60}" text-anchor="middle" fill="#71717a" font-family="monospace" font-size="16">KumoYomi Anti-Hotlink Verified</text>
</svg>`;
}

function readBody(req) {
  return new Promise((resolveBody) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
  });
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
}

const originesCatalogue = [
  {
    slug: 'les-chroniques-de-kumo',
    title: 'Les Chroniques de Kumo',
    cover: '/images/kumo-cover.svg',
    author: 'Akira Kumo',
    artist: 'Sora Ink',
    status: 'En cours',
    genres: ['Action', 'Fantastique', 'Aventure'],
    synopsis: [
      "Dans un monde où les bibliothèques célestes disparaissent, un lecteur découvre un manuscrit capable d'unifier tous les récits.",
      'Série de démonstration servant à tester la fusion multi-sources et le lecteur Blob anti-hotlink.',
    ],
    chapters: [
      { slug: 'chapitre-2', title: 'Chapitre 2 - Le Pont Suspendu', date: '14 Nov 2026' },
      { slug: 'chapitre-1', title: 'Chapitre 1 - Le Nuage Écarlate', date: '8 Août 2026' },
    ],
  },
  {
    slug: 'leveil-du-nuage',
    title: "L'Éveil du Nuage",
    cover: '/images/nuage-cover.svg',
    author: 'Yomi Studio',
    artist: 'Yomi Studio',
    status: 'Terminé',
    genres: ['Drame', 'Mystère'],
    synopsis: ['Une courte histoire complète dans les brumes de Kyoto.'],
    chapters: [{ slug: 'chapitre-1', title: 'Chapitre 1 - Brume Matinale', date: '1 Oct 2026' }],
  },
];

const madaraCatalogue = [
  {
    slug: 'les-chroniques-de-kumo',
    title: 'Les Chroniques de Kumo',
    cover: '/images/kumo-madara-cover.svg',
    author: 'Akira Kumo',
    status: 'En cours',
    genres: ['Action', 'Fantastique'],
    synopsis: 'Édition miroir sur le serveur Madara avec un chapitre bonus exclusif.',
    chapters: [
      { slug: 'chapitre-3-bonus', title: 'Chapitre 3 - Miroir Madara', date: '17 Nov 2026' },
      { slug: 'chapitre-2', title: 'Chapitre 2 - Le Pont Suspendu', date: '14 Nov 2026' },
      { slug: 'chapitre-1', title: 'Chapitre 1 - Le Nuage Écarlate', date: '8 Août 2026' },
    ],
  },
  {
    slug: 'la-lame-dobsidienne',
    title: "La Lame d'Obsidienne",
    cover: '/images/obsidienne-cover.svg',
    author: 'Kuro Forge',
    status: 'En cours',
    genres: ['Seinen', 'Arts Martiaux'],
    synopsis: 'Un forgeron solidaire affronte les clans du nord.',
    chapters: [{ slug: 'chapitre-1', title: 'Chapitre 1', date: '10 Nov 2026' }],
  },
];

// Serveur 1 : Origines mock + Repository JSON server (Port 4179)
const originesServer = createServer(async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1:4179');
  const path = reqUrl.pathname;

  if (path === '/repo/index.json') {
    const manifest = {
      name: 'Dépôt Test Local',
      description: 'Dépôt local de démonstration (Origines local et Madara local)',
      version: '1.0.0',
      templates: [
        readFixtureJson('template-origines.json'),
        readFixtureJson('template-madara.json'),
        readFixtureJson('template-mangathemesia.json'),
      ],
      sources: [
        {
          id: 'origines-local-test',
          name: 'Origines Local Test',
          lang: 'fr',
          extends: 'origines',
          baseUrl: 'http://127.0.0.1:4179',
          vars: { mangaPath: 'oeuvre' },
        },
        {
          id: 'madara-local-test',
          name: 'Madara Local Test',
          lang: 'fr',
          extends: 'madara',
          baseUrl: 'http://127.0.0.1:4180',
        },
      ],
    };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(manifest, null, 2));
    return;
  }

  if (path === '/admin/add-chapter' && req.method === 'POST') {
    const kumo = originesCatalogue[0];
    const nextNum = kumo.chapters.length + 1;
    const slug = `chapitre-${nextNum}`;
    if (!kumo.chapters.some((c) => c.slug === slug)) {
      kumo.chapters.unshift({
        slug,
        title: `Chapitre ${nextNum} - Nouvelle Sortie Live`,
        date: '18 Nov 2026',
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, slug, count: kumo.chapters.length }));
    return;
  }

  if (path.startsWith('/images/')) {
    const referer = req.headers.referer ?? '';
    if (ENFORCE_HOTLINK && !referer.startsWith('http://127.0.0.1:4179/')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Hotlink Blocked: valid Referer http://127.0.0.1:4179/ required');
      return;
    }
    const label = path.replace('/images/', '').replace('.svg', '');
    const isPage = label.startsWith('page-');
    const svg = makeSvg(
      isPage ? `Planche ${label.toUpperCase()}` : label.replace(/-/g, ' ').toUpperCase(),
      'Source : Origines Local (4179)',
      '#e11d48',
      isPage ? 760 : 540,
      isPage ? 1100 : 760,
    );
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
    res.end(svg);
    return;
  }

  if (path === '/wp-admin/admin-ajax.php' && req.method === 'POST') {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const query = (params.get('s') ?? '').trim().toLowerCase();
    const matched = query
      ? originesCatalogue.filter((m) => m.title.toLowerCase().includes(query))
      : originesCatalogue;
    const html = matched
      .map(
        (m) => `
      <a class="ori-card" href="/oeuvre/${m.slug}/">
        <img data-src="${m.cover}" alt="${m.title}" />
        <span class="ori-card-title">${m.title}</span>
      </a>`,
      )
      .join('\n');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ data: { html, more: false } }));
    return;
  }

  const chapterAjaxMatch = /^\/oeuvre\/([^/]+)\/ajax\/chapters\/?$/.exec(path);
  if (chapterAjaxMatch && req.method === 'POST') {
    const manga = originesCatalogue.find((m) => m.slug === chapterAjaxMatch[1]);
    if (!manga) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const html = manga.chapters
      .map(
        (c) => `
      <div class="ori-chl-row">
        <a class="ori-chl-corps" href="/oeuvre/${manga.slug}/${c.slug}/">
          <span class="ori-chl-nom">${c.title}</span>
          <span class="ori-chl-date" title="${c.date}">${c.date}</span>
        </a>
      </div>`,
      )
      .join('\n');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  const chapterPageMatch = /^\/oeuvre\/([^/]+)\/([^/]+)\/?$/.exec(path);
  if (chapterPageMatch && req.method === 'GET') {
    const [, mSlug, cSlug] = chapterPageMatch;
    const html = `<!doctype html><html><body>
      <h1>${mSlug} - ${cSlug}</h1>
      <div class="reading-content">
        <img class="wp-manga-chapter-img" data-src="\n\t  /images/page-1-${cSlug}.svg  \n" />
        <img class="wp-manga-chapter-img" data-lazy-src="/images/page-2-${cSlug}.svg" />
        <img class="wp-manga-chapter-img" src="/images/page-3-${cSlug}.svg" />
      </div>
    </body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  const detailMatch = /^\/oeuvre\/([^/]+)\/?$/.exec(path);
  if (detailMatch && req.method === 'GET') {
    const manga = originesCatalogue.find((m) => m.slug === detailMatch[1]);
    if (!manga) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const html = `<!doctype html><html><body>
      <h1 class="ori-sr-title">${manga.title}</h1>
      <div class="ori-sr-cover"><img src="${manga.cover}" /></div>
      <div class="ori-sr-infos"><dl>
        <dt>Auteur</dt><dd>${manga.author}</dd>
        <dt>Artiste</dt><dd>${manga.artist}</dd>
        <dt>Statut</dt><dd>${manga.status}</dd>
      </dl></div>
      <div class="ori-sr-syn-texte">
        ${manga.synopsis.map((p) => `<p>${p}</p>`).join('')}
      </div>
      <div class="ori-sr-genres">
        ${manga.genres.map((g) => `<a class="ori-sr-genre">${g}</a>`).join('')}
      </div>
    </body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// Serveur 2 : Madara mock (Port 4180)
const madaraServer = createServer(async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1:4180');
  const path = reqUrl.pathname;

  if (path.startsWith('/images/')) {
    const referer = req.headers.referer ?? '';
    if (ENFORCE_HOTLINK && !referer.startsWith('http://127.0.0.1:4180/')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Hotlink Blocked: valid Referer http://127.0.0.1:4180/ required');
      return;
    }
    const label = path.replace('/images/', '').replace('.svg', '');
    const isPage = label.startsWith('page-');
    const svg = makeSvg(
      isPage ? `Planche ${label.toUpperCase()}` : label.replace(/-/g, ' ').toUpperCase(),
      'Source : Madara Local (4180)',
      '#8b5cf6',
      isPage ? 760 : 540,
      isPage ? 1100 : 760,
    );
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
    res.end(svg);
    return;
  }

  if (path === '/wp-admin/admin-ajax.php' && req.method === 'POST') {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const query = (params.get('vars[s]') ?? '').trim().toLowerCase();
    const matched = query
      ? madaraCatalogue.filter((m) => m.title.toLowerCase().includes(query))
      : madaraCatalogue;
    const html = matched
      .map(
        (m) => `
      <div class="page-item-detail">
        <div class="item-thumb"><a href="/manga/${m.slug}/"><img data-src="${m.cover}" /></a></div>
        <div class="post-title"><h3><a href="/manga/${m.slug}/">${m.title}</a></h3></div>
        <div class="latest-chap"><span class="chapter"><a href="#">${m.chapters[0]?.title ?? ''}</a></span></div>
      </div>`,
      )
      .join('\n');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  const chapterAjaxMatch = /^\/manga\/([^/]+)\/ajax\/chapters\/?$/.exec(path);
  if (chapterAjaxMatch && req.method === 'POST') {
    const manga = madaraCatalogue.find((m) => m.slug === chapterAjaxMatch[1]);
    if (!manga) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const html = `<ul class="main version-chap">${manga.chapters
      .map(
        (c) => `
      <li class="wp-manga-chapter">
        <a href="/manga/${manga.slug}/${c.slug}/">${c.title}</a>
        <span class="chapter-release-date"><i>${c.date}</i></span>
      </li>`,
      )
      .join('\n')}</ul>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  const chapterPageMatch = /^\/manga\/([^/]+)\/([^/]+)\/?$/.exec(path);
  if (chapterPageMatch && req.method === 'GET') {
    const [, mSlug, cSlug] = chapterPageMatch;
    const html = `<!doctype html><html><body>
      <h1>${mSlug} - ${cSlug}</h1>
      <div class="reading-content">
        <div class="page-break"><img data-src="/images/page-1-${cSlug}.svg" /></div>
        <div class="page-break"><img src="/images/page-2-${cSlug}.svg" /></div>
      </div>
    </body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  const detailMatch = /^\/manga\/([^/]+)\/?$/.exec(path);
  if (detailMatch && req.method === 'GET') {
    const manga = madaraCatalogue.find((m) => m.slug === detailMatch[1]);
    if (!manga) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const html = `<!doctype html><html><body>
      <div class="post-title"><h1><span class="manga-title-badges">HD</span> ${manga.title}</h1></div>
      <div class="summary_image"><img data-src="${manga.cover}" /></div>
      <div class="author-content"><a href="#">${manga.author}</a></div>
      <div class="post-content_item">
        <div class="summary-heading"><h5>Statut</h5></div>
        <div class="summary-content">${manga.status}</div>
      </div>
      <div class="description-summary"><div class="summary__content"><p>${manga.synopsis}</p></div></div>
      <div class="genres-content">${manga.genres.map((g) => `<a href="#">${g}</a>`).join('')}</div>
    </body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

originesServer.listen(4179, '127.0.0.1', () => {
  console.log('[Mock Origines + Repo] Listening on http://127.0.0.1:4179');
});

madaraServer.listen(4180, '127.0.0.1', () => {
  console.log('[Mock Madara] Listening on http://127.0.0.1:4180');
});
