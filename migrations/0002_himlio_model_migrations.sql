-- Content-model migrations applied by src/lib/model-migrations.ts (seed/migrations/*.json).
CREATE TABLE himlio_model_migrations (
  name TEXT PRIMARY KEY NOT NULL,
  applied_at INTEGER NOT NULL
);
