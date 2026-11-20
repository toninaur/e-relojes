import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './config.mjs'

// state.json: lo que el agente tiene que recordar aunque se reinicie.
// - lastSent: lo último que la tienda recibió bien de cada código (para
//   mandar solo lo que cambió).
// - lastFullAt: última pasada completa.
// - pendingResults: ventas web ya escritas en Aronium cuyo resultado todavía
//   no llegó a la tienda (se corta internet justo después de escribir). Se
//   mandan antes que nada en la pasada siguiente.
// - lastBackupDay: día de la última copia de respaldo.
// - forceCodes: códigos que la tienda pidió volver a mandar (un pedido web
//   nuevo o cancelado, "Tomar de Aronium"). La tienda los entrega una sola
//   vez: si el agente se reinicia antes de mandarlos, no se pierden.

const STATE_PATH = path.join(ROOT, 'state.json')

export function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    return {
      lastSent: new Map(Object.entries(raw.lastSent ?? {})),
      lastFullAt: Number(raw.lastFullAt) || 0,
      pendingResults: Array.isArray(raw.pendingResults) ? raw.pendingResults : [],
      lastBackupDay: raw.lastBackupDay ?? null,
      forceCodes: Array.isArray(raw.forceCodes) ? raw.forceCodes.map(String) : [],
    }
  } catch {
    return { lastSent: new Map(), lastFullAt: 0, pendingResults: [], lastBackupDay: null, forceCodes: [] }
  }
}

export function saveState(state) {
  const data = {
    lastSent: Object.fromEntries(state.lastSent),
    lastFullAt: state.lastFullAt,
    pendingResults: state.pendingResults,
    lastBackupDay: state.lastBackupDay,
    forceCodes: state.forceCodes,
  }
  // Escritura atómica: archivo temporal y renombrar (un corte de luz no deja
  // el estado a medias).
  const tmp = `${STATE_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data))
  fs.renameSync(tmp, STATE_PATH)
}
