import Database from 'better-sqlite3'
import * as path from 'node:path'
import * as fsPromises from 'node:fs/promises'
import chokidar from 'chokidar'
import { shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-types'
import type { FileEntry, SearchParams } from '../shared/ipc-types'
import type { FileSource, SourceStatus } from '../shared/file-sources'
import { parseFilename } from './parseFilename'

interface SourceState {
  watcher: ReturnType<typeof chokidar.watch> | null
  retries: number
  online: boolean
  crawling: boolean
}

let db: Database.Database | null = null
let mainWin: BrowserWindow | null = null
let getSourcesFn: () => FileSource[] = () => []
const sourceStates = new Map<string, SourceState>()

const BATCH_SIZE = 500
const MAX_WATCHER_RETRIES = 5

// Prepared statements — set during init()
let stmtUpsertFile: Database.Statement
let stmtDeleteFile: Database.Statement
let stmtUpdateFile: Database.Statement
let stmtDeleteChildren: Database.Statement
let stmtSearch: Database.Statement
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
    source_id      TEXT    NOT NULL DEFAULT 'default',
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
  CREATE INDEX IF NOT EXISTS idx_files_source   ON files(source_id);

  CREATE TABLE IF NOT EXISTS projects (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_name      TEXT    NOT NULL,
    source_id        TEXT    NOT NULL DEFAULT 'default',
    display_name     TEXT,
    client           TEXT,
    status           TEXT    NOT NULL DEFAULT 'unknown',
    file_count       INTEGER NOT NULL DEFAULT 0,
    last_modified_ms INTEGER,
    first_seen_ms    INTEGER NOT NULL,
    UNIQUE(folder_name, source_id)
  );

  CREATE TABLE IF NOT EXISTS index_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

// ── Migration ─────────────────────────────────────────────────────────────────

function runMigrations(): void {
  if (!db) return

  // DB column migrations (idempotent)
  const hasSourceIdFiles =
    (
      db
        .prepare("SELECT COUNT(*) AS c FROM pragma_table_info('files') WHERE name = 'source_id'")
        .get() as { c: number }
    ).c > 0

  if (!hasSourceIdFiles) {
    db.exec(`ALTER TABLE files ADD COLUMN source_id TEXT NOT NULL DEFAULT 'default'`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_files_source ON files(source_id)`)
  }

  const hasSourceIdProjects =
    (
      db
        .prepare("SELECT COUNT(*) AS c FROM pragma_table_info('projects') WHERE name = 'source_id'")
        .get() as { c: number }
    ).c > 0

  if (!hasSourceIdProjects) {
    db.transaction(() => {
      db!.exec(`ALTER TABLE projects RENAME TO projects_old`)
      db!.exec(`
        CREATE TABLE projects (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          folder_name      TEXT    NOT NULL,
          source_id        TEXT    NOT NULL DEFAULT 'default',
          display_name     TEXT,
          client           TEXT,
          status           TEXT    NOT NULL DEFAULT 'unknown',
          file_count       INTEGER NOT NULL DEFAULT 0,
          last_modified_ms INTEGER,
          first_seen_ms    INTEGER NOT NULL,
          UNIQUE(folder_name, source_id)
        )
      `)
      db!.exec(
        `INSERT INTO projects (id, folder_name, source_id, display_name, client, status, file_count, last_modified_ms, first_seen_ms) SELECT id, folder_name, 'default', display_name, client, status, file_count, last_modified_ms, first_seen_ms FROM projects_old`,
      )
      db!.exec(`DROP TABLE projects_old`)
    })()
  }

  // index_meta key migration (namespaced per source)
  const OLD_KEYS = ['crawl_status', 'last_crawl_ms', 'crawl_error', 'file_count'] as const
  for (const key of OLD_KEYS) {
    const namespacedKey = `${key}:default`
    const oldRow = db.prepare('SELECT value FROM index_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (oldRow) {
      const newExists = db.prepare('SELECT value FROM index_meta WHERE key = ?').get(namespacedKey)
      if (!newExists) {
        db.prepare('INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?)').run(
          namespacedKey,
          oldRow.value,
        )
      }
      db.prepare('DELETE FROM index_meta WHERE key = ?').run(key)
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── reindexSource / reindexAll helpers ────────────────────────────────────────

// reindexSource is async so reindexAll can await each in sequence (avoids disk thrashing)
async function reindexSource(sourceId: string): Promise<void> {
  if (!db) return
  db.prepare('DELETE FROM files WHERE source_id = ?').run(sourceId)
  db.prepare('DELETE FROM projects WHERE source_id = ?').run(sourceId)
  await fileIndexService.crawlSource(sourceId)
}

async function reindexAll(): Promise<void> {
  // getSourcesFn is module-level — call it directly (not via the exported object)
  // Sequential (not concurrent) to avoid disk thrashing
  const sources = getSourcesFn()
  for (const source of sources.filter((s) => s.enabled)) {
    await reindexSource(source.id)
  }
}

// ── Public service object ─────────────────────────────────────────────────────

export const fileIndexService = {
  init(dbPath: string, getSources: () => FileSource[], win: BrowserWindow | null): void {
    getSourcesFn = getSources
    mainWin = win
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA_SQL)
    runMigrations()
    stmtUpsertFile = db.prepare(
      `INSERT OR REPLACE INTO files (path, name, ext, size_bytes, modified_ms, is_dir, indexed_at, source_id, project, discipline, doc_type, drawing_number, revision, issue_status, file_date_ms) VALUES (@path, @name, @ext, @sizeBytes, @modifiedMs, @isDir, @indexedAt, @sourceId, @project, @discipline, @docType, @drawingNumber, @revision, @issueStatus, @fileDateMs)`,
    )
    stmtUpdateFile = db.prepare(
      `UPDATE files SET size_bytes = @sizeBytes, modified_ms = @modifiedMs, indexed_at = @indexedAt WHERE path = @path`,
    )
    stmtDeleteFile = db.prepare(`DELETE FROM files WHERE path = ?`)
    stmtDeleteChildren = db.prepare(`DELETE FROM files WHERE path LIKE ?`)
    stmtUpsertProject = db.prepare(
      `INSERT OR IGNORE INTO projects (folder_name, source_id, first_seen_ms) VALUES (@folderName, @sourceId, @firstSeenMs)`,
    )
    stmtUpdateProjectCounts = db.prepare(
      `UPDATE projects SET file_count = (SELECT COUNT(*) FROM files WHERE project = @folderName AND source_id = @sourceId AND is_dir = 0), last_modified_ms = (SELECT MAX(modified_ms) FROM files WHERE project = @folderName AND source_id = @sourceId AND is_dir = 0) WHERE folder_name = @folderName AND source_id = @sourceId`,
    )
    stmtSearch = db.prepare(
      `SELECT path, name, ext, size_bytes AS sizeBytes, modified_ms AS modifiedMs, is_dir AS isDir, source_id AS sourceId, project, discipline, doc_type AS docType, drawing_number AS drawingNumber, revision, issue_status AS issueStatus FROM files WHERE (name LIKE @pattern OR path LIKE @pattern) AND (@sourceId IS NULL OR source_id = @sourceId) AND (@project IS NULL OR project = @project) AND (@discipline IS NULL OR discipline = @discipline) AND (@docType IS NULL OR doc_type = @docType) AND (@ext IS NULL OR ext = @ext) AND is_dir = 0 ORDER BY modified_ms DESC LIMIT @limit`,
    )
    const sources = getSourcesFn()
    for (const source of sources) {
      if (source.enabled) this.startWatcher(source)
    }
  },

  close(): void {
    for (const [, state] of sourceStates) {
      state.watcher?.close()
    }
    sourceStates.clear()
    db?.close()
    db = null
  },

  getStatus(): SourceStatus[] {
    const sources = getSourcesFn()
    return sources.map((source) => {
      if (!source.enabled) {
        return {
          sourceId: source.id,
          displayName: source.displayName,
          path: source.path,
          type: source.type,
          online: false,
          status: 'disabled' as const,
          fileCount: 0,
          lastCrawledMs: null,
          crawlError: null,
        }
      }
      const state = sourceStates.get(source.id)
      const crawling = state?.crawling ?? false
      const online = state?.online ?? true

      if (!db) {
        return {
          sourceId: source.id,
          displayName: source.displayName,
          path: source.path,
          type: source.type,
          online: false,
          status: 'not-configured' as const,
          fileCount: 0,
          lastCrawledMs: null,
          crawlError: null,
        }
      }

      const getMetaLocal = (key: string): string | null => {
        const row = db!.prepare('SELECT value FROM index_meta WHERE key = ?').get(key) as
          | { value: string }
          | undefined
        return row?.value ?? null
      }

      let status: SourceStatus['status']
      if (crawling) status = 'crawling'
      else if (!online || getMetaLocal(`crawl_status:${source.id}`) === 'error') status = 'error'
      else status = (getMetaLocal(`crawl_status:${source.id}`) ?? 'idle') as SourceStatus['status']

      const fileCountStr = getMetaLocal(`file_count:${source.id}`)
      const lastCrawlMsStr = getMetaLocal(`last_crawl_ms:${source.id}`)
      const crawlError = getMetaLocal(`crawl_error:${source.id}`)

      return {
        sourceId: source.id,
        displayName: source.displayName,
        path: source.path,
        type: source.type,
        online,
        status,
        fileCount: fileCountStr ? parseInt(fileCountStr, 10) : 0,
        lastCrawledMs: lastCrawlMsStr ? parseInt(lastCrawlMsStr, 10) : null,
        crawlError: crawlError || null,
      }
    })
  },

  async openFile(filePath: string): Promise<string> {
    return shell.openPath(filePath)
  },

  crawlIfStale(): void {
    const sources = getSourcesFn().filter((s) => s.enabled)
    const run = async () => {
      for (const source of sources) {
        const lastMs = (() => {
          const row = db
            ?.prepare('SELECT value FROM index_meta WHERE key = ?')
            .get(`last_crawl_ms:${source.id}`) as { value: string } | undefined
          return row ? parseInt(row.value, 10) : null
        })()
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
        if (!lastMs || Date.now() - lastMs > TWENTY_FOUR_HOURS) {
          await this.crawlSource(source.id)
        }
      }
    }
    run().catch((err) => console.error('fileIndexService: crawlIfStale failed', err))
  },

  async crawlAll(): Promise<void> {
    const sources = getSourcesFn().filter((s) => s.enabled)
    for (const source of sources) {
      await this.crawlSource(source.id)
    }
  },

  reindex(sourceId?: string): void {
    if (sourceId) {
      reindexSource(sourceId).catch((err) =>
        console.error(`fileIndexService: reindex failed for ${sourceId}`, err),
      )
    } else {
      reindexAll().catch((err) => console.error('fileIndexService: reindexAll failed', err))
    }
  },

  async crawlSource(sourceId: string): Promise<void> {
    if (!db) return
    const sources = getSourcesFn()
    const source = sources.find((s) => s.id === sourceId)
    if (!source || !source.enabled) return

    // Guard against concurrent crawls for the same source
    const existing = sourceStates.get(sourceId)
    if (existing?.crawling) return

    const state = existing ?? { watcher: null, retries: 0, online: true, crawling: false }
    state.crawling = true
    sourceStates.set(sourceId, state)

    const setMeta = (key: string, value: string) => {
      db!.prepare('INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?)').run(key, value)
    }

    try {
      // Test reachability
      try {
        await fsPromises.access(source.path)
      } catch {
        state.online = false
        setMeta(`crawl_status:${sourceId}`, 'error')
        setMeta(`crawl_error:${sourceId}`, `Path unreachable: ${source.path}`)
        return
      }

      state.online = true
      setMeta(`crawl_status:${sourceId}`, 'crawling')
      setMeta(`crawl_error:${sourceId}`, '')

      const crawlStartMs = Date.now()
      const root = source.path

      const batchInsert = db.transaction((rows: Record<string, unknown>[]) => {
        for (const row of rows) stmtUpsertFile.run(row)
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
          entries = (await fsPromises.readdir(dir, {
            withFileTypes: true,
          })) as import('node:fs').Dirent[]
        } catch (err) {
          if (isRoot) throw err
          return
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
              sourceId,
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
              sourceId,
              project,
              discipline,
              docType: parsed.docType,
              drawingNumber: parsed.drawingNumber,
              revision: parsed.revision,
              issueStatus: parsed.issueStatus,
              fileDateMs: parsed.fileDateMs,
            })
          }
          if (batch.length >= BATCH_SIZE) flushBatch()
        }
      }

      await walk(root, true)
      flushBatch()

      // Stale cleanup — only this source's rows
      db.prepare('DELETE FROM files WHERE source_id = ? AND indexed_at < ?').run(
        sourceId,
        crawlStartMs,
      )

      // Update projects for this source
      const projectRows = db
        .prepare(
          'SELECT DISTINCT project FROM files WHERE source_id = ? AND project IS NOT NULL AND is_dir = 0',
        )
        .all(sourceId) as { project: string }[]
      const now = Date.now()
      for (const { project } of projectRows) {
        stmtUpsertProject.run({ folderName: project, sourceId, firstSeenMs: now })
        stmtUpdateProjectCounts.run({ folderName: project, sourceId })
      }

      const fileCount = (
        db
          .prepare('SELECT COUNT(*) AS c FROM files WHERE source_id = ? AND is_dir = 0')
          .get(sourceId) as { c: number }
      ).c
      setMeta(`file_count:${sourceId}`, String(fileCount))
      setMeta(`last_crawl_ms:${sourceId}`, String(Date.now()))
      setMeta(`crawl_status:${sourceId}`, 'idle')
      setMeta(`crawl_error:${sourceId}`, '')
    } catch (err) {
      db?.prepare('INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?)').run(
        `crawl_status:${sourceId}`,
        'error',
      )
      db?.prepare('INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?)').run(
        `crawl_error:${sourceId}`,
        String(err),
      )
    } finally {
      state.crawling = false
    }
  },

  startWatcher(source: FileSource): void {
    if (!db) return
    const existing = sourceStates.get(source.id)
    if (existing?.watcher) existing.watcher.close()

    // Do not copy crawling from existing — crawl lifecycle is independent of watcher lifecycle.
    // If existing?.crawling is true, the in-flight crawlSource holds a direct ref to the old
    // state object and will set its crawling=false in finally. The new map entry starts fresh.
    const state: SourceState = {
      watcher: null,
      retries: 0,
      online: true,
      crawling: false,
    }
    sourceStates.set(source.id, state)

    const restartAfterError = () => {
      if (state.retries >= MAX_WATCHER_RETRIES) return
      state.retries++
      const delayMs = 30_000 * Math.pow(2, state.retries - 1)
      setTimeout(() => this.startWatcher(source), delayMs)
    }

    const root = source.path
    const sid = source.id

    state.watcher = chokidar
      .watch(root, { usePolling: true, interval: 5000, ignoreInitial: true })
      .on('add', (filePath) => {
        fsPromises
          .stat(filePath)
          .then((stat) => {
            const name = path.basename(filePath)
            const lastDot = name.lastIndexOf('.')
            const ext = lastDot >= 0 ? name.slice(lastDot + 1).toLowerCase() : ''
            const parsed = parseFilename(name)
            const { project, discipline } = getPathSegments(filePath, root, false)
            stmtUpsertFile.run({
              path: filePath,
              name,
              ext,
              sizeBytes: stat.size,
              modifiedMs: Math.round(stat.mtimeMs),
              isDir: 0,
              indexedAt: Date.now(),
              sourceId: sid,
              project,
              discipline,
              docType: parsed.docType,
              drawingNumber: parsed.drawingNumber,
              revision: parsed.revision,
              issueStatus: parsed.issueStatus,
              fileDateMs: parsed.fileDateMs,
            })
          })
          .catch(() => {})
      })
      .on('change', (filePath) => {
        fsPromises
          .stat(filePath)
          .then((stat) => {
            stmtUpdateFile.run({
              path: filePath,
              sizeBytes: stat.size,
              modifiedMs: Math.round(stat.mtimeMs),
              indexedAt: Date.now(),
            })
          })
          .catch(() => {})
      })
      .on('unlink', (filePath) => {
        stmtDeleteFile.run(filePath)
      })
      .on('addDir', (dirPath) => {
        const name = path.basename(dirPath)
        const { project, discipline } = getPathSegments(dirPath, root, true)
        stmtUpsertFile.run({
          path: dirPath,
          name,
          ext: '',
          sizeBytes: 0,
          modifiedMs: Date.now(),
          isDir: 1,
          indexedAt: Date.now(),
          sourceId: sid,
          project,
          discipline,
          docType: null,
          drawingNumber: null,
          revision: null,
          issueStatus: null,
          fileDateMs: null,
        })
      })
      .on('unlinkDir', (dirPath) => {
        stmtDeleteFile.run(dirPath)
        stmtDeleteChildren.run(`${dirPath}${path.sep}%`)
      })
      .on('error', (err) => {
        console.error(`fileIndexService watcher error [${sid}]:`, err)
        state.online = false
        restartAfterError()
      })
  },

  stopWatcher(sourceId: string): void {
    const state = sourceStates.get(sourceId)
    if (state?.watcher) {
      state.watcher.close()
      state.watcher = null
    }
    sourceStates.delete(sourceId)
  },

  isCrawling(sourceId: string): boolean {
    return sourceStates.get(sourceId)?.crawling ?? false
  },

  deleteSourceData(sourceId: string): void {
    if (!db) return
    db.prepare('DELETE FROM files WHERE source_id = ?').run(sourceId)
    db.prepare('DELETE FROM projects WHERE source_id = ?').run(sourceId)
    // Use explicit key list to avoid LIKE wildcard ambiguity
    const stmt = db.prepare('DELETE FROM index_meta WHERE key = ?')
    for (const k of ['crawl_status', 'last_crawl_ms', 'crawl_error', 'file_count']) {
      stmt.run(`${k}:${sourceId}`)
    }
  },

  listProjects(sourceId?: string): string[] {
    if (!db) return []
    const rows = sourceId
      ? (db
          .prepare(
            'SELECT DISTINCT project FROM files WHERE source_id = ? AND project IS NOT NULL AND is_dir = 0 ORDER BY project',
          )
          .all(sourceId) as { project: string }[])
      : (db
          .prepare(
            'SELECT DISTINCT project FROM files WHERE project IS NOT NULL AND is_dir = 0 ORDER BY project',
          )
          .all() as { project: string }[])
    return rows.map((r) => r.project)
  },

  search(params: SearchParams): FileEntry[] {
    if (!db) return []
    const trimmed = (params.query ?? '').trim()
    if (!trimmed) return []
    const pattern = `%${trimmed}%`
    const { sourceId, discipline, docType, ext, limit } = params
    const lim = limit ?? 200

    if (Array.isArray(params.project) && params.project.length > 0) {
      // Path B: dynamic statement, all positional params
      const placeholders = params.project.map(() => '?').join(', ')
      const sql = `
        SELECT path, name, ext,
               size_bytes     AS sizeBytes,
               modified_ms    AS modifiedMs,
               is_dir         AS isDir,
               source_id      AS sourceId,
               project, discipline,
               doc_type       AS docType,
               drawing_number AS drawingNumber,
               revision,
               issue_status   AS issueStatus
        FROM files
        WHERE (name LIKE ? OR path LIKE ?)
          AND (? IS NULL OR source_id = ?)
          AND project IN (${placeholders})
          AND (? IS NULL OR discipline = ?)
          AND (? IS NULL OR doc_type = ?)
          AND (? IS NULL OR ext = ?)
          AND is_dir = 0
        ORDER BY modified_ms DESC
        LIMIT ?
      `
      const stmt = db.prepare(sql)
      return stmt.all(
        pattern,
        pattern,
        sourceId ?? null,
        sourceId ?? null,
        ...params.project,
        discipline ?? null,
        discipline ?? null,
        docType ?? null,
        docType ?? null,
        ext ?? null,
        ext ?? null,
        lim,
      ) as FileEntry[]
    }

    // Path A: named params
    return stmtSearch.all({
      pattern,
      sourceId: sourceId ?? null,
      project: typeof params.project === 'string' ? params.project : null,
      discipline: discipline ?? null,
      docType: docType ?? null,
      ext: ext ?? null,
      limit: lim,
    }) as FileEntry[]
  },
}
