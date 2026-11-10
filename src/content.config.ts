import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { pageSchema, settingsSchema } from './schemas';

const pages = defineCollection({
  loader: glob({ pattern: '*/index.md', base: './src/content/pages' }),
  schema: ({ image }) => pageSchema(image),
});

const settings = defineCollection({
  // One entry, id "site"
  loader: file('./src/content/settings/site.json', {
    parser: (text) => ({ site: JSON.parse(text) }),
  }),
  schema: settingsSchema,
});

export const collections = { pages, settings };
