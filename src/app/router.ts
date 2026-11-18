import { useEffect, useState } from 'react';

export type AppRoute =
  | { name: 'library' }
  | { name: 'updates' }
  | { name: 'explore'; sourceId?: string; query?: string }
  | { name: 'manga'; mangaId: string }
  | { name: 'reader'; mangaId: string; chapterId: string }
  | { name: 'sources'; repoUrl?: string }
  | { name: 'settings' };

export function parseHashRoute(hash: string): AppRoute {
  const cleaned = hash.replace(/^#\/?/, '');
  const [rawPath = '', rawQuery = ''] = cleaned.split('?');
  const segments = rawPath.split('/').filter(Boolean).map(decodeURIComponent);
  const searchParams = new URLSearchParams(rawQuery);

  const head = segments[0] ?? 'library';
  switch (head) {
    case 'updates':
      return { name: 'updates' };
    case 'explore':
      return {
        name: 'explore',
        sourceId: searchParams.get('source') ?? undefined,
        query: searchParams.get('q') ?? undefined,
      };
    case 'manga':
      if (segments[1]) {
        return { name: 'manga', mangaId: segments[1] };
      }
      return { name: 'library' };
    case 'reader':
      if (segments[1] && segments[2]) {
        return { name: 'reader', mangaId: segments[1], chapterId: segments[2] };
      }
      return { name: 'library' };
    case 'sources':
      return {
        name: 'sources',
        repoUrl:
          searchParams.get('add-repo') ?? searchParams.get('repo') ?? undefined,
      };
    case 'settings':
      return { name: 'settings' };
    case 'library':
    default:
      return { name: 'library' };
  }
}

export function buildHashUrl(route: AppRoute): string {
  switch (route.name) {
    case 'library':
      return '#/library';
    case 'updates':
      return '#/updates';
    case 'explore': {
      const params = new URLSearchParams();
      if (route.sourceId) params.set('source', route.sourceId);
      if (route.query) params.set('q', route.query);
      const qs = params.toString();
      return qs ? `#/explore?${qs}` : '#/explore';
    }
    case 'manga':
      return `#/manga/${encodeURIComponent(route.mangaId)}`;
    case 'reader':
      return `#/reader/${encodeURIComponent(route.mangaId)}/${encodeURIComponent(route.chapterId)}`;
    case 'sources': {
      if (route.repoUrl) {
        const params = new URLSearchParams();
        params.set('add-repo', route.repoUrl);
        return `#/sources?${params.toString()}`;
      }
      return '#/sources';
    }
    case 'settings':
      return '#/settings';
  }
}

export function navigate(route: AppRoute): void {
  const target = buildHashUrl(route);
  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}

export function useHashRoute(): AppRoute {
  const [route, setRoute] = useState<AppRoute>(() => {
    if (!window.location.hash) {
      window.location.hash = '#/library';
    }
    return parseHashRoute(window.location.hash);
  });

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHashRoute(window.location.hash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}
