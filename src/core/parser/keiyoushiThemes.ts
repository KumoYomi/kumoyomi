import type {
  RawSourceConfig,
  SourceTemplateConfig,
} from '@/src/core/types/source';

export interface KeiyoushiSourceMetadata {
  slug: string;
  id: string;
  name: string;
  lang: string;
  baseUrl: string;
  iconUrl?: string;
  nsfw?: boolean;
  theme?: string;
}

export type KeiyoushiCompatReason =
  | 'supported_theme'
  | 'supported_recipe'
  | 'supported_kotlin_ast'
  | 'incompatible_turnstile'
  | 'incompatible_canvas'
  | 'incompatible_preview'
  | 'incompatible_nextjs_rsc'
  | 'incompatible_custom';

export interface KotlinCompilerResult {
  compatible: boolean;
  reason: KeiyoushiCompatReason;
  config?: RawSourceConfig;
}

/**
 * Thèmes CMS génériques supportés nativement par le moteur déclaratif KumoYomi.
 * Ne contient aucune URL ni nom de site tiers (100 % générique).
 */
export const BUILT_IN_KEIYOUSHI_TEMPLATES: Record<string, SourceTemplateConfig> = {
  madara: {
    id: 'madara',
    name: 'Madara WordPress Theme',
    lang: 'fr',
    vars: {
      mangaSubString: 'manga',
    },
    popular: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/{{vars.mangaSubString}}/page/{{page}}/?m_orderby=views',
      },
      itemSelector: 'div.page-item-detail, .manga__item, .c-tabs-item__content',
      fields: {
        title: {
          selector: ['.post-title a', '.post-title h3', '.post-title h5', 'h3 a'],
        },
        url: {
          selector: ['.post-title a', 'a'],
          attr: 'href',
          absoluteUrl: true,
        },
        cover: {
          selector: 'img',
          attr: ['data-src', 'data-lazy-src', 'srcset', 'src'],
          replace: [{ pattern: '\\s+.*$', replacement: '' }],
          absoluteUrl: true,
        },
      },
      hasNextPageSelector: 'a.nextpostslink, .nav-previous a, a.next',
    },
    latest: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/{{vars.mangaSubString}}/page/{{page}}/?m_orderby=latest',
      },
      itemSelector: 'div.page-item-detail, .manga__item, .c-tabs-item__content',
      fields: {
        title: {
          selector: ['.post-title a', '.post-title h3', '.post-title h5', 'h3 a'],
        },
        url: {
          selector: ['.post-title a', 'a'],
          attr: 'href',
          absoluteUrl: true,
        },
        cover: {
          selector: 'img',
          attr: ['data-src', 'data-lazy-src', 'srcset', 'src'],
          replace: [{ pattern: '\\s+.*$', replacement: '' }],
          absoluteUrl: true,
        },
      },
      hasNextPageSelector: 'a.nextpostslink, .nav-previous a, a.next',
    },
    search: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/page/{{page}}/?s={{encodedQuery}}&post_type=wp-manga',
      },
      itemSelector: '.c-tabs-item__content, div.page-item-detail, div.row.c-tabs-item__content',
      fields: {
        title: {
          selector: ['.post-title a', '.post-title h3', 'h3 a'],
        },
        url: {
          selector: ['.post-title a', 'a'],
          attr: 'href',
          absoluteUrl: true,
        },
        cover: {
          selector: 'img',
          attr: ['data-src', 'data-lazy-src', 'src'],
          absoluteUrl: true,
        },
      },
      hasNextPageSelector: 'a.nextpostslink, .nav-previous a, a.next',
    },
    mangaDetails: {
      request: {
        method: 'GET',
        url: '{{mangaUrl}}',
      },
      fields: {
        title: {
          selector: ['div.post-title h1', 'div.post-title h3', '#manga-title > h1', 'h1'],
        },
        cover: {
          selector: ['div.summary_image img', 'meta[property="og:image"]'],
          attr: ['data-src', 'data-lazy-src', 'content', 'src'],
          absoluteUrl: true,
        },
        author: {
          selector: 'div.author-content > a, div.manga-authors > a',
          joinAll: ', ',
        },
        artist: {
          selector: 'div.artist-content > a',
          joinAll: ', ',
        },
        description: {
          selector: [
            'div.description-summary div.summary__content',
            'div.summary_content div.manga-excerpt',
            'div.summary_content div.post-content_item > h5 + div',
          ],
          joinAll: '\n',
        },
        genres: {
          selector: 'div.genres-content a, div.tags-content a',
          joinAll: ', ',
        },
        altTitles: {
          selector: '.post-content_item:contains(Alt) .summary-content',
        },
        status: {
          selector: [
            '.post-content_item .summary-heading:contains(Statut) + .summary-content',
            '.post-content_item .summary-heading:contains(État) + .summary-content',
            '.post-content_item .summary-heading:contains(Status) + .summary-content',
            'div.summary-content',
          ],
        },
      },
      statusMap: {
        'en cours': 'ongoing',
        ongoing: 'ongoing',
        terminé: 'completed',
        complet: 'completed',
        completed: 'completed',
        'en pause': 'hiatus',
        hiatus: 'hiatus',
        abandonné: 'cancelled',
        annulé: 'cancelled',
        canceled: 'cancelled',
      },
    },
    chapters: {
      request: {
        method: 'POST',
        url: '{{mangaUrlSlash}}ajax/chapters/',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      },
      fallbackInline: true,
      itemSelector: 'li.wp-manga-chapter',
      fields: {
        title: { selector: 'a' },
        url: { selector: 'a', attr: 'href', absoluteUrl: true },
        date: { selector: 'span.chapter-release-date' },
      },
    },
    pages: {
      request: {
        method: 'GET',
        url: '{{chapterUrl}}?style=list',
      },
      itemSelector:
        'div.reading-content img.wp-manga-chapter-img, div.page-break img, li.blocks-gallery-item img',
      imageUrl: {
        attr: ['data-src', 'data-lazy-src', 'src'],
        absoluteUrl: true,
      },
    },
  },

  mangathemesia: {
    id: 'mangathemesia',
    name: 'MangaThemesia WordPress Theme',
    lang: 'fr',
    vars: {
      mangaUrlDirectory: 'manga',
    },
    popular: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/{{vars.mangaUrlDirectory}}/?page={{page}}&order=popular',
      },
      itemSelector: 'div.listupd div.bsx, .utao .uta, .listo .bsx',
      fields: {
        title: { selector: ['div.tt', '.title', 'a[title]', 'a'] },
        url: { selector: 'a', attr: 'href', absoluteUrl: true },
        cover: {
          selector: 'img',
          attr: ['data-src', 'data-lazy-src', 'src'],
          absoluteUrl: true,
        },
      },
      hasNextPageSelector: 'div.pagination .next, div.hpage a.r, a.next',
    },
    latest: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/{{vars.mangaUrlDirectory}}/?page={{page}}&order=update',
      },
      itemSelector: 'div.listupd div.bsx, .utao .uta, .listo .bsx',
      fields: {
        title: { selector: ['div.tt', '.title', 'a[title]', 'a'] },
        url: { selector: 'a', attr: 'href', absoluteUrl: true },
        cover: {
          selector: 'img',
          attr: ['data-src', 'data-lazy-src', 'src'],
          absoluteUrl: true,
        },
      },
      hasNextPageSelector: 'div.pagination .next, div.hpage a.r, a.next',
    },
    search: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/page/{{page}}/?s={{encodedQuery}}',
      },
      itemSelector: 'div.listupd div.bsx, .utao .uta, .listo .bsx',
      fields: {
        title: { selector: ['div.tt', '.title', 'a[title]', 'a'] },
        url: { selector: 'a', attr: 'href', absoluteUrl: true },
        cover: {
          selector: 'img',
          attr: ['data-src', 'data-lazy-src', 'src'],
          absoluteUrl: true,
        },
      },
      hasNextPageSelector: 'div.pagination .next, div.hpage a.r, a.next',
    },
    mangaDetails: {
      request: {
        method: 'GET',
        url: '{{mangaUrl}}',
      },
      fields: {
        title: {
          selector: ['h1.entry-title', '.ts-breadcrumb li:last-child span', 'h1'],
        },
        cover: {
          selector: ['.infomanga > div[itemprop=image] img', '.thumb img', 'meta[property="og:image"]'],
          attr: ['data-src', 'data-lazy-src', 'content', 'src'],
          absoluteUrl: true,
        },
        author: {
          selector: [
            '.imptdt:contains(Auteur) i',
            '.fmed:has(b:contains(Auteur)) span',
            '.imptdt:contains(Author) i',
            '.fmed:has(b:contains(Author)) span',
          ],
        },
        artist: {
          selector: [
            '.imptdt:contains(Artiste) i',
            '.fmed:has(b:contains(Artiste)) span',
            '.imptdt:contains(Artist) i',
            '.fmed:has(b:contains(Artist)) span',
          ],
        },
        description: {
          selector: ['.entry-content[itemprop=description]', '.desc'],
          joinAll: '\n',
        },
        genres: {
          selector: '.mgen a, .seriestugenre a, div.gnr a',
          joinAll: ', ',
        },
        status: {
          selector: ['.imptdt:contains(Statut) i', '.imptdt:contains(Status) i', '.tsinfo .imptdt i'],
        },
      },
      statusMap: {
        'en cours': 'ongoing',
        ongoing: 'ongoing',
        terminé: 'completed',
        completed: 'completed',
        hiatus: 'hiatus',
        'en pause': 'hiatus',
      },
    },
    chapters: {
      fallbackInline: true,
      itemSelector: '#chapterlist li, div.bxcl li, div.cl li',
      fields: {
        title: { selector: ['span.chapternum', '.lch a', 'a'] },
        url: { selector: 'a', attr: 'href', absoluteUrl: true },
        date: { selector: ['span.chapterdate', '.rightoff'] },
      },
    },
    pages: {
      request: {
        method: 'GET',
        url: '{{chapterUrl}}',
      },
      scriptJson: {
        regex: 'ts_reader\\.run\\((\\{[\\s\\S]*?\\})\\)\\s*;?',
        itemsPath: 'sources.0.images',
      },
      itemSelector: 'div#readerarea img',
      imageUrl: {
        attr: ['data-src', 'data-lazy-src', 'src'],
        absoluteUrl: true,
      },
    },
  },

  origines: {
    id: 'origines',
    name: 'Origines Madara Child Theme',
    lang: 'fr',
    vars: {
      mangaPath: 'manga',
    },
    popular: {
      request: {
        method: 'POST',
        url: '{{baseUrl}}/wp-admin/admin-ajax.php',
        formBody: {
          action: 'madara_child_catalogue',
          s: '',
          genres: '',
          statut: 'tous',
          note: '0',
          origine: '',
          tri: 'populaire',
          chmin: '0',
          chmax: '0',
          page: '{{page}}',
          auteur: '',
          artiste: '',
          annee: '',
        },
        responseType: 'json-html',
        jsonHtmlPath: 'data.html',
      },
      itemSelector: 'a.ori-card',
      fields: {
        title: { selector: 'span.ori-card-title' },
        url: { attr: 'href', absoluteUrl: true },
        cover: { selector: 'img', attr: ['data-src', 'src'], absoluteUrl: true },
      },
      hasNextPageJsonPath: 'data.more',
    },
    latest: {
      request: {
        method: 'POST',
        url: '{{baseUrl}}/wp-admin/admin-ajax.php',
        formBody: {
          action: 'madara_child_catalogue',
          s: '',
          genres: '',
          statut: 'tous',
          note: '0',
          origine: '',
          tri: 'recents',
          chmin: '0',
          chmax: '0',
          page: '{{page}}',
          auteur: '',
          artiste: '',
          annee: '',
        },
        responseType: 'json-html',
        jsonHtmlPath: 'data.html',
      },
      itemSelector: 'a.ori-card',
      fields: {
        title: { selector: 'span.ori-card-title' },
        url: { attr: 'href', absoluteUrl: true },
        cover: { selector: 'img', attr: ['data-src', 'src'], absoluteUrl: true },
      },
      hasNextPageJsonPath: 'data.more',
    },
    search: {
      request: {
        method: 'POST',
        url: '{{baseUrl}}/wp-admin/admin-ajax.php',
        formBody: {
          action: 'madara_child_catalogue',
          s: '{{query}}',
          genres: '',
          statut: 'tous',
          note: '0',
          origine: '',
          tri: 'recents',
          chmin: '0',
          chmax: '0',
          page: '{{page}}',
          auteur: '',
          artiste: '',
          annee: '',
        },
        responseType: 'json-html',
        jsonHtmlPath: 'data.html',
      },
      itemSelector: 'a.ori-card',
      fields: {
        title: { selector: 'span.ori-card-title' },
        url: { attr: 'href', absoluteUrl: true },
        cover: { selector: 'img', attr: ['data-src', 'src'], absoluteUrl: true },
      },
      hasNextPageJsonPath: 'data.more',
    },
    mangaDetails: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/{{vars.mangaPath}}/{{mangaSlug}}/',
      },
      fields: {
        title: { selector: 'h1.ori-sr-title' },
        cover: { selector: 'div.ori-sr-cover img', attr: ['data-src', 'src'], absoluteUrl: true },
        author: { selector: 'div.ori-sr-infos dt', labelMatch: ['auteur', 'scénario'] },
        artist: { selector: 'div.ori-sr-infos dt', labelMatch: ['artiste', 'dessin'] },
        description: { selector: 'div.ori-sr-syn-texte p', joinAll: '\n' },
        genres: { selector: 'div.ori-sr-genres a.ori-sr-genre', joinAll: ', ' },
        status: { selector: 'div.ori-sr-infos dt', labelMatch: ['statut'] },
      },
      statusMap: {
        'en cours': 'ongoing',
        terminé: 'completed',
        'en pause': 'hiatus',
        abandonné: 'cancelled',
        annulé: 'cancelled',
      },
    },
    chapters: {
      request: {
        method: 'POST',
        url: '{{baseUrl}}/{{vars.mangaPath}}/{{mangaSlug}}/ajax/chapters/',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      },
      fallbackInline: true,
      itemSelector: 'div.ori-chl-row',
      fields: {
        title: { selector: ['span.ori-chl-nom', 'a.ori-chl-corps'] },
        url: { selector: 'a.ori-chl-corps', attr: 'href', absoluteUrl: true },
        date: { selector: 'span.ori-chl-date', attr: ['title', 'text'] },
      },
    },
    pages: {
      request: {
        method: 'GET',
        url: '{{chapterUrlSlash}}?style=list',
      },
      itemSelector: 'div.reading-content img.wp-manga-chapter-img',
      imageUrl: {
        attr: ['data-src', 'src'],
        absoluteUrl: true,
      },
    },
  },

  pizzareader: {
    id: 'pizzareader',
    name: 'PizzaReader REST JSON API',
    lang: 'fr',
    vars: {
      apiPath: '/api',
    },
    popular: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}{{vars.apiPath}}/comics',
        responseType: 'json',
      },
      itemsPath: 'comics',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'url', prefix: '{{baseUrl}}' },
        cover: { jsonPath: 'thumbnail', absoluteUrl: true },
      },
    },
    latest: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}{{vars.apiPath}}/comics',
        responseType: 'json',
      },
      itemsPath: 'comics',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'url', prefix: '{{baseUrl}}' },
        cover: { jsonPath: 'thumbnail', absoluteUrl: true },
      },
    },
    search: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}{{vars.apiPath}}/search/{{encodedQuery}}',
        responseType: 'json',
      },
      itemsPath: 'comics',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'url', prefix: '{{baseUrl}}' },
        cover: { jsonPath: 'thumbnail', absoluteUrl: true },
      },
    },
    mangaDetails: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}{{vars.apiPath}}{{mangaPath}}',
        responseType: 'json',
      },
      fields: {
        title: { jsonPath: 'comic.title' },
        cover: { jsonPath: 'comic.thumbnail', absoluteUrl: true },
        author: { jsonPath: 'comic.author' },
        artist: { jsonPath: 'comic.artist' },
        description: { jsonPath: 'comic.description' },
        status: { jsonPath: 'comic.status' },
        genres: { jsonPath: 'comic.genres', joinAll: ', ' },
      },
      statusMap: {
        'in cors': 'ongoing',
        'on goin': 'ongoing',
        'en cour': 'ongoing',
        complet: 'completed',
        conclus: 'completed',
        terminé: 'completed',
      },
    },
    chapters: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}{{vars.apiPath}}{{mangaPath}}',
        responseType: 'json',
      },
      itemsPath: 'comic.chapters',
      fields: {
        title: { jsonPath: 'full_title' },
        url: { jsonPath: 'url', prefix: '{{baseUrl}}' },
        date: { jsonPath: 'published_on' },
        chapterNumber: { jsonPath: 'chapter' },
      },
    },
    pages: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}{{vars.apiPath}}{{chapterPath}}',
        responseType: 'json',
      },
      itemsPath: 'chapter.pages',
      imageUrl: {
        jsonPath: '',
        absoluteUrl: true,
      },
    },
  },

  fuzzydoodle: {
    id: 'fuzzydoodle',
    name: 'FuzzyDoodle HTML Theme',
    lang: 'fr',
    popular: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/manga?page={{page}}',
      },
      itemSelector: 'div#card-real',
      fields: {
        title: { selector: 'h2.text-sm' },
        url: { selector: 'a', attr: 'href', absoluteUrl: true },
        cover: { selector: 'img', attr: ['data-src', 'data-lazy-src', 'data-cfsrc', 'src'], absoluteUrl: true },
      },
      hasNextPageSelector: 'ul.pagination > li:last-child:not(.pagination-disabled)',
    },
    latest: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/latest?page={{page}}',
      },
      itemSelector: 'div#card-real',
      fields: {
        title: { selector: 'h2.text-sm' },
        url: { selector: 'a', attr: 'href', absoluteUrl: true },
        cover: { selector: 'img', attr: ['data-src', 'data-lazy-src', 'data-cfsrc', 'src'], absoluteUrl: true },
      },
      hasNextPageSelector: 'ul.pagination > li:last-child:not(.pagination-disabled)',
    },
    search: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/manga?title={{encodedQuery}}&page={{page}}',
      },
      itemSelector: 'div#card-real',
      fields: {
        title: { selector: 'h2.text-sm' },
        url: { selector: 'a', attr: 'href', absoluteUrl: true },
        cover: { selector: 'img', attr: ['data-src', 'data-lazy-src', 'data-cfsrc', 'src'], absoluteUrl: true },
      },
      hasNextPageSelector: 'ul.pagination > li:last-child:not(.pagination-disabled)',
    },
    mangaDetails: {
      request: {
        method: 'GET',
        url: '{{mangaUrl}}',
      },
      fields: {
        title: { selector: 'main > section > div h1, main > section > div h2' },
        cover: { selector: 'main > section > div div.relative img', attr: ['data-src', 'src'], absoluteUrl: true },
        description: { selector: 'p#description' },
        genres: { selector: 'div.flex > a.inline-block', joinAll: ', ' },
        author: { selector: 'p:has(span:containsOwn(Auteur)) span.capitalize, p:has(span:containsOwn(Author)) span.capitalize' },
        artist: { selector: 'p:has(span:containsOwn(Artiste)) span.capitalize, p:has(span:containsOwn(Artist)) span.capitalize' },
        status: { selector: 'p:has(span:containsOwn(Statut)) span.capitalize, p:has(span:containsOwn(Status)) span.capitalize' },
      },
      statusMap: {
        'en cours': 'ongoing',
        ongoing: 'ongoing',
        terminé: 'completed',
        completed: 'completed',
        hiatus: 'hiatus',
        cancelled: 'cancelled',
      },
    },
    chapters: {
      fallbackInline: true,
      itemSelector: 'div#chapters-list > a[href]',
      fields: {
        title: { selector: ['#item-title', 'span'] },
        url: { attr: 'href', absoluteUrl: true },
        date: { selector: 'span.text-gray-500' },
      },
    },
    pages: {
      request: {
        method: 'GET',
        url: '{{chapterUrl}}',
      },
      itemSelector: 'div#chapter-container > img',
      imageUrl: {
        attr: ['data-src', 'data-lazy-src', 'data-cfsrc', 'src'],
        absoluteUrl: true,
      },
    },
  },

  mmrcms: {
    id: 'mmrcms',
    name: 'MMRCMS Manga Theme',
    lang: 'fr',
    vars: {
      itemPath: 'manga',
    },
    popular: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/filterList?page={{page}}&sortBy=views&asc=false',
      },
      itemSelector: 'div.media',
      fields: {
        title: { selector: '.media-heading a, .manga-heading a' },
        url: { selector: '.media-heading a, .manga-heading a', attr: 'href', absoluteUrl: true },
        cover: { selector: 'img', attr: ['data-src', 'src'], absoluteUrl: true },
      },
      hasNextPageSelector: '.pagination a[rel=next]',
    },
    latest: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/latest-release?page={{page}}',
      },
      itemSelector: 'div.mangalist div.manga-item',
      fields: {
        title: { selector: 'h3 a, a' },
        url: { selector: 'h3 a, a', attr: 'href', absoluteUrl: true },
        cover: { selector: 'img', attr: ['data-src', 'src'], absoluteUrl: true },
      },
      hasNextPageSelector: '.pagination a[rel=next]',
    },
    search: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/search?query={{encodedQuery}}',
        responseType: 'json',
      },
      itemsPath: 'suggestions',
      fields: {
        title: { jsonPath: 'value' },
        url: { jsonPath: 'data', prefix: '{{baseUrl}}/{{vars.itemPath}}/' },
      },
    },
    mangaDetails: {
      request: {
        method: 'GET',
        url: '{{mangaUrl}}',
      },
      fields: {
        title: { selector: '.listmanga-header, .widget-title, h2' },
        cover: { selector: '.row img.img-responsive', attr: ['data-src', 'src'], absoluteUrl: true },
        description: { selector: '.row .well p, .row .well', joinAll: '\n' },
        author: { selector: '.row .dl-horizontal dt', labelMatch: ['auteur', 'author'] },
        artist: { selector: '.row .dl-horizontal dt', labelMatch: ['artiste', 'artist'] },
        genres: { selector: '.row .dl-horizontal dt', labelMatch: ['catégories', 'categories', 'genres'] },
        status: { selector: '.row .dl-horizontal dt', labelMatch: ['statut', 'status'] },
      },
      statusMap: {
        'en cours': 'ongoing',
        ongoing: 'ongoing',
        complet: 'completed',
        complete: 'completed',
        terminé: 'completed',
      },
    },
    chapters: {
      fallbackInline: true,
      itemSelector: 'ul.chapters > li:not(.btn)',
      fields: {
        title: { selector: '.chapter-title-rtl a, .chapter-title-rtl' },
        url: { selector: '.chapter-title-rtl a', attr: 'href', absoluteUrl: true },
        date: { selector: '.date-chapter-title-rtl' },
      },
    },
    pages: {
      request: {
        method: 'GET',
        url: '{{chapterUrl}}',
      },
      itemSelector: '#all > img.img-responsive',
      imageUrl: {
        attr: ['data-src', 'src'],
        absoluteUrl: true,
      },
    },
  },

  scanreader: {
    id: 'scanreader',
    name: 'ScanReader Protected Theme',
    lang: 'fr',
    popular: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/bibliotheque/page/{{page}}/?sort=views',
      },
      itemSelector: 'div.manga-card',
      fields: {
        title: { selector: 'h3' },
        url: { selector: 'a', attr: 'href', absoluteUrl: true },
        cover: { selector: 'img', attr: ['data-lazy-src', 'data-src', 'src'], absoluteUrl: true },
      },
      hasNextPageSelector: 'a.pagination-next',
    },
    latest: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/dernieres-sorties/page/{{page}}/',
      },
      itemSelector: 'div.manga-cover',
      fields: {
        title: { selector: 'h3.manga-title-display, h3' },
        url: { selector: 'a', attr: 'href', absoluteUrl: true },
        cover: { selector: 'img', attr: ['data-lazy-src', 'data-src', 'src'], absoluteUrl: true },
      },
      hasNextPageSelector: 'a.pagination-next',
    },
    search: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/?s={{encodedQuery}}&post_type=manga',
      },
      itemSelector: 'div.manga-card',
      fields: {
        title: { selector: 'h3' },
        url: { selector: 'a', attr: 'href', absoluteUrl: true },
        cover: { selector: 'img', attr: ['data-lazy-src', 'data-src', 'src'], absoluteUrl: true },
      },
    },
    mangaDetails: {
      request: {
        method: 'GET',
        url: '{{mangaUrl}}',
      },
      fields: {
        title: { selector: 'h1.manga-title' },
        cover: {
          selector: ['meta[property="og:image"]', 'img.wp-post-image'],
          attr: ['content', 'data-lazy-src', 'src'],
          absoluteUrl: true,
        },
        description: { selector: 'div.manga-content p', joinAll: '\n' },
      },
    },
    chapters: {
      extractVarsFromDetails: {
        mangaId: { selector: '#secure-chapters-container', attr: 'data-manga-id' },
        nonce: { selector: '#secure-chapters-container', attr: 'data-nonce' },
      },
      request: {
        method: 'POST',
        url: '{{baseUrl}}/wp-admin/admin-ajax.php',
        formBody: {
          action: 'load_protected_chapters_html',
          manga_id: '{{vars.mangaId}}',
          nonce: '{{vars.nonce}}',
        },
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Referer: '{{mangaUrl}}',
        },
        responseType: 'json-html',
        jsonHtmlPath: 'data',
      },
      fallbackInline: true,
      itemSelector: 'a[href*="/chapitre/"]',
      fields: {
        title: { selector: ['h4', 'self'] },
        url: { attr: 'href', absoluteUrl: true },
      },
    },
    pages: {
      request: {
        method: 'GET',
        url: '{{chapterUrl}}',
      },
      scriptArrayRegex: '"([A-Za-z0-9+/=]{20,})"',
      imageUrl: {
        base64Reverse: true,
        absoluteUrl: true,
      },
    },
  },

  iken: {
    id: 'iken',
    name: 'Iken REST JSON Theme',
    lang: 'en',
    vars: {
      apiUrl: '',
    },
    popular: {
      request: {
        method: 'GET',
        url: '{{vars.apiUrl}}/api/query?perPage=18&orderBy=totalViews&orderDirection=desc&page={{page}}',
        responseType: 'json',
      },
      itemsPath: 'posts',
      fields: {
        title: { jsonPath: 'postTitle' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/series/' },
        cover: { jsonPath: 'featuredImage', absoluteUrl: true },
      },
      hasNextPageCalc: { totalPath: 'totalCount', pageSize: 18 },
    },
    latest: {
      request: {
        method: 'GET',
        url: '{{vars.apiUrl}}/api/query?perPage=18&orderBy=updatedAt&orderDirection=desc&page={{page}}',
        responseType: 'json',
      },
      itemsPath: 'posts',
      fields: {
        title: { jsonPath: 'postTitle' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/series/' },
        cover: { jsonPath: 'featuredImage', absoluteUrl: true },
      },
      hasNextPageCalc: { totalPath: 'totalCount', pageSize: 18 },
    },
    search: {
      request: {
        method: 'GET',
        url: '{{vars.apiUrl}}/api/query?perPage=18&searchTerm={{encodedQuery}}&page={{page}}',
        responseType: 'json',
      },
      itemsPath: 'posts',
      fields: {
        title: { jsonPath: 'postTitle' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/series/' },
        cover: { jsonPath: 'featuredImage', absoluteUrl: true },
      },
      hasNextPageCalc: { totalPath: 'totalCount', pageSize: 18 },
    },
    mangaDetails: {
      request: {
        method: 'GET',
        url: '{{vars.apiUrl}}/api/post?postSlug={{mangaSlug}}',
        responseType: 'json',
      },
      fields: {
        title: { jsonPath: 'post.postTitle' },
        cover: { jsonPath: 'post.featuredImage', absoluteUrl: true },
        author: { jsonPath: 'post.author' },
        artist: { jsonPath: 'post.artist' },
        description: { jsonPath: 'post.postContent' },
        genres: { jsonPath: 'post.genres', joinAll: ', ' },
        altTitles: { jsonPath: 'post.alternativeTitles' },
        status: { jsonPath: 'post.seriesStatus' },
      },
      statusMap: {
        ongoing: 'ongoing',
        coming_soon: 'ongoing',
        mass_released: 'ongoing',
        completed: 'completed',
        cancelled: 'cancelled',
        dropped: 'cancelled',
      },
    },
    chapters: {
      request: {
        method: 'GET',
        url: '{{vars.apiUrl}}/api/post?postSlug={{mangaSlug}}',
        responseType: 'json',
      },
      itemsPath: 'post.chapters',
      fields: {
        title: { jsonTemplate: 'Chapter {{number}} - {{title}}' },
        url: { jsonTemplate: '{{baseUrl}}/series/{{mangaSlug}}/{{slug}}?id={{id}}' },
        date: { jsonPath: 'createdAt' },
        chapterNumber: { jsonPath: 'number' },
      },
    },
    pages: {
      request: {
        method: 'GET',
        url: '{{vars.apiUrl}}/api/chapter?chapterId={{chapterQueryId}}',
        responseType: 'json',
      },
      itemsPath: 'chapter.images',
      imageUrl: { jsonPath: 'url', absoluteUrl: true },
    },
  },
};

export const SUPPORTED_THEME_IDS = new Set(Object.keys(BUILT_IN_KEIYOUSHI_TEMPLATES));

export const INCOMPATIBLE_THEME_REASON_MAP: Record<string, KeiyoushiCompatReason> = {
  crunchyscanst: 'incompatible_turnstile',
  oyst: 'incompatible_turnstile',
  pam: 'incompatible_canvas',
  komiko: 'incompatible_preview',
};

type CustomRecipeFactory = (
  meta: KeiyoushiSourceMetadata,
  ktContent: string,
) => RawSourceConfig;

function extractLiteralUrlFromKt(ktContent: string, varOrFuncHint: RegExp): string | undefined {
  const match = varOrFuncHint.exec(ktContent);
  return match?.[1]?.replace(/\/+$/, '');
}

/**
 * Recettes pures indexées uniquement par slug Keiyoushi (zéro URL ni domaine codé en dur).
 * Toutes les URLs proviennent exclusivement de `meta.baseUrl` ou du fichier `.kt` importé.
 */
export const FRENCH_CUSTOM_RECIPES: Record<string, CustomRecipeFactory> = {
  poseidonscans: (meta) => ({
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    baseUrl: meta.baseUrl,
    ...(meta.nsfw ? { nsfw: true } : {}),
    popular: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}',
        headers: { RSC: '1' },
        responseType: 'nextjs-flight',
        flightMatchKeys: ['position', 'manga'],
      },
      itemsPath: '',
      fields: {
        title: { jsonPath: 'manga.title' },
        url: { jsonPath: 'manga.slug', prefix: '{{baseUrl}}/serie/' },
        cover: { jsonPath: 'manga.slug', prefix: '{{baseUrl}}/api/covers/', suffix: '.webp' },
      },
    },
    latest: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/api/manga/lastchapters?limit=16&page={{page}}',
        responseType: 'json',
      },
      itemsPath: 'data',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/serie/' },
        cover: { jsonPath: 'slug', prefix: '{{baseUrl}}/api/covers/', suffix: '.webp' },
      },
      pageSize: 16,
    },
    search: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/series?search={{encodedQuery}}&page={{page}}',
      },
      itemSelector: 'div.grid a.block.group',
      fields: {
        title: { selector: 'h2' },
        url: { attr: 'href', absoluteUrl: true },
        cover: {
          attr: 'href',
          regex: '/serie/([^/?#]+)',
          prefix: '{{baseUrl}}/api/covers/',
          suffix: '.webp',
        },
      },
      hasNextPageSelector: 'nav[aria-label=Pagination] a:contains(Suivant)',
    },
    mangaDetails: {
      request: {
        method: 'GET',
        url: '{{mangaUrl}}',
        headers: { RSC: '1' },
        responseType: 'nextjs-flight',
        flightMatchKeys: ['slug', 'chapters', 'categories'],
      },
      fields: {
        title: { jsonPath: 'title' },
        cover: { jsonPath: 'slug', prefix: '{{baseUrl}}/api/covers/', suffix: '.webp' },
        author: { jsonPath: 'author' },
        artist: { jsonPath: 'artist' },
        description: { jsonPath: 'description' },
        genres: { jsonPath: 'categories', joinAll: ', ' },
        status: { jsonPath: 'status' },
      },
      statusMap: {
        'en cours': 'ongoing',
        terminé: 'completed',
        'en pause': 'hiatus',
        hiatus: 'hiatus',
        annulé: 'cancelled',
        abandonné: 'cancelled',
      },
    },
    chapters: {
      request: {
        method: 'GET',
        url: '{{mangaUrl}}',
        headers: { RSC: '1' },
        responseType: 'nextjs-flight',
        flightMatchKeys: ['slug', 'chapters', 'categories'],
      },
      itemsPath: 'chapters',
      fields: {
        title: {
          jsonTemplate: 'Chapitre {{number}} - {{title}}',
          replace: [{ pattern: '\\s*-\\s*$', replacement: '' }],
        },
        url: { jsonTemplate: '{{baseUrl}}/serie/{{mangaSlug}}/chapter/{{number}}' },
        date: { jsonPath: 'createdAt' },
        chapterNumber: { jsonPath: 'number' },
      },
    },
    pages: {
      request: {
        method: 'GET',
        url: '{{chapterUrl}}',
        headers: { RSC: '1' },
        responseType: 'nextjs-flight',
        flightMatchKeys: ['currentChapter', 'initialData'],
      },
      itemsPath: 'initialData.images',
      imageUrl: { jsonPath: 'originalUrl', absoluteUrl: true },
    },
  }),

  scanmanga: (meta) => {
    let domain = '';
    try {
      const parts = new URL(meta.baseUrl).hostname.split('.').filter(Boolean);
      if (parts.length >= 2) domain = parts.slice(-2).join('.');
    } catch {
      // Malformed baseUrl handled by validator
    }
    return {
      id: meta.id,
      name: meta.name,
      lang: meta.lang,
      baseUrl: meta.baseUrl,
      ...(meta.nsfw ? { nsfw: true } : {}),
      popular: {
        request: { method: 'GET', url: '{{baseUrl}}/TOP-Manga-Webtoon-47.html' },
        itemSelector: '#carouselTOPContainer div.top, #liste_series div.image_listing',
        fields: {
          title: { selector: ['a.atop', 'img'], attr: ['text', 'alt', 'title'] },
          url: {
            selector: ['a.atop', 'a[href*=".html"]:not([name])'],
            attr: 'href',
            absoluteUrl: true,
          },
          cover: {
            selector: 'img',
            attr: ['data-original', 'src'],
            absoluteUrl: true,
          },
        },
      },
      latest: {
        request: { method: 'GET', url: '{{baseUrl}}' },
        itemSelector: '#content_news .publi, article.top_body div.listing',
        fields: {
          title: { selector: ['a.l_manga', 'a.nom_manga'] },
          url: { selector: ['a.l_manga', 'a.nom_manga'], attr: 'href', absoluteUrl: true },
          cover: { selector: 'img', attr: ['src', 'data-original'], absoluteUrl: true },
        },
      },
      search: {
        request: {
          method: 'GET',
          url: `https://bqj.${domain}/search/quick.json?term={{encodedQuery}}`,
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          responseType: 'json',
        },
        itemsPath: 'title',
        fields: {
          title: { jsonPath: 'nom_match' },
          url: { jsonPath: 'url', absoluteUrl: true },
          cover: { jsonPath: 'image', prefix: `https://static.${domain}/img/manga/` },
        },
      },
      mangaDetails: {
        request: { method: 'GET', url: '{{mangaUrl}}' },
        fields: {
          title: {
            selector: ['meta[itemprop=name]', 'meta[property="og:title"]'],
            attr: 'content',
            replace: [
              { pattern: '^Lire\\s+', replacement: '' },
              { pattern: '\\s+VF\\s*-.*$', replacement: '' },
            ],
          },
          cover: {
            selector: ['meta[itemprop=image]', 'meta[property="og:image"]'],
            attr: 'content',
            absoluteUrl: true,
          },
          description: { selector: ['div.titres_desc[itemprop=description]', '[itemprop=description]'] },
          author: { selector: 'div[itemprop=author]' },
          status: {
            selector: '.titres_souspart:has(div:containsOwn(Statut))',
            attr: 'ownText',
          },
        },
      },
      chapters: {
        fallbackInline: true,
        itemSelector:
          'div.chapt_m:has(td.publimg a[href*="/lecture-en-ligne/"]), div.chapitre_nom:has(a[href*="/lecture-en-ligne/"])',
        fields: {
          title: { selector: ['td.publimg span.i a', 'a[href*="/lecture-en-ligne/"]'] },
          url: {
            selector: ['td.publimg span.i a', 'a[href*="/lecture-en-ligne/"]'],
            attr: 'href',
            absoluteUrl: true,
          },
        },
      },
      pages: {
        request: { method: 'GET', url: '{{chapterUrl}}' },
        customPageDecoder: 'scanmanga-lel',
      },
    };
  },
  aniverse: (meta) => ({
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    baseUrl: meta.baseUrl,
    ...(meta.nsfw ? { nsfw: true } : {}),
    popular: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/api/anime/search?media=manga&page={{page}}&pageSize=40',
        responseType: 'json',
      },
      itemsPath: 'data',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
        cover: { jsonPath: 'image', absoluteUrl: true },
      },
      hasNextPageCalc: { totalPath: 'total', limitPath: 'pageSize', pagePath: 'page' },
    },
    latest: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/api/manga?page={{page}}',
        responseType: 'json',
      },
      itemsPath: 'items',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
        cover: { jsonPath: 'image', absoluteUrl: true },
      },
      hasNextPageJsonPath: 'hasNextPage',
    },
    search: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/api/anime/search?media=manga&q={{encodedQuery}}&page={{page}}&pageSize=40',
        responseType: 'json',
      },
      itemsPath: 'data',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
        cover: { jsonPath: 'image', absoluteUrl: true },
      },
      hasNextPageCalc: { totalPath: 'total', limitPath: 'pageSize', pagePath: 'page' },
    },
    mangaDetails: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/manga/{{mangaSlug}}',
        responseType: 'nextjs-flight',
        flightMatchKeys: ['manga', 'chapters'],
      },
      fields: {
        title: { jsonPath: 'manga.title.userPreferred' },
        cover: { jsonPath: 'manga.coverImage.large', absoluteUrl: true },
        description: {
          jsonPath: 'manga.description',
          replace: [{ pattern: '<br\\s*/?>', replacement: '\n', flags: 'gi' }],
        },
        author: { jsonPath: 'manga.authors', joinAll: ', ' },
        artist: { jsonPath: 'manga.artists', joinAll: ', ' },
        genres: { jsonPath: 'manga.genres', joinAll: ', ' },
        status: { jsonPath: 'manga.status' },
      },
      statusMap: {
        releasing: 'ongoing',
        finished: 'completed',
        hiatus: 'hiatus',
        cancelled: 'cancelled',
      },
    },
    chapters: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/manga/{{mangaSlug}}',
        responseType: 'nextjs-flight',
        flightMatchKeys: ['manga', 'chapters'],
      },
      itemsPath: 'chapters',
      reverseOrder: true,
      fields: {
        title: { jsonTemplate: 'Chapitre {{number}} - {{title}}' },
        url: { jsonTemplate: '{{baseUrl}}/read/{{mangaSlug}}/{{id}}' },
        date: { jsonPath: 'updatedAt' },
        chapterNumber: { jsonPath: 'number' },
      },
    },
    pages: {
      request: {
        method: 'GET',
        url: '{{chapterUrl}}',
        responseType: 'nextjs-flight',
        flightMatchKeys: ['pages', 'locked'],
      },
      itemsPath: 'pages',
      imageUrl: { jsonPath: 'src', absoluteUrl: true },
    },
  }),

  bigsolo: (meta) => ({
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    baseUrl: meta.baseUrl,
    ...(meta.nsfw ? { nsfw: true } : {}),
    popular: {
      request: { method: 'GET', url: '{{baseUrl}}/data/series', responseType: 'json' },
      itemsPath: 'reco',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
        cover: { jsonPath: 'cover.url_hq', absoluteUrl: true },
      },
    },
    latest: {
      request: { method: 'GET', url: '{{baseUrl}}/data/series', responseType: 'json' },
      itemsPath: 'series',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
        cover: { jsonPath: 'cover.url_hq', absoluteUrl: true },
      },
    },
    search: {
      request: { method: 'GET', url: '{{baseUrl}}/data/series', responseType: 'json' },
      itemsPath: 'series',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
        cover: { jsonPath: 'cover.url_hq', absoluteUrl: true },
      },
    },
    mangaDetails: {
      request: { method: 'GET', url: '{{baseUrl}}/data/series/{{mangaSlug}}', responseType: 'json' },
      fields: {
        title: { jsonPath: 'title' },
        cover: { jsonPath: 'cover.url_hq', absoluteUrl: true },
        author: { jsonPath: 'author' },
        artist: { jsonPath: 'artist' },
        description: { jsonPath: 'description' },
        genres: { jsonPath: 'tags', joinAll: ', ' },
        status: { jsonPath: 'status' },
      },
      statusMap: {
        'en cours': 'ongoing',
        finis: 'completed',
        fini: 'completed',
      },
    },
    chapters: {
      request: { method: 'GET', url: '{{baseUrl}}/data/series/{{mangaSlug}}', responseType: 'json' },
      itemsPath: 'chapters',
      objectEntriesKeyField: '_chapterNum',
      reverseOrder: true,
      fields: {
        title: { jsonTemplate: 'Ch. {{_chapterNum}} – {{title}}' },
        url: { jsonTemplate: '{{baseUrl}}/manga/{{mangaSlug}}/{{_chapterNum}}' },
        date: { jsonPath: 'timestamp' },
        chapterNumber: { jsonPath: '_chapterNum' },
      },
    },
    pages: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/data/series/{{chapterParentSlug}}/{{chapterSlug}}',
        responseType: 'json',
      },
      itemsPath: 'images',
      imageUrl: { jsonPath: '', absoluteUrl: true },
    },
  }),

  blossomscans: (meta) => ({
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    baseUrl: meta.baseUrl,
    ...(meta.nsfw ? { nsfw: true } : {}),
    popular: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/api/series?page={{page}}&limit=36&sort=popularity',
        responseType: 'json',
      },
      itemsPath: 'data',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/serie/' },
        cover: { jsonPath: 'cover', absoluteUrl: true },
      },
      hasNextPageCalc: {
        totalPath: 'pagination.totalPages',
        pagePath: 'pagination.page',
        pageSize: 1,
      },
    },
    latest: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/api/series?page={{page}}&limit=36&sort=recents',
        responseType: 'json',
      },
      itemsPath: 'data',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/serie/' },
        cover: { jsonPath: 'cover', absoluteUrl: true },
      },
      hasNextPageCalc: {
        totalPath: 'pagination.totalPages',
        pagePath: 'pagination.page',
        pageSize: 1,
      },
    },
    search: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/api/series?page={{page}}&limit=36&sort=popularity&search={{encodedQuery}}',
        responseType: 'json',
      },
      itemsPath: 'data',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/serie/' },
        cover: { jsonPath: 'cover', absoluteUrl: true },
      },
      hasNextPageCalc: {
        totalPath: 'pagination.totalPages',
        pagePath: 'pagination.page',
        pageSize: 1,
      },
    },
    mangaDetails: {
      request: { method: 'GET', url: '{{baseUrl}}/api/series/{{mangaSlug}}', responseType: 'json' },
      fields: {
        title: { jsonPath: 'title' },
        cover: { jsonPath: 'cover', absoluteUrl: true },
        author: { jsonPath: 'author' },
        artist: { jsonPath: 'artist' },
        description: { jsonPath: 'synopsis' },
        genres: { jsonPath: 'genres', joinAll: ', ' },
        status: { jsonPath: 'status' },
      },
      statusMap: {
        ongoing: 'ongoing',
        completed: 'completed',
        hiatus: 'hiatus',
      },
    },
    chapters: {
      request: { method: 'GET', url: '{{baseUrl}}/api/series/{{mangaSlug}}', responseType: 'json' },
      itemsPath: 'chapters',
      fields: {
        title: { jsonTemplate: 'Chapitre {{number}} - {{title}}' },
        url: { jsonTemplate: '{{baseUrl}}/serie/{{mangaSlug}}/chapitre/{{number}}?id={{chapterId}}' },
        date: { jsonPath: 'publishedAt' },
        chapterNumber: { jsonPath: 'number' },
      },
    },
    pages: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/api/series/{{chapterPath[1]}}',
        responseType: 'json',
      },
      findEntry: {
        itemsPath: 'chapters',
        matchField: 'chapterId',
        matchTemplate: '{{chapterQueryId}}',
        parseJsonArrayField: 'pages',
      },
      imageUrl: { jsonPath: '', absoluteUrl: true },
    },
  }),

  lelscan: (meta) => ({
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    baseUrl: meta.baseUrl,
    ...(meta.nsfw ? { nsfw: true } : {}),
    popular: {
      request: { method: 'GET', url: '{{baseUrl}}/lecture-en-ligne-one-piece' },
      itemSelector: '#navigation select:first-of-type option',
      fields: {
        title: {},
        url: { attr: 'value', absoluteUrl: true },
      },
    },
    latest: {
      request: { method: 'GET', url: '{{baseUrl}}/lecture-en-ligne-one-piece' },
      itemSelector: '#main_hot_ul li',
      fields: {
        title: { selector: 'a.hot_manga_img', attr: 'title', replace: [{ pattern: '\\s+Scan$', replacement: '' }] },
        url: { selector: 'a.hot_manga_img', attr: 'href', absoluteUrl: true },
        cover: { selector: 'a.hot_manga_img img', attr: ['data-src', 'src'], absoluteUrl: true },
      },
    },
    mangaDetails: {
      request: { method: 'GET', url: '{{mangaUrl}}' },
      fields: {
        title: {
          selector: ['#header-image h2 span[itemprop=title]', '#header-image h2', 'h1'],
          replace: [{ pattern: '^Lecture en ligne\\s+', replacement: '' }],
        },
        cover: { selector: 'meta[property="og:image"]', attr: 'content', absoluteUrl: true },
      },
    },
    chapters: {
      fallbackInline: true,
      itemSelector: '#navigation select:nth-of-type(2) option',
      fields: {
        title: { prefix: 'Chapitre ' },
        url: { attr: 'value', absoluteUrl: true },
      },
    },
    pages: {
      request: { method: 'GET', url: '{{chapterUrl}}/1' },
      followPageLinks: {
        itemSelector: '#navigation select:nth-of-type(3) option',
        urlAttr: 'value',
        imageSelector: '#image img',
        imageAttr: ['data-src', 'src'],
      },
    },
  }),

  rimuscans: (meta) => ({
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    baseUrl: meta.baseUrl,
    ...(meta.nsfw ? { nsfw: true } : {}),
    popular: {
      request: { method: 'GET', url: '{{baseUrl}}/api/series?sort=rating&page={{page}}', responseType: 'json' },
      itemsPath: 'series',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
        cover: { jsonPath: 'cover_url', absoluteUrl: true },
      },
      hasNextPageJsonPath: 'has_more',
    },
    latest: {
      request: { method: 'GET', url: '{{baseUrl}}/api/series?page={{page}}', responseType: 'json' },
      itemsPath: 'series',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
        cover: { jsonPath: 'cover_url', absoluteUrl: true },
      },
      hasNextPageJsonPath: 'has_more',
    },
    search: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/api/series?search={{encodedQuery}}&page={{page}}',
        responseType: 'json',
      },
      itemsPath: 'series',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
        cover: { jsonPath: 'cover_url', absoluteUrl: true },
      },
      hasNextPageJsonPath: 'has_more',
    },
    mangaDetails: {
      request: {
        method: 'GET',
        url: '{{mangaUrl}}',
        responseType: 'json',
        scriptJson: {
          selector: 'script[type="application/ld+json"]',
          regex: '(\\{[\\s\\S]*"ComicSeries"[\\s\\S]*\\})',
        },
      },
      fields: {
        title: { jsonPath: 'name' },
        cover: { jsonPath: 'image', absoluteUrl: true },
        description: { jsonPath: 'description' },
        author: { jsonPath: 'author.name' },
        artist: { jsonPath: 'illustrator.name' },
        genres: { jsonPath: 'genre', joinAll: ', ' },
      },
    },
    chapters: {
      request: {
        method: 'GET',
        url: '{{mangaUrl}}',
        responseType: 'nextjs-flight',
        flightMatchKeys: ['number', 'type', 'images'],
      },
      itemsPath: '',
      fields: {
        title: { jsonTemplate: 'Chapitre {{number}} - {{title}}' },
        url: { jsonTemplate: '{{baseUrl}}/read/{{mangaSlug}}/{{number}}' },
        date: { jsonPath: 'releaseDate' },
        chapterNumber: { jsonPath: 'number' },
      },
    },
    pages: {
      request: {
        method: 'GET',
        url: '{{chapterUrl}}',
        responseType: 'nextjs-flight',
        flightMatchKeys: ['number', 'images'],
      },
      findEntry: {
        matchField: 'number',
        matchTemplate: '{{chapterSlug}}',
        itemsArrayField: 'images',
      },
      imageUrl: { jsonPath: 'url', absoluteUrl: true },
    },
  }),

  dassouscan: (meta) => ({
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    baseUrl: meta.baseUrl,
    ...(meta.nsfw ? { nsfw: true } : {}),
    popular: {
      request: { method: 'GET', url: '{{baseUrl}}/catalogue?tri=popular&page={{page}}' },
      itemSelector: 'article.dsc-cat-card, article.ap-rel',
      fields: {
        title: { selector: ['.dsc-cat-card__title a', 'a.ap-rel__title'] },
        url: {
          selector: [
            'a.dsc-cat-card__cover-link',
            '.dsc-cat-card__title a',
            'a.dsc-cat-card__open',
            'a.ap-rel__cover',
            'a.ap-rel__title',
          ],
          attr: 'href',
          absoluteUrl: true,
        },
        cover: {
          selector: ['.dsc-cat-card__cover img', '.ap-rel__cover img'],
          attr: ['data-src', 'src'],
          absoluteUrl: true,
        },
      },
      hasNextPageSelector: 'a.dsc-cat__pager-btn[href]:contains(Suivant)',
    },
    latest: {
      request: { method: 'GET', url: '{{baseUrl}}/catalogue?tri=latest&page={{page}}' },
      itemSelector: 'article.dsc-cat-card, article.ap-rel',
      fields: {
        title: { selector: ['.dsc-cat-card__title a', 'a.ap-rel__title'] },
        url: {
          selector: [
            'a.dsc-cat-card__cover-link',
            '.dsc-cat-card__title a',
            'a.dsc-cat-card__open',
            'a.ap-rel__cover',
            'a.ap-rel__title',
          ],
          attr: 'href',
          absoluteUrl: true,
        },
        cover: {
          selector: ['.dsc-cat-card__cover img', '.ap-rel__cover img'],
          attr: ['data-src', 'src'],
          absoluteUrl: true,
        },
      },
      hasNextPageSelector: 'a.dsc-cat__pager-btn[href]:contains(Suivant)',
    },
    search: {
      request: { method: 'GET', url: '{{baseUrl}}/catalogue?q={{encodedQuery}}&page={{page}}' },
      itemSelector: 'article.dsc-cat-card, article.ap-rel',
      fields: {
        title: { selector: ['.dsc-cat-card__title a', 'a.ap-rel__title'] },
        url: {
          selector: [
            'a.dsc-cat-card__cover-link',
            '.dsc-cat-card__title a',
            'a.dsc-cat-card__open',
            'a.ap-rel__cover',
            'a.ap-rel__title',
          ],
          attr: 'href',
          absoluteUrl: true,
        },
        cover: {
          selector: ['.dsc-cat-card__cover img', '.ap-rel__cover img'],
          attr: ['data-src', 'src'],
          absoluteUrl: true,
        },
      },
      hasNextPageSelector: 'a.dsc-cat__pager-btn[href]:contains(Suivant)',
    },
    mangaDetails: {
      request: { method: 'GET', url: '{{mangaUrl}}' },
      fields: {
        title: { selector: 'h1' },
        cover: { selector: '.dsc-mf__cover img', attr: ['data-src', 'src'], absoluteUrl: true },
        description: { selector: '.dsc-mf__synopsis-text' },
        genres: { selector: '.dsc-mf__tags a.dsc-mf__tag', joinAll: ', ' },
      },
    },
    chapters: {
      fallbackInline: true,
      reverseOrder: true,
      itemSelector: 'div.dsc-manga-chapter-block:not(:has(a[href*="/inscription/"]))',
      fields: {
        title: { selector: ['.chapter-title', 'a.dsc-manga-chapter-block__title-link'] },
        url: { selector: 'a.dsc-manga-chapter-block__title-link', attr: 'href', absoluteUrl: true },
        date: { selector: '.chapter-info' },
      },
    },
    pages: {
      request: { method: 'GET', url: '{{chapterUrl}}' },
      itemSelector: '#dsc-chapter-reader-content .dsc-chapter-strip-img',
      imageUrl: { attr: ['data-src', 'src'], absoluteUrl: true },
    },
  }),

  furyosquad: (meta) => ({
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    baseUrl: meta.baseUrl,
    ...(meta.nsfw ? { nsfw: true } : {}),
    popular: {
      request: { method: 'GET', url: '{{baseUrl}}/mangas' },
      itemSelector: 'div#fs-tous div.fs-card-body',
      fields: {
        title: { selector: 'span.fs-comic-title a' },
        url: { selector: 'div.fs-card-img-container a', attr: 'href', absoluteUrl: true },
        cover: { selector: 'div.fs-card-img-container img', attr: ['data-src', 'src'], absoluteUrl: true },
      },
    },
    latest: {
      request: { method: 'GET', url: '{{baseUrl}}' },
      itemSelector: 'table.table-striped tr',
      fields: {
        title: { selector: 'span.fs-comic-title a' },
        url: { selector: 'span.fs-comic-title a', attr: 'href', absoluteUrl: true },
        cover: { selector: 'img.fs-chap-img', attr: ['data-src', 'src'], absoluteUrl: true },
      },
    },
    mangaDetails: {
      request: { method: 'GET', url: '{{mangaUrl}}' },
      fields: {
        title: { selector: 'h1.fs-comic-title' },
        cover: { selector: 'img.comic-cover', attr: ['data-src', 'src'], absoluteUrl: true },
        description: { selector: 'div.fs-comic-description' },
        author: { selector: 'div.comic-info p.fs-comic-label', labelMatch: ['scénario', 'scenario', 'auteur'] },
        genres: { selector: 'div.comic-info p.fs-comic-label', labelMatch: ['genre', 'genres'] },
      },
    },
    chapters: {
      fallbackInline: true,
      itemSelector: 'div.fs-chapter-list div.element',
      fields: {
        title: { selector: 'div.title a' },
        url: { selector: 'div.title a', attr: 'href', absoluteUrl: true },
        date: { selector: 'div.meta_r' },
      },
    },
    pages: {
      request: { method: 'GET', url: '{{chapterUrl}}' },
      itemSelector: 'div.fs-read img[id]',
      imageUrl: { attr: ['data-src', 'src'], absoluteUrl: true },
    },
  }),

  mangamoins: (meta, ktContent) => {
    const fallbackSalts: string[] = [];
    const saltMatch = /FALLBACK_SALTS\s*=\s*listOf\(([^)]+)\)/.exec(ktContent);
    if (saltMatch?.[1]) {
      for (const m of saltMatch[1].matchAll(/"([^"]+)"/g)) {
        if (m[1]) fallbackSalts.push(m[1]);
      }
    }
    return {
      id: meta.id,
      name: meta.name,
      lang: meta.lang,
      baseUrl: meta.baseUrl,
      ...(meta.nsfw ? { nsfw: true } : {}),
      warmupUrl: '{{baseUrl}}',
      popular: {
        request: { method: 'GET', url: '{{baseUrl}}/api/v1/trends', responseType: 'json' },
        itemsPath: 'data',
        fields: {
          title: { jsonPath: 'title', decodeHtmlEntities: true },
          url: { jsonPath: ['slug', 'mangaSlug'], prefix: '{{baseUrl}}/manga/' },
          cover: { jsonPath: 'cover', absoluteUrl: true },
        },
      },
      latest: {
        request: { method: 'GET', url: '{{baseUrl}}/api/v1/mangas?page={{page}}&limit=20', responseType: 'json' },
        itemsPath: 'data',
        fields: {
          title: { jsonPath: 'title', decodeHtmlEntities: true },
          url: { jsonPath: ['mangaSlug', 'slug'], prefix: '{{baseUrl}}/manga/' },
          cover: { jsonPath: 'cover', absoluteUrl: true },
        },
        hasNextPageCalc: { totalPath: 'total', limitPath: 'limit', pagePath: 'page' },
      },
      search: {
        request: {
          method: 'GET',
          url: '{{baseUrl}}/api/v1/mangas?q={{encodedQuery}}&page={{page}}&limit=20',
          responseType: 'json',
        },
        itemsPath: 'data',
        fields: {
          title: { jsonPath: 'title', decodeHtmlEntities: true },
          url: { jsonPath: ['mangaSlug', 'slug'], prefix: '{{baseUrl}}/manga/' },
          cover: { jsonPath: 'cover', absoluteUrl: true },
        },
        hasNextPageCalc: { totalPath: 'total', limitPath: 'limit', pagePath: 'page' },
      },
      mangaDetails: {
        request: { method: 'GET', url: '{{baseUrl}}/api/v1/manga?slug={{mangaSlug}}', responseType: 'json' },
        fields: {
          title: { jsonPath: 'info.title', decodeHtmlEntities: true },
          cover: { jsonPath: 'info.cover', absoluteUrl: true },
          author: { jsonPath: 'info.author' },
          description: { jsonPath: 'info.description', decodeHtmlEntities: true },
          status: { jsonPath: 'info.status' },
        },
        statusMap: {
          'en cours': 'ongoing',
          terminé: 'completed',
          pause: 'hiatus',
        },
      },
      chapters: {
        request: { method: 'GET', url: '{{baseUrl}}/api/v1/manga?slug={{mangaSlug}}', responseType: 'json' },
        itemsPath: 'chapters',
        fields: {
          title: { jsonTemplate: 'Chapitre {{num}} - {{title}}', decodeHtmlEntities: true },
          url: { jsonPath: 'slug', prefix: '{{baseUrl}}/scan/' },
          date: { jsonPath: 'time' },
          chapterNumber: { jsonPath: 'num' },
        },
      },
      pages: {
        request: { method: 'GET', url: '{{baseUrl}}/api/v1/scan?slug={{chapterSlug}}', responseType: 'json' },
        numberedPages: {
          countJsonPath: 'pageNumbers',
          baseUrlJsonPath: 'pagesBaseUrl',
          padStart: 2,
          extension: '.webp',
          stripSuffixes: ['_b'],
          stripTokensFromScript: {
            url: '{{baseUrl}}/includes/components/js/reader.js',
            regexes: [
              'polochon[\'"]?\\s*\\]?\\s*=\\s*[\'"]([^\'"]+)[\'"]',
              '[\'"]([^\'"]*)[\'"]',
            ],
            minLength: 3,
            ...(fallbackSalts.length > 0 ? { fallbackTokens: fallbackSalts } : {}),
          },
        },
      },
    };
  },

  punkrecords: (meta) => ({
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    baseUrl: meta.baseUrl,
    ...(meta.nsfw ? { nsfw: true } : {}),
    popular: {
      request: { method: 'GET', url: '{{baseUrl}}/api/mangas?sort=popular&page={{page}}&perPage=24', responseType: 'json' },
      itemsPath: 'items',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
        cover: { jsonPath: 'coverUrl', absoluteUrl: true },
      },
      hasNextPageCalc: { totalPath: 'totalPages', pagePath: 'page', pageSize: 1 },
    },
    latest: {
      request: { method: 'GET', url: '{{baseUrl}}/api/mangas?sort=updated&page={{page}}&perPage=24', responseType: 'json' },
      itemsPath: 'items',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
        cover: { jsonPath: 'coverUrl', absoluteUrl: true },
      },
      hasNextPageCalc: { totalPath: 'totalPages', pagePath: 'page', pageSize: 1 },
    },
    search: {
      request: { method: 'GET', url: '{{baseUrl}}/api/search?q={{encodedQuery}}&page={{page}}&perPage=24', responseType: 'json' },
      itemsPath: 'items',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
        cover: { jsonPath: 'coverUrl', absoluteUrl: true },
      },
      hasNextPageCalc: { totalPath: 'totalPages', pagePath: 'page', pageSize: 1 },
    },
    mangaDetails: {
      request: { method: 'GET', url: '{{baseUrl}}/api/mangas/{{mangaSlug}}', responseType: 'json' },
      fields: {
        title: { jsonPath: 'manga.title' },
        cover: { jsonPath: ['manga.coverFullUrl', 'manga.coverUrl'], absoluteUrl: true },
        author: { jsonPath: 'manga.author' },
        artist: { jsonPath: 'manga.artist' },
        description: { jsonPath: 'manga.description' },
        genres: { jsonPath: 'manga.genres', joinAll: ', ' },
      },
    },
    chapters: {
      request: { method: 'GET', url: '{{baseUrl}}/api/mangas/{{mangaSlug}}', responseType: 'json' },
      itemsPath: 'chapters',
      reverseOrder: true,
      fields: {
        title: { jsonTemplate: 'Chapitre {{number}} - {{title}}' },
        url: { jsonPath: 'slug', prefix: '{{baseUrl}}/{{mangaSlug}}/' },
        date: { jsonPath: 'publishedAt' },
        chapterNumber: { jsonPath: 'number' },
      },
    },
    pages: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/api/mangas/{{chapterParentSlug}}/chapters/{{chapterSlug}}/reader',
        responseType: 'json',
      },
      itemsPath: 'pages',
      imageUrl: { jsonPath: ['coloredUrl', 'url'], absoluteUrl: true },
    },
  }),

  scanhentaimenu: (meta, ktContent) => {
    const cdnHost =
      extractLiteralUrlFromKt(ktContent, /return\s+"(https?:\/\/[^"]+)\$path"/) ?? meta.baseUrl;
    return {
      id: meta.id,
      name: meta.name,
      lang: meta.lang,
      baseUrl: meta.baseUrl,
      ...(meta.nsfw ? { nsfw: true } : {}),
      vars: {
        cdnHost,
      },
      popular: {
        request: { method: 'GET', url: '{{baseUrl}}/api/mangas?page={{page}}&sort=views', responseType: 'json' },
        itemsPath: 'mangas',
        fields: {
          title: { jsonPath: 'title' },
          url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
          cover: { jsonPath: 'coverPath', prefix: '{{baseUrl}}', absoluteUrl: true },
        },
        hasNextPageCalc: { totalPath: 'pagination.totalPages', pagePath: 'pagination.current', pageSize: 1 },
      },
      latest: {
        request: { method: 'GET', url: '{{baseUrl}}/api/mangas?page={{page}}&sort=latest', responseType: 'json' },
        itemsPath: 'mangas',
        fields: {
          title: { jsonPath: 'title' },
          url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
          cover: { jsonPath: 'coverPath', prefix: '{{baseUrl}}', absoluteUrl: true },
        },
        hasNextPageCalc: { totalPath: 'pagination.totalPages', pagePath: 'pagination.current', pageSize: 1 },
      },
      search: {
        request: {
          method: 'GET',
          url: '{{baseUrl}}/api/mangas?page={{page}}&search={{encodedQuery}}',
          responseType: 'json',
        },
        itemsPath: 'mangas',
        fields: {
          title: { jsonPath: 'title' },
          url: { jsonPath: 'slug', prefix: '{{baseUrl}}/manga/' },
          cover: { jsonPath: 'coverPath', prefix: '{{baseUrl}}', absoluteUrl: true },
        },
        hasNextPageCalc: { totalPath: 'pagination.totalPages', pagePath: 'pagination.current', pageSize: 1 },
      },
      mangaDetails: {
        request: { method: 'GET', url: '{{baseUrl}}/api/mangas/{{mangaSlug}}', responseType: 'json' },
        fields: {
          title: { jsonPath: 'manga.title' },
          cover: { jsonPath: 'manga.coverPath', prefix: '{{baseUrl}}', absoluteUrl: true },
          description: { jsonPath: 'manga.description' },
          author: { jsonPath: 'manga.authors', joinAll: ', ' },
          artist: { jsonPath: 'manga.artists', joinAll: ', ' },
          genres: { jsonPath: 'manga.genres', joinAll: ', ' },
          status: { jsonPath: 'manga.status' },
        },
        statusMap: {
          ongoing: 'ongoing',
          completed: 'completed',
          hiatus: 'hiatus',
        },
      },
      chapters: {
        request: { method: 'GET', url: '{{baseUrl}}/api/mangas/{{mangaSlug}}', responseType: 'json' },
        itemsPath: 'manga.chapters',
        fields: {
          title: { jsonTemplate: 'Chapitre {{chapterNumber}} - {{title}}' },
          url: { jsonPath: 'id', prefix: '{{baseUrl}}/read/' },
          date: { jsonPath: 'publishedAt' },
          chapterNumber: { jsonPath: 'chapterNumber' },
        },
      },
      pages: {
        request: { method: 'GET', url: '{{baseUrl}}/api/mangas/read/{{chapterSlug}}', responseType: 'json' },
        itemsPath: 'chapter.pages',
        imageUrl: { jsonPath: 'filePath', prefix: '{{vars.cdnHost}}', absoluteUrl: true },
      },
    };
  },

  solarisscans: (meta) => ({
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    baseUrl: meta.baseUrl,
    ...(meta.nsfw ? { nsfw: true } : {}),
    popular: {
      request: { method: 'GET', url: '{{baseUrl}}/manga/?catalog_sort=popular&catalog_page={{page}}' },
      itemSelector: 'article.solaris-catalog-card',
      fields: {
        title: { selector: 'h2 a' },
        url: { selector: 'h2 a', attr: 'href', absoluteUrl: true },
        cover: { selector: '.solaris-catalog-card__cover img', attr: ['data-src', 'src'], absoluteUrl: true },
      },
      hasNextPageSelector: 'a[href*="catalog_page="]',
    },
    latest: {
      request: { method: 'GET', url: '{{baseUrl}}/manga/?catalog_sort=recent&catalog_page={{page}}' },
      itemSelector: 'article.solaris-catalog-card',
      fields: {
        title: { selector: 'h2 a' },
        url: { selector: 'h2 a', attr: 'href', absoluteUrl: true },
        cover: { selector: '.solaris-catalog-card__cover img', attr: ['data-src', 'src'], absoluteUrl: true },
      },
      hasNextPageSelector: 'a[href*="catalog_page="]',
    },
    search: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/manga/?catalog_q={{encodedQuery}}&catalog_sort=popular&catalog_page={{page}}',
      },
      itemSelector: 'article.solaris-catalog-card',
      fields: {
        title: { selector: 'h2 a' },
        url: { selector: 'h2 a', attr: 'href', absoluteUrl: true },
        cover: { selector: '.solaris-catalog-card__cover img', attr: ['data-src', 'src'], absoluteUrl: true },
      },
      hasNextPageSelector: 'a[href*="catalog_page="]',
    },
    mangaDetails: {
      request: { method: 'GET', url: '{{mangaUrl}}' },
      fields: {
        title: { selector: 'section.sz-ri-info-card h1' },
        cover: { selector: '.sz-ri-cover img', attr: ['data-src', 'src'], absoluteUrl: true },
        description: { selector: ['[data-hero-synopsis-full]', '[data-hero-synopsis-short]'] },
        author: { selector: '.sz-ri-byline strong' },
        genres: { selector: '.sz-ri-main-genres span', joinAll: ', ' },
      },
    },
    chapters: {
      fallbackInline: true,
      itemSelector: '#swChapterGrid a.sz-chapter-card',
      fields: {
        title: { selector: ['.sz-ri-chapter-body strong', 'strong'] },
        url: { attr: 'href', absoluteUrl: true },
      },
    },
    pages: {
      request: { method: 'GET', url: '{{chapterUrl}}' },
      scriptArrayRegex: '"(https?:\\\\?/\\\\?/[^"]+\\.(?:jpg|jpeg|png|webp|avif)[^"]*)"',
      itemSelector: '.reading-content img.wp-manga-chapter-img',
      imageUrl: {
        attr: ['data-src', 'src'],
        replace: [
          { pattern: '\\\\/', replacement: '/' },
          { pattern: '&amp;', replacement: '&' },
        ],
        absoluteUrl: true,
      },
    },
  }),

  scantradunion: (meta) => ({
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    baseUrl: meta.baseUrl,
    ...(meta.nsfw ? { nsfw: true } : {}),
    popular: {
      request: { method: 'GET', url: '{{baseUrl}}/projets/' },
      itemSelector: '.index-top3-a',
      fields: {
        title: { selector: '.index-top3-title', replace: [{ pattern: '^\\[Partenaire\\]\\s*', replacement: '' }] },
        url: { attr: 'href', absoluteUrl: true },
        cover: {
          selector: '.index-top3-bg',
          attr: 'style',
          regex: "url\\(['\"]?([^'\")]+)['\"]?\\)",
          absoluteUrl: true,
        },
      },
    },
    latest: {
      request: { method: 'GET', url: '{{baseUrl}}' },
      itemSelector: '.dernieresmaj .colonne',
      fields: {
        title: { selector: 'a.text-truncate', replace: [{ pattern: '^\\[Partenaire\\]\\s*', replacement: '' }] },
        url: { selector: 'a.text-truncate', attr: 'href', absoluteUrl: true },
        cover: { selector: 'img.attachment-thumbnail', attr: ['data-src', 'src'], absoluteUrl: true },
      },
    },
    search: {
      request: {
        method: 'GET',
        url: '{{baseUrl}}/?s={{encodedQuery}}&asp_active=1&p_asid=1&p_asp_data=YXNwX2dlbiU1QiU1RD10aXRsZSZjdXN0b21zZXQlNUIlNUQ9bWFuZ2E=',
      },
      itemSelector: 'article.post-outer',
      fields: {
        title: { selector: 'a.index-post-header-a', replace: [{ pattern: '^\\[Partenaire\\]\\s*', replacement: '' }] },
        url: { selector: 'a.index-post-header-a', attr: 'href', absoluteUrl: true },
        cover: { selector: 'img.wp-post-image', attr: ['data-src', 'src'], absoluteUrl: true },
      },
    },
    mangaDetails: {
      request: { method: 'GET', url: '{{mangaUrl}}' },
      fields: {
        title: { selector: '.projet-description h2' },
        cover: { selector: '.projet-image img', attr: ['data-src', 'src'], absoluteUrl: true },
        description: { selector: '.sContent' },
        author: { selector: 'div.project-details a[href*=auteur]', joinAll: ', ' },
      },
    },
    chapters: {
      fallbackInline: true,
      itemSelector: '.links-projects li',
      fields: {
        title: { selector: ['.chapter-number', '.chapter-name'] },
        url: { selector: '.btnlel', attr: 'href', absoluteUrl: true },
      },
    },
    pages: {
      request: { method: 'GET', url: '{{chapterUrl}}' },
      itemSelector: '#webtoon a img',
      imageUrl: { attr: ['data-src', 'src'], absoluteUrl: true },
    },
  }),

  twatt: (meta) => ({
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    baseUrl: meta.baseUrl,
    ...(meta.nsfw ? { nsfw: true } : {}),
    popular: {
      request: { method: 'GET', url: '{{baseUrl}}/api/projects', responseType: 'json' },
      itemsPath: 'projects',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'id', prefix: '{{baseUrl}}/serie/' },
        cover: { jsonPath: 'coverImage', absoluteUrl: true },
      },
    },
    mangaDetails: {
      request: { method: 'GET', url: '{{baseUrl}}/api/series/{{mangaSlug}}', responseType: 'json' },
      fields: {
        title: { jsonPath: 'project.title' },
        cover: { jsonPath: 'project.coverImage', absoluteUrl: true },
        description: { jsonPath: 'project.description' },
        genres: { jsonPath: 'project.genre' },
        status: { jsonPath: 'project.status' },
      },
    },
    chapters: {
      request: { method: 'GET', url: '{{baseUrl}}/api/series/{{mangaSlug}}', responseType: 'json' },
      itemsPath: 'chapters',
      fields: {
        title: { jsonTemplate: 'Chapitre {{number}} - {{title}}' },
        url: { jsonPath: 'id', prefix: '{{baseUrl}}/chapitre/' },
        date: { jsonPath: 'releasedAt' },
        chapterNumber: { jsonPath: 'number' },
      },
    },
    pages: {
      request: { method: 'GET', url: '{{baseUrl}}/api/chapters/{{chapterSlug}}', responseType: 'json' },
      itemsPath: 'chapter.images',
      imageUrl: { jsonPath: '', absoluteUrl: true },
    },
  }),

  yureiscan: (meta) => ({
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    baseUrl: meta.baseUrl,
    ...(meta.nsfw ? { nsfw: true } : {}),
    popular: {
      request: { method: 'GET', url: '{{baseUrl}}/manga_list.php' },
      itemSelector: 'a.manga-card',
      fields: {
        title: { selector: 'h2' },
        url: { attr: 'href', absoluteUrl: true },
        cover: { selector: 'img', attr: ['data-src', 'src'], absoluteUrl: true },
      },
    },
    latest: {
      request: { method: 'GET', url: '{{baseUrl}}' },
      itemSelector: 'a.sortie-item',
      fields: {
        title: { selector: '.sortie-title' },
        url: { attr: 'href', absoluteUrl: true },
        cover: { selector: 'img', attr: ['data-src', 'src'], absoluteUrl: true },
      },
    },
    search: {
      request: { method: 'GET', url: '{{baseUrl}}/search.php?q={{encodedQuery}}&adult=1', responseType: 'json' },
      itemsPath: '',
      fields: {
        title: { jsonPath: 'title' },
        url: { jsonPath: 'id', prefix: '{{baseUrl}}/manga.php?id=' },
        cover: { jsonPath: 'cover_image', absoluteUrl: true },
      },
    },
    mangaDetails: {
      request: { method: 'GET', url: '{{mangaUrl}}' },
      fields: {
        title: { selector: 'h1.manga-title' },
        cover: { selector: 'img.manga-cover', attr: ['data-src', 'src'], absoluteUrl: true },
        description: { selector: '.synopsis-section p', joinAll: '\n' },
        genres: { selector: '.genres-list .genre-tag', joinAll: ', ' },
      },
    },
    chapters: {
      fallbackInline: true,
      itemSelector: 'a.chapter-card',
      fields: {
        title: { selector: '.chapter-number' },
        url: { attr: 'href', absoluteUrl: true },
        date: { selector: '.chapter-date' },
      },
    },
    pages: {
      request: { method: 'GET', url: '{{chapterUrl}}' },
      itemSelector: '#pagesContainer img.page-image',
      imageUrl: { attr: ['data-src', 'src'], absoluteUrl: true },
    },
  }),
};

