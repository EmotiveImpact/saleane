// node:sqlite's DatabaseSync, backed by sql.js (SQLite compiled to JavaScript) so the real server
// code runs unchanged inside the browser tab. Only the calls the server makes are covered.
import initSqlJs from 'sql.js/dist/sql-asm-memory-growth.js'

type Value = null | number | bigint | string | Uint8Array
type SqlJsDatabase = {
  exec: (sql: string) => unknown
  run: (sql: string, values?: Value[]) => unknown
  prepare: (sql: string) => {
    bind: (values: Value[]) => boolean
    step: () => boolean
    getAsObject: () => Record<string, Value>
    free: () => void
  }
  getRowsModified: () => number
  export: () => Uint8Array
  close: () => void
}
let SQL: { Database: new (data?: Uint8Array) => SqlJsDatabase } | null = null
let initial: Uint8Array | undefined
let opened: { raw: SqlJsDatabase } | null = null

/** Loads the engine; `saved` restores an earlier export of the demo database. */
export async function initSqlite(saved?: Uint8Array) {
  SQL = (await initSqlJs()) as typeof SQL
  initial = saved
}
/** The current database bytes, for saving between visits. */
export const exportDatabase = () => opened?.raw.export()

export class DatabaseSync {
  readonly raw: SqlJsDatabase
  isOpen = true
  constructor(_path: string, options: { enableForeignKeyConstraints?: boolean } = {}) {
    if (!SQL) throw new Error('The demo database engine has not loaded yet.')
    this.raw = new SQL.Database(initial)
    initial = undefined
    if (options.enableForeignKeyConstraints) this.raw.exec('PRAGMA foreign_keys=ON')
    opened = { raw: this.raw }
  }
  exec(sql: string) {
    // WAL and fsync settings mean nothing for an in-memory database.
    if (/^\s*PRAGMA journal_mode/i.test(sql)) return
    this.raw.exec(sql)
  }
  prepare(sql: string) {
    const db = this.raw
    const rows = (values: Value[], limit = Infinity) => {
      const statement = db.prepare(sql)
      try {
        statement.bind(values)
        const out: Record<string, Value>[] = []
        while (out.length < limit && statement.step()) out.push(statement.getAsObject())
        return out
      } finally {
        statement.free()
      }
    }
    return {
      get: (...values: Value[]) => rows(values, 1)[0],
      all: (...values: Value[]) => rows(values),
      run: (...values: Value[]) => {
        db.run(sql, values)
        return { changes: db.getRowsModified(), lastInsertRowid: 0 }
      },
    }
  }
  close() {
    this.isOpen = false
    this.raw.close()
  }
}
