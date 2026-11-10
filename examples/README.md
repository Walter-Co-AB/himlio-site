# Examples

Not deployed. Copy what you need:

- `functions/` → `functions/` at the repo root to add Pages Functions (server code).
  Every file there becomes a public route, so only copy routes you actually use.
- `migrations/` → `migrations/` at the repo root for a D1 database (bound as `env.DB`).

Bindings (D1, KV, the shared API) and secrets are set up by Walter & Co in Cloudflare,
not in this repo. Ask before adding one. See AGENTS.md.
