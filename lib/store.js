import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));');
  const list = kind => db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r => JSON.parse(r.body));
  const get = (kind, id) => { const row = db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, id); return row ? JSON.parse(row.body) : null; };
  const put = (kind, value) => { const record = { ...value, id: value.id || randomUUID() }; db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind, record.id, JSON.stringify(record)); return record; };
  const remove = (kind, id) => db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id).changes;
  if (!get('settings', 'main')) put('settings', { id: 'main', keywords: '', locations: '', exclude: '', name: '', resume: '', token: randomBytes(24).toString('hex') });
  return { db, list, get, put, remove };
}
