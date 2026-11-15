-- Astro sessions (EmDash keeps the signed-in user here). See src/lib/session-d1.ts.
CREATE TABLE himlio_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX himlio_sessions_updated_at ON himlio_sessions (updated_at);
