import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

// Lectura de la base de Aronium (SQLite, `pos.db`). Solo lectura: el agente
// nunca escribe en Aronium.

/**
 * @typedef {{
 *   code: string, name: string, description: string | null, price: number,
 *   stock: number, enabled: boolean, group: string | null,
 *   image: { base64: string, mimeType: string } | null, image_hash: string | null
 * }} AroniumProduct
 */

/**
 * @param {string} dbPath
 * @param {{ warehouseId?: number | null }} [options]
 * @returns {AroniumProduct[]}
 */
export function readProducts(dbPath, options = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 })
  try {
    const stockJoin = options.warehouseId
      ? 'LEFT JOIN Stock s ON s.ProductId = p.Id AND s.WarehouseId = :warehouseId'
      : 'LEFT JOIN Stock s ON s.ProductId = p.Id'
    const rows = db
      .prepare(
        `SELECT p.Id, p.Code, p.Name, p.Description, p.Price, p.IsEnabled, p.Image,
                g.Name AS GroupName, COALESCE(SUM(s.Quantity), 0) AS Stock
           FROM Product p
           LEFT JOIN ProductGroup g ON g.Id = p.ProductGroupId
           ${stockJoin}
          WHERE p.IsService = 0
          GROUP BY p.Id`
      )
      .all(options.warehouseId ? { warehouseId: options.warehouseId } : {})

    /** @type {AroniumProduct[]} */
    const products = []
    for (const row of rows) {
      // Sin código no hay cómo unirlo con la tienda (el código es el SKU).
      const code = String(row.Code ?? '').trim()
      if (!code) continue
      const image = toImage(row.Image)
      products.push({
        code,
        name: String(row.Name ?? '').trim() || code,
        description: row.Description ? String(row.Description).trim() || null : null,
        price: Math.round(Number(row.Price) || 0),
        stock: Math.max(0, Math.floor(Number(row.Stock) || 0)),
        enabled: Boolean(row.IsEnabled),
        group: row.GroupName ? String(row.GroupName).trim() || null : null,
        image,
        image_hash: image ? createHash('sha1').update(image.base64).digest('hex') : null,
      })
    }
    return products
  } finally {
    db.close()
  }
}

/** @param {unknown} blob */
function toImage(blob) {
  if (!(blob instanceof Uint8Array) || blob.length < 8) return null
  const bytes = Buffer.from(blob)
  let mimeType = null
  if (bytes[0] === 0xff && bytes[1] === 0xd8) mimeType = 'image/jpeg'
  else if (bytes.subarray(0, 4).toString('hex') === '89504e47') mimeType = 'image/png'
  if (!mimeType) return null
  return { base64: bytes.toString('base64'), mimeType }
}
