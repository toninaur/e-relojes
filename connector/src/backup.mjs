import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Copias de respaldo de pos.db: una por día, antes de la primera venta web que
// se escribe ese día. Se guardan las últimas `keepBackups` (14 por defecto).
// VACUUM INTO hace una copia completa y consistente aunque Aronium esté
// abierto (y con una conexión de solo lectura: no toca la base).

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Hace la copia del día si todavía no existe.
 * @returns {string | null} la ruta de la copia nueva, o null si ya estaba.
 */
export function backupIfNeeded(config, state) {
  const day = today()
  const file = path.join(config.backupDir, `pos-${day}.db`)
  if (state.lastBackupDay === day && fs.existsSync(file)) return null
  fs.mkdirSync(config.backupDir, { recursive: true })
  if (!fs.existsSync(file)) {
    const db = new DatabaseSync(config.aroniumDb, { readOnly: true, timeout: 5000 })
    try {
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
    } finally {
      db.close()
    }
  }
  state.lastBackupDay = day
  prune(config)
  return file
}

function prune(config) {
  const files = fs
    .readdirSync(config.backupDir)
    .filter((f) => /^pos-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
  for (const f of files.slice(0, Math.max(0, files.length - config.keepBackups))) {
    fs.unlinkSync(path.join(config.backupDir, f))
  }
}
