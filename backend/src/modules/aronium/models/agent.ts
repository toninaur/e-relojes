import { model } from '@medusajs/framework/utils'

// Estado del agente instalado en la PC del local (una sola fila).
export const AroniumAgent = model.define('aronium_agent', {
  id: model.id({ prefix: 'aragent' }).primaryKey(),
  last_seen_at: model.dateTime().nullable(),
  version: model.text().nullable(),
  host: model.text().nullable(),
  products_total: model.number().default(0),
  last_error: model.text().nullable(),
  last_error_at: model.dateTime().nullable(),
  // Cada cuántos minutos pasa el agente (config.json, entre 1 y 30).
  interval_minutes: model.number().default(5),
  // Códigos activos en la última pasada buena ({ codes: [...] }): el que deja
  // de venir es una baja.
  known_codes: model.json().nullable(),
  // Clave propia del agente (solo sirve para las rutas /aronium-agent). Se
  // guarda el hash SHA-256; la clave se muestra una sola vez en el panel.
  token_hash: model.text().nullable(),
  token_created_at: model.dateTime().nullable(),
  // Códigos que el agente tiene que volver a mandar en la próxima pasada
  // ("Tomar de Aronium" en el panel): { codes: [...] }.
  refresh_codes: model.json().nullable(),
  // ---- Manejado desde el panel → Aronium ----
  // Pausar Aronium → tienda (stock, precios, productos, contenido).
  sync_paused: model.boolean().default(false),
  // Pausar tienda → Aronium (registrar ventas web, pagos y devoluciones).
  web_sales_paused: model.boolean().default(false),
  // Cada cuántos minutos tiene que pasar el agente (1 a 30); null = lo de su config.json.
  desired_interval: model.number().nullable(),
  // "Sincronizar todo ahora": el agente hace una pasada completa en la próxima.
  full_requested: model.boolean().default(false),
  // Lo que informa el agente: si puede escribir ventas en esta base de
  // Aronium (versión conocida) y, si no, por qué.
  write_enabled: model.boolean().nullable(),
  write_blocked_reason: model.text().nullable(),
})
