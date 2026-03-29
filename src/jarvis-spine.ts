import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function stableId(prefix: string, input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return `${prefix}_${hash.toString(16)}`;
}

function getDbPath(): string {
  const custom = process.env.JARVIS_SPINE_DB_PATH?.trim();
  if (custom) return custom;
  return path.resolve(process.cwd(), '..', 'store', 'jarvis_spine.db');
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS jarvis_events (
      event_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_key TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      entity_refs TEXT NOT NULL,
      payload TEXT NOT NULL,
      privacy_class TEXT NOT NULL DEFAULT 'private',
      confidence REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS jarvis_entities (
      entity_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      name TEXT NOT NULL,
      aliases TEXT NOT NULL,
      metadata TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

export interface JarvisEventRecord {
  event_id?: string;
  source: string;
  source_key?: string;
  event_type: string;
  occurred_at: string;
  entity_refs?: string[];
  payload?: Record<string, unknown>;
  privacy_class?: string;
  confidence?: number;
}

export function upsertJarvisEvent(event: JarvisEventRecord): string {
  const database = getDb();
  const sourceKey =
    event.source_key ||
    stableId(
      'event_key',
      `${event.source}|${event.event_type}|${event.occurred_at}|${json(
        event.payload,
      )}`,
    );
  const eventId = event.event_id || stableId('evt', sourceKey);
  database
    .prepare(
      `INSERT INTO jarvis_events (
        event_id, source, source_key, event_type, occurred_at,
        entity_refs, payload, privacy_class, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        source = excluded.source,
        source_key = excluded.source_key,
        event_type = excluded.event_type,
        occurred_at = excluded.occurred_at,
        entity_refs = excluded.entity_refs,
        payload = excluded.payload,
        privacy_class = excluded.privacy_class,
        confidence = excluded.confidence`,
    )
    .run(
      eventId,
      event.source,
      sourceKey,
      event.event_type,
      event.occurred_at,
      json(event.entity_refs || []),
      json(event.payload || {}),
      event.privacy_class || 'private',
      event.confidence ?? 0.5,
    );
  return eventId;
}

export function upsertJarvisEntity(entity: {
  entity_id: string;
  entity_type: string;
  name: string;
  aliases?: string[];
  metadata?: Record<string, unknown>;
  updated_at: string;
}): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO jarvis_entities (entity_id, entity_type, name, aliases, metadata, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id) DO UPDATE SET
         entity_type = excluded.entity_type,
         name = excluded.name,
         aliases = excluded.aliases,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
    )
    .run(
      entity.entity_id,
      entity.entity_type,
      entity.name,
      json(entity.aliases || []),
      json(entity.metadata || {}),
      entity.updated_at,
    );
}

export function listJarvisEvents(): Array<{ event_id: string; event_type: string }> {
  const database = getDb();
  return database
    .prepare(`SELECT event_id, event_type FROM jarvis_events ORDER BY occurred_at DESC`)
    .all() as Array<{ event_id: string; event_type: string }>;
}

export function _resetJarvisSpineForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
}
