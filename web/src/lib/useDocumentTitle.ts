import { useEffect } from 'react';

// Titles stay generic: browser history, tab sync and bookmarks should never
// contain clinical details.
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · OG-LOG`;
  }, [title]);
}
