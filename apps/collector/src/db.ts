// apps/collector/src/db.ts
// The storage seam (docs/DESIGN.md §8, §19.5), with a SQLite default.
//
// SQLite so contributors clone-and-run with zero setup — a real OSS adoption win at this
// scale. Swapping to Postgres or ClickHouse later means writing another `EventStore`, and
// touching neither ingest nor analysis.
import Database from 'better-sqlite3';
import type { EventStore, UxEvent } from 'rastro-core';

/**
 * The full OTel record is stored as JSON in one column; the rest are indexes over it.
 *
 * That means adding an attribute to the convention needs no migration — the record round-
 * trips verbatim, and §19.2 stays the single source of truth for its shape. It is also why
 * this is honest as a walking skeleton and wrong at scale: you cannot query inside `record`
 * efficiently, which is exactly the pressure that pushes you to ClickHouse (§8).
 *
 * `event_id` is the PRIMARY KEY, so `INSERT OR IGNORE` makes ingest idempotent — a retried
 * batch reuses `ux.event_id` and the duplicates collapse (§4.4). Duplicate events corrupt
 * every count and rate, so this is load-bearing, not tidiness.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    event_id                TEXT PRIMARY KEY,
    app                     TEXT NOT NULL,
    session_id              TEXT NOT NULL,
    seq                     INTEGER NOT NULL,
    event_name              TEXT NOT NULL,
    observed_time_unix_nano TEXT NOT NULL,
    record                  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_by_session ON events (app, session_id, seq);
  CREATE INDEX IF NOT EXISTS events_by_app ON events (app);
`;

export interface SqliteEventStoreOptions {
  /** File path, or `:memory:` for an ephemeral store (tests, demos). */
  filename: string;
}

export function createSqliteEventStore({ filename }: SqliteEventStoreOptions): EventStore {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const insertOne = db.prepare<[string, string, string, number, string, string, string]>(
    `INSERT OR IGNORE INTO events
       (event_id, app, session_id, seq, event_name, observed_time_unix_nano, record)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertMany = db.transaction((events: UxEvent[]) => {
    for (const event of events) {
      insertOne.run(
        event.attributes['ux.event_id'],
        event.resource['service.name'],
        event.attributes['session.id'],
        event.attributes['ux.seq'],
        event.eventName,
        event.observedTimeUnixNano ?? event.timeUnixNano,
        JSON.stringify(event),
      );
    }
  });

  // rowid ascends with arrival, so `rowid DESC` is newest-first without parsing a 19-digit
  // nanosecond string that would lose precision as a JS number.
  const selectByApp = db.prepare<[string, number], { record: string }>(
    `SELECT record FROM events WHERE app = ? ORDER BY rowid DESC LIMIT ?`,
  );

  const selectBySession = db.prepare<[string, string], { record: string }>(
    `SELECT record FROM events WHERE app = ? AND session_id = ? ORDER BY seq ASC`,
  );

  const parse = (rows: { record: string }[]): UxEvent[] =>
    rows.map((row) => JSON.parse(row.record) as UxEvent);

  return {
    insert(events: UxEvent[]): void {
      if (events.length === 0) return;
      insertMany(events);
    },

    listByApp(app: string, limit = 200): UxEvent[] {
      return parse(selectByApp.all(app, limit));
    },

    listBySession(app: string, sessionId: string): UxEvent[] {
      return parse(selectBySession.all(app, sessionId));
    },

    close(): void {
      db.close();
    },
  };
}

/**
 * An in-memory `EventStore` with no SQLite at all — the trivial fake §19.5 promises. Kept
 * here next to the real one so the two are read side by side and drift is obvious.
 */
export function createMemoryEventStore(): EventStore {
  const byId = new Map<string, UxEvent>();

  return {
    insert(events: UxEvent[]): void {
      for (const event of events) {
        const id = event.attributes['ux.event_id'];
        if (!byId.has(id)) byId.set(id, event); // idempotent on ux.event_id, as above
      }
    },
    listByApp(app: string, limit = 200): UxEvent[] {
      return [...byId.values()]
        .filter((event) => event.resource['service.name'] === app)
        .reverse()
        .slice(0, limit);
    },
    listBySession(app: string, sessionId: string): UxEvent[] {
      return [...byId.values()]
        .filter(
          (event) =>
            event.resource['service.name'] === app &&
            event.attributes['session.id'] === sessionId,
        )
        .sort((a, b) => a.attributes['ux.seq'] - b.attributes['ux.seq']);
    },
    close(): void {
      byId.clear();
    },
  };
}
