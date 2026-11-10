// Content schemas. These must match the CMS fields in cms/config.yml exactly:
// same field names, and a field is optional here only if it has `required: false` there.
// `npm run check:cms` (part of CI) compares the two.
//
// Kept separate from src/content.config.ts, without astro:content imports, so the
// check script can load it with plain Node.
import { z } from 'astro/zod';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1a2b3c');

// Site-wide settings: src/content/settings/site.json
export const settingsSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  email: z.email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  orgNumber: z.string().optional(),
  colors: z.object({
    primary: hexColor,
    background: hexColor,
    text: hexColor,
  }),
});

// Pages: src/content/pages/<slug>/index.md, images in the same folder.
// `image` is Astro's image() helper; the check script passes a stand-in.
export const pageSchema = <T extends z.ZodType>(image: () => T) =>
  z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    menu: z.number().int().optional(),
    image: image().optional(),
    imageAlt: z.string().optional(),
    draft: z.boolean().default(false),
  });
