/** App-relative links stay valid on both the published site and its preview. */
export function downloadLinkPath(id: string): string {
  return `/downloads?download=${encodeURIComponent(id)}`;
}

export function appendDownloadLink(draft: string, download: { id: string; title: string }): string {
  const path = downloadLinkPath(download.id);
  const title = download.title.replace(/\s+/g, " ").trim();
  const link = `Download: ${title}\n${path}`;
  return draft.trim() ? `${draft.trimEnd()}\n\n${link}` : link;
}
