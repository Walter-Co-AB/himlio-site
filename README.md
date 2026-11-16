# himlio-site

The Himlio platform for customer websites, by Walter & Co AB.

| Path                                                         | What                                                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/site`](packages/site)                             | **`@himlio/site`** on npm: the Astro config, Worker runtime, content model, D1 migrations and build tooling every Himlio site uses. MIT. |
| [`starter`](starter)                                         | The default design. New customer repos (`Walter-Co-AB/site-<slug>`) are created from it once; after that the design is the site's own.   |
| [`.github/workflows/build.yml`](.github/workflows/build.yml) | Reusable workflow every site's CI calls: checks, the `himlio-build` artifact on `main`, screenshots on pull requests.                    |

```sh
npm install
npm run verify                      # build and test the package, check and build the starter
npm run dev -w himlio-starter       # the starter on http://localhost:4321
```

Releasing: bump `packages/site/package.json`, merge, tag `vX.Y.Z`. The publish workflow puts it
on npm with provenance, and sites get a version-bump PR.
