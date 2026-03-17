import Database from 'better-sqlite3'
import * as path from 'node:path'
import * as fsPromises from 'node:fs/promises'
import chokidar from 'chokidar'
import { shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-types'
import type { FileEntry, IndexStatus, SearchParams } from '../shared/ipc-types'
import { parseFilename } from './parseFilename'

// ── Module-level state (singleton) ──────────────────────────────────────────

let db: Database.Database | null = null
let mainWin: BrowserWindow | null = null
let rootGetter: () => string = () => ''
let watcherInstance: ReturnType<typeof chokidar.watch> | null = null
let watcherRetries = 0

const BATCH_SIZE = 500
const MAX_WATCHER_RETRIES = 5

// Prepared statements — set during init()
let stmtUpsertFile: Database.Statement
let stmtDeleteFile: Database.Statement
let stmtUpdateFile: Database.Statement
let stmtDeleteChildren: Database.Statement
let stmtSearch: Database.Statement
let stmtGetMeta: Database.Statement
let stmtSetMeta: Database.Statement
let stmtUpsertProject: Database.Statement
let stmtUpdateProjectCounts: Database.Statement

// ── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS files (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    path           TEXT    NOT NULL UNIQUE,
    name           TEXT    NOT NULL,
    ext            TEXT    NOT NULL,
    size_bytes     INTEGER NOT NULL,
    modified_ms    INTEGER NOT NULL,
    is_dir         INTEGER NOT NULL DEFAULT 0,
    indexed_at     INTEGER NOT NULL,
    project        TEXT,
    discipline     TEXT,
    doc_type       TEXT,
    drawing_number TEXT,
    revision       TEXT,
    issue_status   TEXT,
    file_date_ms   INTEGER,
    content_hash   TEXT,
    ai_summary     TEXT,
    ai_tags        TEXT,
    embedding_ref  TEXT,
    ai_processed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_files_name     ON files(name);
  CREATE INDEX IF NOT EXISTS idx_files_project  ON files(project);
  CREATE INDEX IF NOT EXISTS idx_files_ext      ON files(ext);
  CREATE INDEX IF NOT EXISTS idx_files_doc_type ON files(doc_type);

  CREATE TABLE IF NOT EXISTS projects (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_name      TEXT    NOT NULL UNIQUE,
    display_name     TEXT,
    client           TEXT,
    status           TEXT    NOT NULL DEFAULT 'unknown',
    file_count       INTEGER NOT NULL DEFAULT 0,
    last_modified_ms INTEGER,
    first_seen_ms    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS index_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMeta(key: string): string | null {
  const row = stmtGetMeta.get(key) as { value: string } | undefined
  return row?.value ?? null
}

function setMeta(key: string, value: string): void {
  stmtSetMeta.run(key, value)
}

function getPathSegments(
  fullPath: string,
  root: string,
  isDir: boolean,
): { project: string | null; discipline: string | null } {
  // For files: segments come from parent directory path relative to root
  // For dirs: segments come from the directory path itself relative to root
  const parentDir = isDir ? fullPath : path.dirname(fullPath)
  const relative = path.relative(root, parentDir)
  const segments = relative.split(path.sep).filter((s) => s !== '.' && Boolean(s))
  return {
    project: segments[0] ?? null,
    discipline: segments[1] ?? null,
  }
}

// ── Public service object ─────────────────────────────────────────────────────

export const fileIndexService = {
  /** Opens/creates the SQLite database and wires up the service. */
  init(dbPath: string, getRoot: () => string, win: BrowserWindow | null): void {
    rootGetter = getRoot
    mainWin = win

    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.exec(SCHEMA_SQL)

    // Prepare statements
    stmtGetMeta = db.prepare('SELECT value FROM index_meta WHERE key = ?')
    stmtSetMeta = db.prepare('INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?)')

    stmtUpsertFile = db.prepare(`
      INSERT OR REPLACE INTO files
        (path, name, ext, size_bytes, modified_ms, is_dir, indexed_at,
         project, discipline, doc_type, drawing_number, revision, issue_status, file_date_ms)
      VALUES
        (@path, @name, @ext, @sizeBytes, @modifiedMs, @isDir, @indexedAt,
         @project, @discipline, @docType, @drawingNumber, @revision, @issueStatus, @fileDateMs)
    `)

    stmtDeleteFile = db.prepare('DELETE FROM files WHERE path = ?')

    stmtUpdateFile = db.prepare(`
      UPDATE files SET size_bytes = @sizeBytes, modified_ms = @modifiedMs, indexed_at = @indexedAt
      WHERE path = @path
    `)

    stmtDeleteChildren = db.prepare('DELETE FROM files WHERE path LIKE ?')

    stmtSearch = db.prepare(`
      SELECT path, name, ext,
             size_bytes     AS sizeBytes,
             modified_ms    AS modifiedMs,
             is_dir         AS isDir,
             project, discipline,
             doc_type       AS docType,
             drawing_number AS drawingNumber,
             revision,
             issue_status   AS issueStatus
      FROM files
      WHERE (name LIKE @pattern OR path LIKE @pattern)
        AND (@project    IS NULL OR project    = @project)
        AND (@discipline IS NULL OR discipline = @discipline)
        AND (@docType    IS NULL OR doc_type   = @docType)
        AND (@ext        IS NULL OR ext        = @ext)
        AND is_dir = 0
      ORDER BY modified_ms DESC
      LIMIT @limit
    `)

    stmtUpsertProject = db.prepare(`
      INSERT OR IGNORE INTO projects (folder_name, first_seen_ms)
      VALUES (@folderName, @firstSeenMs)
    `)

    stmtUpdateProjectCounts = db.prepare(`
      UPDATE projects
      SET file_count       = (SELECT COUNT(*) FROM files WHERE project = @folderName AND is_dir = 0),
          last_modified_ms = (SELECT MAX(modified_ms) FROM files WHERE project = @folderName AND is_dir = 0)
      WHERE folder_name = @folderName
    `)

    const root = rootGetter()
    if (root) {
      this.crawlIfStale()
      this.startWatcher(root)
    }
  },

  /** Closes the database. Call in tests' afterEach to reset state. */
  close(): void {
    watcherInstance?.close()
    watcherInstance = null
    db?.close()
    db = null
  },

  /** Returns current index status. Never throws. */
  getStatus(): IndexStatus {
    if (!db) {
      return { status: 'not-configured', fileCount: 0, lastCrawledMs: null, rootPath: '', crawlError: null }
    }
    const root = rootGetter()
    if (!root) {
      return { status: 'not-configured', fileCount: 0, lastCrawledMs: null, rootPath: '', crawlError: null }
    }
    const crawlStatus = (getMeta('crawl_status') ?? 'idle') as IndexStatus['status']
    const lastCrawlMsStr = getMeta('last_crawl_ms')
    const fileCountStr = getMeta('file_count')
    const crawlError = getMeta('crawl_error')
    return {
      status: crawlStatus,
      fileCount: fileCountStr ? parseInt(fileCountStr, 10) : 0,
      lastCrawledMs: lastCrawlMsStr ? parseInt(lastCrawlMsStr, 10) : null,
      rootPath: root,
      crawlError: crawlError || null,  // normalize empty string to null
    }
  },

  /** Opens a file with the OS default application. Returns '' on success, error message on failure. */
  async openFile(filePath: string): Promise<string> {
    return shell.openPath(filePath)
  },

  // Stubs — implemented in Tasks 5 and 6
  crawlIfStale(): void { /* Task 5 */ },
  async startCrawl(): Promise<void> { /* Task 5 */ },
  reindex(): void { /* Task 5 */ },
  startWatcher(_root: string): void { /* Task 6 */ },
  search(_params: SearchParams): FileEntry[] { return [] /* Task 6 */ },
}
