import { defineLiveCollection } from 'astro:content';
import { emdashLoader } from '@himlio/site/emdash/runtime';

export const collections = {
  _emdash: defineLiveCollection({ loader: emdashLoader() }),
};
