import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { seeds } from './seed.js';
import { createPortalStore } from './portal-store.js';

export function splitText(text, size = 1500, overlap = 180) {
  const clean = text.replace(/\r\n/g, '\n').trim();
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const boundary = Math.max(clean.lastIndexOf('\n', end), clean.lastIndexOf('. ', end));
      if (boundary > start + size / 2) end = boundary + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end === clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

export function createStore(filename = 'data/corpus.sqlite', seed = true) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL,
      publisher TEXT NOT NULL DEFAULT '', sourceUrl TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('candidate','unverified','verified','demo','withdrawn')),
      year TEXT, region TEXT, unit TEXT, filename TEXT,
      retrievedAt TEXT NOT NULL, reviewedAt TEXT, reviewer TEXT,
      hash TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY, documentId TEXT NOT NULL REFERENCES documents(id),
      position INTEGER NOT NULL, text TEXT NOT NULL, vector TEXT, embeddingModel TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(id UNINDEXED, documentId UNINDEXED, title, text, tokenize='unicode61');
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY, documentId TEXT NOT NULL REFERENCES documents(id),
      indicator TEXT NOT NULL, year TEXT NOT NULL, region TEXT NOT NULL,
      valueRaw TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL, rowNumber INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rag_runs (
      id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, provider TEXT NOT NULL,
      model TEXT NOT NULL, status TEXT NOT NULL, errorCode TEXT,
      inputTokens INTEGER NOT NULL DEFAULT 0, outputTokens INTEGER NOT NULL DEFAULT 0,
      elapsedMs INTEGER NOT NULL DEFAULT 0
    );
  `);
  const columns=new Set(db.prepare('PRAGMA table_info(documents)').all().map(column=>column.name));
  for(const column of ['sourceUpdatedAt','provenance'])if(!columns.has(column))db.exec(`ALTER TABLE documents ADD COLUMN ${column} TEXT`);

  const store = {
    db,
    portal:createPortalStore(db),
    list() { return db.prepare('SELECT * FROM documents ORDER BY retrievedAt DESC, title').all(); },
    get(id) { return db.prepare('SELECT * FROM documents WHERE id=?').get(id); },
    chunks(id) { return db.prepare('SELECT * FROM chunks WHERE documentId=? ORDER BY position').all(id); },
    activeChunks(scope) {
      const status = scope === 'demo' ? 'demo' : 'verified';
      return db.prepare('SELECT c.*,d.title,d.kind,d.sourceUrl,d.publisher,d.status,d.year,d.region,d.retrievedAt,d.reviewedAt,d.version FROM chunks c JOIN documents d ON d.id=c.documentId WHERE d.status=?').all(status);
    },
    add(input, observations = []) {
      const document = {
        id: randomUUID(), title: '', kind: 'text', publisher: '', sourceUrl: '', description: '', content: '',
        status: 'unverified', year: null, region: null, unit: null, filename: null,
        retrievedAt: new Date().toISOString(), reviewedAt: null, reviewer: null, version: 1,
        sourceUpdatedAt:null,provenance:null,
        ...input,
      };
      document.hash = createHash('sha256').update(document.content).digest('hex');
      const existing = db.prepare("SELECT * FROM documents WHERE hash=? AND sourceUrl=? AND status!='withdrawn' AND content!=''").get(document.hash, document.sourceUrl);
      if (existing) return { document: existing, duplicate: true };
      db.exec('BEGIN');
      try {
        const keys = ['id','title','kind','publisher','sourceUrl','description','content','status','year','region','unit','filename','retrievedAt','reviewedAt','reviewer','hash','version','sourceUpdatedAt','provenance'];
        db.prepare(`INSERT INTO documents (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => document[key]));
        const chunks = splitText(document.content);
        // Empty catalog records are searchable for discovery, never eligible for grounded answers.
        if (!chunks.length && document.description) chunks.push(document.description);
        chunks.forEach((text, position) => {
          const id = `${document.id}:${position + 1}`;
          db.prepare('INSERT INTO chunks(id,documentId,position,text) VALUES (?,?,?,?)').run(id, document.id, position, text);
          db.prepare('INSERT INTO chunks_fts(id,documentId,title,text) VALUES (?,?,?,?)').run(id, document.id, document.title, text);
        });
        const insertRow = db.prepare('INSERT INTO observations(documentId,indicator,year,region,valueRaw,value,unit,rowNumber) VALUES (?,?,?,?,?,?,?,?)');
        for (const row of observations) insertRow.run(document.id, row.indicator, row.year, row.region, row.valueRaw, row.value, row.unit, row.rowNumber);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { document, duplicate: false };
    },
    verify(id, reviewer) {
      db.prepare("UPDATE documents SET status='verified',reviewer=?,reviewedAt=? WHERE id=? AND status='unverified' AND content!=''").run(reviewer, new Date().toISOString(), id);
      return store.get(id);
    },
    withdraw(id) {
      db.prepare("UPDATE documents SET status='withdrawn' WHERE id=? AND status IN ('verified','unverified')").run(id);
      return store.get(id);
    },
    observations() {
      return db.prepare("SELECT o.*,d.title,d.sourceUrl,d.publisher,d.version,d.retrievedAt FROM observations o JOIN documents d ON d.id=o.documentId WHERE d.status='verified'").all();
    },
    setVector(id, vector, model) { db.prepare('UPDATE chunks SET vector=?,embeddingModel=? WHERE id=?').run(JSON.stringify(vector), model, id); },
    logRun(run) {
      db.prepare('INSERT INTO rag_runs(id,createdAt,provider,model,status,errorCode,inputTokens,outputTokens,elapsedMs) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),new Date().toISOString(),run.provider || 'unknown',run.model || '',run.status,run.errorCode || null,run.inputTokens || 0,run.outputTokens || 0,run.elapsedMs || 0);
      db.exec('DELETE FROM rag_runs WHERE id NOT IN (SELECT id FROM rag_runs ORDER BY createdAt DESC LIMIT 100)');
    },
    recentRuns() { return db.prepare('SELECT * FROM rag_runs ORDER BY createdAt DESC LIMIT 10').all(); },
    close() { db.close(); },
  };
  if (seed) for (const item of seeds) if (!store.get(item.id)) store.add(item);
  return store;
}
