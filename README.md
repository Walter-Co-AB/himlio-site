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

Releasing: bump `packages/site/package.json` (semver; the extension-point table in its README is
the public API), merge, then ask Anton or the infrastructure side to push the tag `vX.Y.Z`: only
org admins may create `v*` tags. The tag runs `publish.yml`, which puts the version on npm with
provenance (npm Trusted Publishing, environment `npm`), and sites get a version-bump PR. The tag
also pins the reusable workflow sites call (`build.yml@vX.Y.Z`).

## Licence

MIT ([LICENSE](LICENSE)), for the package, the starter and the workflows. It covers the code, not
the Himlio name or logo.
