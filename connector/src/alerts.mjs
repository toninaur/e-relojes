import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './config.mjs'

// avisos.json: lo que muestra el programa de avisos de la PC del local
// (avisos.ps1). El agente corre como SYSTEM y Windows no lo deja mostrar nada
// en pantalla; el programa de avisos corre con el usuario que inició sesión y
// lee este archivo.
//
// {
//   "updated_at": "2026-11-18T22:00:00.000Z",   ← si es viejo, el agente no anda
//   "pending":  [{ "code": "PW-1042-K7", "number": 1042, "customer": "Juan Pérez",
//                  "total": 1250000, "currency": "PYG", "quote": "26-230-000012",
//                  "created_at": "…" }],          ← proformas esperando "Pagado"
//   "errors":   [{ "code": "PW-1043-AB", "message": "…" }]
// }

export const ALERTS_PATH = path.join(ROOT, 'avisos.json')

/** @param {{ pending: object[], errors: object[] }} alerts */
export function writeAlerts(alerts) {
  const data = { updated_at: new Date().toISOString(), pending: alerts.pending, errors: alerts.errors }
  const tmp = `${ALERTS_PATH}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1))
    fs.renameSync(tmp, ALERTS_PATH)
  } catch {
    // Los avisos son un extra: si no se pueden escribir, el agente sigue.
  }
}

/** Lo que el aviso muestra de un pedido. */
export function pendingEntry(job, quoteNumber) {
  const p = job.payload ?? {}
  return {
    code: job.tracking_code,
    number: p.display_id ?? null,
    customer: p.customer?.business_name || p.customer?.name || '',
    total: p.total ?? null,
    currency: p.currency ?? 'PYG',
    quote: quoteNumber ?? job.aronium_quote_number ?? null,
    created_at: p.created_at ?? null,
  }
}
