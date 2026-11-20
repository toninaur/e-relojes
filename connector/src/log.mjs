import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './config.mjs'

// connector.log en la carpeta del agente (se rota a los 5 MB).
const LOG_PATH = path.join(ROOT, 'connector.log')

export function log(message) {
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
