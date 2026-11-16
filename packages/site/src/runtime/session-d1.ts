// Astro session driver backed by the site's D1 database (binding DB).
//
// EmDash keeps the signed-in user in the Astro session. The Cloudflare adapter's default store
// is Workers KV, which Himlio doesn't provide and which can't be kept in the EU; D1 can.
// The table is created by migrations/0001_himlio_sessions.sql.
import { env } from 'cloudflare:workers';

/** Sessions live this long after their last write. Also set as `session.ttl` in Astro. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const db = () => (env as unknown as { DB: D1Database }).DB;

export default function d1SessionDriver() {
  return {
    name: 'himlio-d1',
    async hasItem(key: string) {
      const row = await db()
        .prepare('SELECT 1 FROM himlio_sessions WHERE id = ?')
        .bind(key)
        .first();
      return row !== null;
    },
    async getItem(key: string) {
      const row = await db()
        .prepare('SELECT data FROM himlio_sessions WHERE id = ? AND updated_at > ?')
        .bind(key, Date.now() - SESSION_TTL_SECONDS * 1000)
        .first<{ data: string }>();
      return row?.data ?? null;
    },
    async setItem(key: string, value: string) {
      await db()
        .prepare(
          'INSERT INTO himlio_sessions (id, data, updated_at) VALUES (?, ?, ?) ' +
            'ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
        )
        .bind(key, value, Date.now())
        .run();
    },
    async removeItem(key: string) {
      await db().prepare('DELETE FROM himlio_sessions WHERE id = ?').bind(key).run();
    },
    // Sessions are never listed or cleared in bulk.
    async getKeys() {
      return [];
    },
  };
}

/** Deletes sessions older than the TTL. Run from the scheduled handler. */
export async function deleteExpiredSessions(database: D1Database) {
  await database
    .prepare('DELETE FROM himlio_sessions WHERE updated_at <= ?')
    .bind(Date.now() - SESSION_TTL_SECONDS * 1000)
    .run();
}
