// In-memory stand-ins for EmDash plugin storage and KV, with the query semantics booking uses
// (equality, `in`, ranges, orderBy, cursor pages, create-if-absent).

function matches(data, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    const value = data[key];
    if (cond === null || typeof cond !== 'object') return value === cond;
    if ('in' in cond) return cond.in.includes(value);
    if (value === undefined || value === null) return false;
    if ('gt' in cond && !(value > cond.gt)) return false;
    if ('gte' in cond && !(value >= cond.gte)) return false;
    if ('lt' in cond && !(value < cond.lt)) return false;
    if ('lte' in cond && !(value <= cond.lte)) return false;
    return true;
  });
}

export function collection() {
  const rows = new Map();
  let rev = 0;
  const clone = (v) => structuredClone(v);
  return {
    rows,
    async get(id) {
      return rows.has(id) ? clone(rows.get(id).data) : null;
    },
    async put(id, data) {
      rows.set(id, { data: clone(data), rev: String(++rev) });
    },
    async delete(id) {
      return rows.delete(id);
    },
    async deleteMany(ids) {
      let n = 0;
      for (const id of ids) if (rows.delete(id)) n++;
      return n;
    },
    async compareAndSet(id, expected, data) {
      const row = rows.get(id);
      if (expected === null ? row : !row || row.rev !== expected) return { applied: false };
      rows.set(id, { data: clone(data), rev: String(++rev) });
      return { applied: true, revision: String(rev) };
    },
    async query({ where, orderBy, limit = 50, cursor } = {}) {
      let items = [...rows.entries()]
        .filter(([, r]) => matches(r.data, where))
        .map(([id, r]) => ({ id, data: clone(r.data) }));
      if (orderBy) {
        const [[key, dir]] = Object.entries(orderBy);
        items.sort(
          (a, b) =>
            (a.data[key] < b.data[key] ? -1 : a.data[key] > b.data[key] ? 1 : 0) *
            (dir === 'desc' ? -1 : 1)
        );
      }
      const offset = cursor ? Number(cursor) : 0;
      const page = items.slice(offset, offset + limit);
      const hasMore = offset + limit < items.length;
      return { items: page, hasMore, cursor: hasMore ? String(offset + limit) : undefined };
    },
    async count(where) {
      return [...rows.values()].filter((r) => matches(r.data, where)).length;
    },
  };
}

export function kv() {
  const map = new Map();
  return {
    map,
    async get(key) {
      return map.has(key) ? structuredClone(map.get(key)) : null;
    },
    async set(key, value) {
      map.set(key, structuredClone(value));
    },
    async delete(key) {
      return map.delete(key);
    },
    async compareAndSet(key, expected, value) {
      if (expected === null && map.has(key)) return { applied: false };
      map.set(key, structuredClone(value));
      return { applied: true, revision: '1' };
    },
  };
}

/** Deps for core.ts with a settable clock, captured emails and logs. */
export function deps({ now, calendarText } = {}) {
  const sent = [];
  const logs = [];
  const clock = { now };
  const d = {
    storage: {
      services: collection(),
      bookings: collection(),
      locks: collection(),
      blocks: collection(),
    },
    kv: kv(),
    now: () => clock.now,
    async send(mail) {
      if (d.failSend) throw new Error('email down');
      sent.push(mail);
    },
    site: { name: 'Salong Test', url: 'https://salong.example' },
    platformNotify: ['agare@salong.example'],
    async fetchCalendar() {
      if (typeof d.calendarText === 'function') return d.calendarText();
      return d.calendarText;
    },
    calendarText,
    log: {
      info: (m, x) => logs.push(['info', m, x]),
      warn: (m, x) => logs.push(['warn', m, x]),
      error: (m, x) => logs.push(['error', m, x]),
    },
  };
  return { deps: d, sent, logs, clock };
}
