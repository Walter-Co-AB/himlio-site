import { getCollection, getEntry } from 'astro:content';

/** The page with this id is the home page (/). */
export const HOME_ID = 'start';

export async function getSettings() {
  const entry = await getEntry('settings', 'site');
  if (!entry) throw new Error('src/content/settings/site.json is missing');
  return entry.data;
}

/** Published pages. Drafts are shown in `npm run dev` only. */
export async function getPages() {
  return getCollection('pages', ({ data }) => import.meta.env.DEV || !data.draft);
}

export function pageHref(id: string) {
  return id === HOME_ID ? '/' : `/${id}/`;
}

export async function getMenu() {
  const pages = await getPages();
  return pages
    .filter((p) => p.data.menu !== undefined)
    .sort((a, b) => a.data.menu! - b.data.menu!)
    .map((p) => ({ label: p.data.title, href: pageHref(p.id) }));
}
