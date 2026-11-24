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

Releasing: in the pull request, bump `packages/site/package.json` (semver; the extension-point
table in its README is the public API), add the `CHANGELOG.md` entry and set the starter's
version and `build.yml@vX.Y.Z` to match. Merging to `main` runs `publish.yml`: a version not on
npm yet goes to npm with provenance (npm Trusted Publishing, environment `npm`) and is tagged
`vX.Y.Z` on that commit, and sites get a version-bump PR. The tag also pins the reusable workflow
sites call (`build.yml@vX.Y.Z`). Nobody pushes tags by hand.

## Licence

MIT ([LICENSE](LICENSE)), for the package, the starter and the workflows. It covers the code, not
the Himlio name or logo.
