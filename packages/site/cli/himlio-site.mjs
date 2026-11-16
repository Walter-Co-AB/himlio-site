#!/usr/bin/env node
// The `himlio-site` command, part of @himlio/site. Run it in a site's root directory.
//
//   himlio-site dev [astro dev options]   apply D1 migrations locally, then `astro dev`
//   himlio-site build                     `astro build`, then the himlio-build artifact
//   himlio-site artifact                  only the artifact (after `astro build`)
//   himlio-site fixtures [--empty]        sample content on the local dev server
//   himlio-site screenshots [--out dir] [/path ...]
//   himlio-site install-browsers          Chromium for screenshots (the Playwright this package uses)
//   himlio-site port                      print this site's dev port
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const command = process.argv[2];
const rest = process.argv.slice(3);
const require = createRequire(join(process.cwd(), 'package.json'));
const run = (bin, args) => execFileSync(process.execPath, [bin, ...args], { stdio: 'inherit' });
// A package's command, found through its package.json (their exports hide the bin files).
const binOf = (req, name) => {
  const pkgPath = req.resolve(`${name}/package.json`);
  const { bin } = req(pkgPath);
  return join(dirname(pkgPath), typeof bin === 'string' ? bin : bin[name]);
};
const astro = () => binOf(require, 'astro'); // the site's own Astro
const wrangler = () => binOf(createRequire(import.meta.url), 'wrangler');

// himlio() writes .himlio/ when the site's astro.config.mjs is loaded. Commands that run
// Wrangler before Astro load the config first, so .himlio/ matches the site's options.
async function generate() {
  await import(pathToFileURL(join(process.cwd(), 'astro.config.mjs')).href);
  return join(process.cwd(), '.himlio', 'wrangler.json');
}

try {
  switch (command) {
    case 'dev': {
      const config = await generate();
      run(wrangler(), [
        'd1',
        'migrations',
        'apply',
        'DB',
        '--local',
        '-c',
        config,
        '--persist-to',
        '.wrangler/state',
      ]);
      run(astro(), ['dev', ...rest]);
      break;
    }
    case 'build':
      run(astro(), ['build', ...rest]);
      await import('./artifact.mjs');
      break;
    case 'artifact':
      await import('./artifact.mjs');
      break;
    case 'fixtures':
      await import('./fixtures.mjs');
      break;
    case 'screenshots':
      await import('./screenshots.mjs');
      break;
    case 'install-browsers':
      run(binOf(createRequire(import.meta.url), 'playwright'), [
        'install',
        ...(rest.length ? rest : ['--with-deps', 'chromium']),
      ]);
      break;
    case 'port': {
      const { devPort, readHimlio } = await import('../dist/config.js');
      console.log(devPort(readHimlio(process.cwd()).slug));
      break;
    }
    default:
      console.error(
        'usage: himlio-site dev | build | artifact | fixtures [--empty] | screenshots | install-browsers | port'
      );
      process.exit(command ? 1 : 0);
  }
} catch (error) {
  if (error?.status !== undefined) process.exit(error.status || 1); // a child command failed
  throw error;
}
