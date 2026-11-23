import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './config.mjs'

// Comunicación con el programa de la PC (Sincronizador.exe, carpeta panel/).
// El agente corre como tarea del sistema y no puede mostrar nada en pantalla:
// el programa corre con el usuario y se entera por archivos.
//
// status.json (lo escribe el agente): cómo anda.
// {
//   "version": "0.10.0", "pid": 1234, "lock": "\\\\.\\pipe\\sincronizador-aronium-…",
//   "started_at": "…", "updated_at": "…",
//   "state": "running" | "passing" | "paused_local" | "paused_panel",
//   "interval_minutes": 1, "interval_from_panel": true,
//   "last_pass_at": "…", "last_pass_ok": true, "next_pass_at": "…",
//   "store_ok_at": "…", "store_error": null | "Sin conexión con la tienda…", "store_error_since": "…",
//   "aronium_ok_at": "…", "aronium_error": null | "…", "products": 2542,
//   "write_enabled": true, "write_blocked_reason": null
// }
//
// comandos/orden.json (lo escribe el programa): { "command": "sync" | "full" }.
// El agente lo lee entre pasadas (cada segundo), lo borra y hace una pasada ya.
// Va en una carpeta aparte porque el usuario del local tiene permiso de
// escritura ahí y no en el resto (install.ps1).

export const STATUS_PATH = path.join(ROOT, 'status.json')
export const ORDER_PATH = path.join(ROOT, 'comandos', 'orden.json')

export function writeStatus(status) {
  const tmp = `${STATUS_PATH}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify({ ...status, updated_at: new Date().toISOString() }, null, 1))
    fs.renameSync(tmp, STATUS_PATH)
  } catch {
    // El programa de la PC es un extra: si no se puede escribir, el agente sigue.
  }
}

/** La orden pendiente del programa, o null. La borra al leerla. */
export function takeOrder() {
  let raw
  try {
    raw = fs.readFileSync(ORDER_PATH, 'utf8')
  } catch {
    return null
  }
  try {
    fs.rmSync(ORDER_PATH, { force: true })
  } catch {
    // Si no se puede borrar se volvería a leer en cada vuelta: se ignora.
    return null
  }
  try {
    const order = JSON.parse(raw.replace(/^﻿/, ''))
    return order?.command === 'full' ? 'full' : 'sync'
  } catch {
    return 'sync'
  }
}
