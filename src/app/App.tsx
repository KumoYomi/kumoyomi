import { AppShell } from '@/src/app/AppShell';
import { useHashRoute } from '@/src/app/router';
import { ExplorePage } from '@/src/features/explore/ExplorePage';
import { LibraryPage } from '@/src/features/library/LibraryPage';
import { MangaDetailPage } from '@/src/features/manga-detail/MangaDetailPage';
import { ReaderPage } from '@/src/features/reader/ReaderPage';
import { SettingsPage } from '@/src/features/settings/SettingsPage';
import { SourcesPage } from '@/src/features/sources/SourcesPage';
import { UpdatesPage } from '@/src/features/updates/UpdatesPage';

export function App() {
  const route = useHashRoute();

  return (
    <AppShell route={route}>
      {route.name === 'library' && <LibraryPage />}
      {route.name === 'updates' && <UpdatesPage />}
      {route.name === 'explore' && (
        <ExplorePage initialSourceId={route.sourceId} initialQuery={route.query} />
      )}
      {route.name === 'manga' && <MangaDetailPage mangaId={route.mangaId} />}
      {route.name === 'reader' && (
        <ReaderPage mangaId={route.mangaId} chapterId={route.chapterId} />
      )}
      {route.name === 'sources' && <SourcesPage />}
      {route.name === 'settings' && <SettingsPage />}
    </AppShell>
  );
}
