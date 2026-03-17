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

  crawlIfStale(): void {
    const lastCrawlMs = getMeta('last_crawl_ms')
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
    if (!lastCrawlMs || Date.now() - parseInt(lastCrawlMs, 10) > TWENTY_FOUR_HOURS) {
      this.startCrawl().catch((err) => {
        console.error('fileIndexService: crawl failed', err)
      })
    }
  },

  async startCrawl(): Promise<void> {
    if (!db) return
    const root = rootGetter()
    if (!root) return

    const crawlStartMs = Date.now()
    setMeta('crawl_status', 'crawling')
    setMeta('root_path', root)

    const batchInsert = db.transaction((rows: Record<string, unknown>[]) => {
      for (const row of rows) {
        stmtUpsertFile.run(row)
      }
    })

    let filesProcessed = 0
    const batch: Record<string, unknown>[] = []

    const flushBatch = () => {
      if (batch.length === 0) return
      batchInsert([...batch])
      filesProcessed += batch.length
      batch.length = 0
      mainWin?.webContents.send(IPC_CHANNELS.FILE_INDEX_PROGRESS, filesProcessed)
    }

    async function walk(dir: string, isRoot = false): Promise<void> {
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fsPromises.readdir(dir, { withFileTypes: true }) as import('node:fs').Dirent[]
      } catch (err) {
        if (isRoot) throw err // propagate root errors to the outer try/catch
        return // skip unreadable subdirectories
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        const isDir = entry.isDirectory()
        const { project, discipline } = getPathSegments(fullPath, root, isDir)

        if (isDir) {
          batch.push({
            path: fullPath,
            name: entry.name,
            ext: '',
            sizeBytes: 0,
            modifiedMs: Date.now(),
            isDir: 1,
            indexedAt: crawlStartMs,
            project,
            discipline,
            docType: null,
            drawingNumber: null,
            revision: null,
            issueStatus: null,
            fileDateMs: null,
          })
          await walk(fullPath)
        } else {
          let stat: Awaited<ReturnType<typeof fsPromises.stat>>
          try {
            stat = await fsPromises.stat(fullPath)
          } catch {
            continue
          }
          const lastDot = entry.name.lastIndexOf('.')
          const ext = lastDot >= 0 ? entry.name.slice(lastDot + 1).toLowerCase() : ''
          const parsed = parseFilename(entry.name)

          batch.push({
            path: fullPath,
            name: entry.name,
            ext,
            sizeBytes: stat.size,
            modifiedMs: Math.round(stat.mtimeMs),
            isDir: 0,
            indexedAt: crawlStartMs,
            project,
            discipline,
            docType: parsed.docType,
            drawingNumber: parsed.drawingNumber,
            revision: parsed.revision,
            issueStatus: parsed.issueStatus,
            fileDateMs: parsed.fileDateMs,
          })
        }

        if (batch.length >= BATCH_SIZE) {
          flushBatch()
        }
      }
    }

    try {
      await walk(root, true)
      flushBatch() // flush remaining rows

      // Stale file cleanup: remove rows not seen in this crawl
      db.prepare('DELETE FROM files WHERE indexed_at < ?').run(crawlStartMs)

      // Populate projects table from distinct project values
      const projectRows = db.prepare(
        'SELECT DISTINCT project FROM files WHERE project IS NOT NULL AND is_dir = 0'
      ).all() as { project: string }[]
      const now = Date.now()
      for (const { project } of projectRows) {
        stmtUpsertProject.run({ folderName: project, firstSeenMs: now })
        stmtUpdateProjectCounts.run({ folderName: project })
      }

      const fileCount = (db.prepare('SELECT COUNT(*) AS c FROM files WHERE is_dir = 0').get() as { c: number }).c
      setMeta('file_count', String(fileCount))
      setMeta('last_crawl_ms', String(Date.now()))
      setMeta('crawl_status', 'idle')
      setMeta('crawl_error', '')
    } catch (err) {
      setMeta('crawl_status', 'error')
      setMeta('crawl_error', String(err))
    }
  },

  reindex(): void {
    if (!db) return
    db.exec('DELETE FROM files')
    db.exec('DELETE FROM projects')
    db.exec('DELETE FROM index_meta')
    this.startCrawl().catch((err) => {
      console.error('fileIndexService: reindex crawl failed', err)
    })
  },
  startWatcher(root: string): void {
    if (!db) return
    watcherRetries = 0

    const restartAfterError = () => {
      if (watcherRetries >= MAX_WATCHER_RETRIES) return
      watcherRetries++
      const delayMs = 30_000 * Math.pow(2, watcherRetries - 1)
      setTimeout(() => {
        watcherInstance?.close()
        this.startWatcher(root)
      }, delayMs)
    }

    watcherInstance = chokidar
      .watch(root, { usePolling: true, interval: 5000, ignoreInitial: true })
      .on('add', (filePath) => {
        fsPromises.stat(filePath).then((stat) => {
          const name = path.basename(filePath)
          const lastDot = name.lastIndexOf('.')
          const ext = lastDot >= 0 ? name.slice(lastDot + 1).toLowerCase() : ''
          const parsed = parseFilename(name)
          const { project, discipline } = getPathSegments(filePath, root, false)
          stmtUpsertFile.run({
            path: filePath, name, ext,
            sizeBytes: stat.size,
            modifiedMs: Math.round(stat.mtimeMs),
            isDir: 0,
            indexedAt: Date.now(),
            project, discipline,
            docType: parsed.docType, drawingNumber: parsed.drawingNumber,
            revision: parsed.revision, issueStatus: parsed.issueStatus,
            fileDateMs: parsed.fileDateMs,
          })
        }).catch(() => { /* file already gone */ })
      })
      .on('change', (filePath) => {
        fsPromises.stat(filePath).then((stat) => {
          stmtUpdateFile.run({
            path: filePath,
            sizeBytes: stat.size,
            modifiedMs: Math.round(stat.mtimeMs),
            indexedAt: Date.now(),
          })
        }).catch(() => { /* ignore */ })
      })
      .on('unlink', (filePath) => {
        stmtDeleteFile.run(filePath)
      })
      .on('addDir', (dirPath) => {
        const name = path.basename(dirPath)
        const { project, discipline } = getPathSegments(dirPath, root, true)
        stmtUpsertFile.run({
          path: dirPath, name, ext: '',
          sizeBytes: 0, modifiedMs: Date.now(), isDir: 1,
          indexedAt: Date.now(),
          project, discipline,
          docType: null, drawingNumber: null,
          revision: null, issueStatus: null, fileDateMs: null,
        })
      })
      .on('unlinkDir', (dirPath) => {
        stmtDeleteFile.run(dirPath)
        stmtDeleteChildren.run(`${dirPath}${path.sep}%`)
      })
      .on('error', (err) => {
        console.error('fileIndexService watcher error:', err)
        restartAfterError()
      })
  },

  search(params: SearchParams): FileEntry[] {
    if (!db) return []
    const trimmed = (params.query ?? '').trim()
    if (!trimmed) return []
    const pattern = `%${trimmed}%`
    return stmtSearch.all({
      pattern,
      project: params.project ?? null,
      discipline: params.discipline ?? null,
      docType: params.docType ?? null,
      ext: params.ext ?? null,
      limit: params.limit ?? 200,
    }) as FileEntry[]
  },
}