function extractKotlinStringOverride(ktContent: string, propName: string): string | undefined {
  const reVal = new RegExp(`override\\s+(?:val|fun)\\s+${propName}(?:\\(\\))?\\s*=\\s*"([^"]+)"`);
  const m = reVal.exec(ktContent);
  return m?.[1]?.trim();
}

/**
 * Construit un RawSourceConfig étendant un des 7 thèmes multisrc supportés,
 * en extrayant les éventuelles surcharges CSS/URL présentes dans le Kotlin source.
 */
export function buildThemeSourceConfig(
  meta: KeiyoushiSourceMetadata,
  themeId: string,
  ktContent: string,
): RawSourceConfig {
  const vars: Record<string, string> = {};

  const mangaPath = extractKotlinStringOverride(ktContent, 'mangaPath');
  if (mangaPath) vars.mangaPath = mangaPath.replace(/^\/+|\/+$/g, '');

  const mangaSubString = extractKotlinStringOverride(ktContent, 'mangaSubString');
  if (mangaSubString) vars.mangaSubString = mangaSubString.replace(/^\/+|\/+$/g, '');

  const mangaUrlDir = extractKotlinStringOverride(ktContent, 'mangaUrlDirectory');
  if (mangaUrlDir) vars.mangaUrlDirectory = mangaUrlDir.replace(/^\/+|\/+$/g, '');

  const itemPath = extractKotlinStringOverride(ktContent, 'itemPath');
  if (itemPath) vars.itemPath = itemPath.replace(/^\/+|\/+$/g, '');

  const apiPath = extractKotlinStringOverride(ktContent, 'apiPath');
  if (apiPath) vars.apiPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;

  if (themeId === 'iken') {
    const customApiUrl = extractKotlinStringOverride(ktContent, 'apiUrl');
    vars.apiUrl = (
      customApiUrl ?? meta.baseUrl.replace(/^https?:\/\//i, 'https://api.')
    ).replace(/\/+$/, '');
  }

  const config: RawSourceConfig = {
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    extends: themeId,
    baseUrl: meta.baseUrl,
    ...(meta.iconUrl ? { iconUrl: meta.iconUrl } : {}),
    ...(meta.nsfw ? { nsfw: true } : {}),
    ...(Object.keys(vars).length > 0 ? { vars } : {}),
  };

  const baseTpl = BUILT_IN_KEIYOUSHI_TEMPLATES[themeId];
  if (!baseTpl) return config;

  // Surcharges Madara courantes (ex: archiveSelector, chapterMode = MangaNoAjax, status selector)
  if (themeId === 'madara') {
    const archiveSel = extractKotlinStringOverride(ktContent, 'archiveSelector');
    const searchSel = extractKotlinStringOverride(ktContent, 'searchCardSelector');
    const archiveUrlSel = extractKotlinStringOverride(ktContent, 'archiveUrlSelector');
    if (archiveSel && baseTpl.popular) {
      config.popular = {
        ...baseTpl.popular,
        itemSelector: archiveSel,
        ...(archiveUrlSel
          ? { fields: { ...baseTpl.popular.fields, url: { selector: archiveUrlSel, attr: 'href', absoluteUrl: true }, title: { selector: archiveUrlSel } } }
          : {}),
      };
      if (baseTpl.latest) {
        config.latest = {
          ...baseTpl.latest,
          itemSelector: archiveSel,
          ...(archiveUrlSel
            ? { fields: { ...baseTpl.latest.fields, url: { selector: archiveUrlSel, attr: 'href', absoluteUrl: true }, title: { selector: archiveUrlSel } } }
            : {}),
        };
      }
    }
    if (searchSel && baseTpl.search) {
      config.search = {
        ...baseTpl.search,
        itemSelector: searchSel,
        ...(archiveUrlSel
          ? { fields: { ...baseTpl.search.fields, url: { selector: archiveUrlSel, attr: 'href', absoluteUrl: true }, title: { selector: archiveUrlSel } } }
          : {}),
      };
    }

    const titleSel = extractKotlinStringOverride(ktContent, 'mangaDetailsSelectorTitle');
    const statusSel = extractKotlinStringOverride(ktContent, 'mangaDetailsSelectorStatus');
    const thumbSel = extractKotlinStringOverride(ktContent, 'mangaDetailsSelectorThumbnail');
    if (titleSel || statusSel || thumbSel) {
      config.mangaDetails = {
        fields: {
          title: titleSel ? { selector: titleSel } : baseTpl.mangaDetails!.fields!.title,
          ...(statusSel ? { status: { selector: statusSel } } : {}),
          ...(thumbSel ? { cover: { selector: thumbSel, attr: ['data-src', 'src'], absoluteUrl: true } } : {}),
        },
      };
    }

    if (/:\s*MadaraNoAjax\b|ChapterMode\.MangaPage/.test(ktContent)) {
      config.chapters = {
        request: undefined,
        fallbackInline: true,
      };
    }
  }

  // Surcharges MangaThemesia (ex: SushiScan, Lelmanga)
  if (themeId === 'mangathemesia') {
    const authorSel = extractKotlinStringOverride(ktContent, 'seriesAuthorSelector');
    const artistSel = extractKotlinStringOverride(ktContent, 'seriesArtistSelector');
    const statusSel = extractKotlinStringOverride(ktContent, 'seriesStatusSelector');
    if (authorSel || artistSel || statusSel) {
      config.mangaDetails = {
        fields: {
          title: baseTpl.mangaDetails!.fields!.title,
          ...(authorSel ? { author: { selector: authorSel } } : {}),
          ...(artistSel ? { artist: { selector: artistSel } } : {}),
          ...(statusSel ? { status: { selector: statusSel } } : {}),
        },
      };
    }
  }

  // Surcharges FuzzyDoodle (ex: latestFromHomePage = true)
  if (themeId === 'fuzzydoodle' && /latestFromHomePage\s*=\s*true/.test(ktContent)) {
    config.latest = {
      ...baseTpl.latest!,
      request: { method: 'GET', url: '{{baseUrl}}/?page={{page}}' },
      itemSelector:
        'section:has(h2:containsOwn(Chapitres récents)) div#card-real, section:has(h2:containsOwn(Recent Chapters)) div#card-real, div#card-real',
    };
  }

  return config;
}

/**
 * Compile statiquement une source Kotlin Keiyoushi personnalisée vers KumoYomi.
 * Signale honnêtement les sources incompatibles (Bitmap/Canvas, Turnstile, RSC Next.js).
 */
export function compileFrenchKotlinSource(
  meta: KeiyoushiSourceMetadata,
  ktContent: string,
): KotlinCompilerResult {
  const recipeFactory = FRENCH_CUSTOM_RECIPES[meta.slug];
  if (recipeFactory) {
    return {
      compatible: true,
      reason: 'supported_recipe',
      config: recipeFactory(meta, ktContent),
    };
  }

  if (/\b(?:Bitmap|Canvas|WebView|VrfSigner|LelCall)\b|descramble/i.test(ktContent)) {
    return { compatible: false, reason: 'incompatible_canvas' };
  }
  if (/turnstile|recaptcha/i.test(ktContent)) {
    return { compatible: false, reason: 'incompatible_turnstile' };
  }
  if (/extractNextJs/.test(ktContent)) {
    return { compatible: false, reason: 'incompatible_nextjs_rsc' };
  }

  // Compilateur générique de repli pour sources Kotlin HTML classiques (ParsedHttpSource / KeiSource)
  const popSel = extractKotlinStringOverride(ktContent, 'popularMangaSelector');
  const chSel = extractKotlinStringOverride(ktContent, 'chapterListSelector');
  const pageSel = extractKotlinStringOverride(ktContent, 'pageListParseSelector');

  if (popSel && chSel && pageSel) {
    return {
      compatible: true,
      reason: 'supported_kotlin_ast',
      config: {
        id: meta.id,
        name: meta.name,
        lang: meta.lang,
        baseUrl: meta.baseUrl,
        ...(meta.nsfw ? { nsfw: true } : {}),
        popular: {
          request: { method: 'GET', url: '{{baseUrl}}/?page={{page}}' },
          itemSelector: popSel,
          fields: {
            title: { selector: ['a[title]', 'h3', 'h2', 'a'] },
            url: { selector: 'a', attr: 'href', absoluteUrl: true },
            cover: { selector: 'img', attr: ['data-src', 'src'], absoluteUrl: true },
          },
        },
        mangaDetails: {
          request: { method: 'GET', url: '{{mangaUrl}}' },
          fields: {
            title: { selector: ['h1', 'h2'] },
            cover: { selector: ['meta[property="og:image"]', 'img'], attr: ['content', 'src'], absoluteUrl: true },
          },
        },
        chapters: {
          fallbackInline: true,
          itemSelector: chSel,
          fields: {
            title: { selector: ['a', 'self'] },
            url: { selector: 'a', attr: 'href', absoluteUrl: true },
          },
        },
        pages: {
          request: { method: 'GET', url: '{{chapterUrl}}' },
          itemSelector: `${pageSel} img`,
          imageUrl: { attr: ['data-src', 'src'], absoluteUrl: true },
        },
      },
    };
  }

  return { compatible: false, reason: 'incompatible_custom' };
}
