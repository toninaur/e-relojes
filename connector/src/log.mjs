import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './config.mjs'

// connector.log en la carpeta del agente (se rota a los 5 MB).
const LOG_PATH = path.join(ROOT, 'connector.log')

// El mismo mensaje una y otra vez (sin internet todo el día: dos por minuto)
// se anota la primera vez y después como mucho una vez por hora, con cuántas
// veces se repitió en el medio.
const REPEAT_WINDOW_MS = 60 * 60 * 1000
/** @type {Map<string, { at: number, skipped: number }>} */
const recent = new Map()

export function log(message) {
  // Solo los errores y avisos repetidos; lo demás (cambios, pedidos) siempre.
  if (!/^(ERROR|Aronium ocupado)/.test(message)) return write(message)
  const now = Date.now()
  const seen = recent.get(message)
  if (seen && now - seen.at < REPEAT_WINDOW_MS) {
    seen.skipped++
    return
  }
  write(seen?.skipped ? `${message} (se repitió ${seen.skipped} veces en la última hora)` : message)
  recent.set(message, { at: now, skipped: 0 })
  // Que la lista no crezca: se olvida lo de hace más de una hora.
  if (recent.size > 200) for (const [m, v] of recent) if (now - v.at >= REPEAT_WINDOW_MS) recent.delete(m)
}

function write(message) {
  const line = `${new Date().toISOString()} ${message}`
  console.log(line)
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 5 * 1024 * 1024) {
      fs.renameSync(LOG_PATH, `${LOG_PATH}.1`)
    }
    fs.appendFileSync(LOG_PATH, `${line}\n`)
  } catch {
    // Sin log en disco el agente sigue funcionando.
  }
}

export function errorMessage(error) {
  if (!(error instanceof Error)) return String(error)
  if (!(error.cause instanceof Error)) return error.message
  // "Conexión rechazada" llega como un AggregateError sin texto (uno por cada
  // dirección, IPv6 e IPv4): se usa el código (ECONNREFUSED).
  const cause = error.cause.message || error.cause.errors?.find((e) => e?.message)?.message || error.cause.code
  return cause ? `${error.message} (${cause})` : error.message
}
