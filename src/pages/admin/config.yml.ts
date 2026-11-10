// Serves /admin/config.yml for Sveltia CMS: the backend part comes from
// site.config.json, the collections from cms/config.yml.
//
// On a preview branch the CMS commits to that branch, so editors can try
// changes on the preview before they reach production.
import type { APIRoute } from 'astro';
import collections from '../../../cms/config.yml?raw';
import config from '../../../site.config.json';
import { buildBranch, productionUrl, siteUrl } from '../../lib/site-url.mjs';

const q = (value: string) => JSON.stringify(value);

const generated = `# Generated from site.config.json at build time. Edit cms/config.yml instead.
backend:
  name: github
  repo: ${q(config.repo)}
  branch: ${q(buildBranch)}
  base_url: ${q(config.cmsAuthUrl)}

site_url: ${q(siteUrl)}
display_url: ${q(productionUrl)}

`;

export const GET: APIRoute = () =>
  new Response(generated + collections, {
    headers: { 'Content-Type': 'text/yaml; charset=utf-8' },
  });
