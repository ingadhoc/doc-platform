/**
 * Whether a `docSidebar` navbar item has a page to link to, without React, so
 * it can be tested with `node --test`.
 *
 * Same lookup as Docusaurus' `useLayoutDocsSidebar`: the first candidate
 * version (active, preferred, latest) that declares the sidebar decides.
 * Only an EMPTY sidebar returns false: theme-classic throws on it, and since
 * the navbar renders on every page, one empty section takes down the build of
 * its whole version. A sidebar no version declares is a config error, so it
 * returns true and Docusaurus keeps throwing with its own message.
 */
export function sidebarConDestino(versiones = [], sidebarId) {
  for (const version of versiones) {
    const sidebar = version?.sidebars?.[sidebarId];
    if (sidebar) return Boolean(sidebar.link);
  }
  return true;
}
