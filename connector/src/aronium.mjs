import { DatabaseSync } from 'node:sqlite'

// Lectura de la base de Aronium (SQLite, `pos.db`). Solo lectura: este archivo
// nunca escribe en Aronium.
//
// Las lecturas son cortas a propósito: mientras se lee, la caja no puede
// grabar (espera). Por eso las fotos (blobs pesados) no se leen en cada
// pasada, solo las que pide la tienda (readImages).

/**
 * @typedef {{
 *   code: string, name: string, description: string | null, price: number,
 *   stock: number, enabled: boolean, group: string | null,
 *   image_hash: string | null, barcodes: string[]
 * }} AroniumProduct
 */

function open(dbPath) {
  // timeout: si la caja está grabando, espera hasta 5 s en vez de fallar.
  return new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 })
}

/**
 * Catálogo con precio y stock, sin fotos.
 * @param {string} dbPath
 * @param {{ warehouseId?: number | null }} [options]
 * @returns {AroniumProduct[]}
 */
export function readProducts(dbPath, options = {}) {
  const db = open(dbPath)
  try {
    const stockJoin = options.warehouseId
      ? 'LEFT JOIN Stock s ON s.ProductId = p.Id AND s.WarehouseId = :warehouseId'
      : 'LEFT JOIN Stock s ON s.ProductId = p.Id'
    const rows = db
      .prepare(
        `SELECT p.Id, p.Code, p.Name, p.Description, p.Price, p.IsEnabled,
                length(p.Image) AS ImageSize,
                g.Name AS GroupName, COALESCE(SUM(s.Quantity), 0) AS Stock
           FROM Product p
           LEFT JOIN ProductGroup g ON g.Id = p.ProductGroupId
           ${stockJoin}
          WHERE p.IsService = 0
          GROUP BY p.Id`
      )
      .all(options.warehouseId ? { warehouseId: options.warehouseId } : {})

    // Códigos de barras (puede haber varios por producto).
    /** @type {Map<number, string[]>} */
    const barcodes = new Map()
    for (const b of db.prepare('SELECT ProductId, Value FROM Barcode WHERE Value IS NOT NULL').all()) {
      const value = String(b.Value).trim()
      if (!value) continue
      barcodes.set(Number(b.ProductId), [...(barcodes.get(Number(b.ProductId)) ?? []), value])
    }

    /** @type {AroniumProduct[]} */
    const products = []
    for (const row of rows) {
      // Sin código no hay cómo unirlo con la tienda (el código es el SKU).
      const code = String(row.Code ?? '').trim()
      if (!code) continue
      const imageSize = Number(row.ImageSize) || 0
      products.push({
        code,
        name: String(row.Name ?? '').trim() || code,
        description: row.Description ? String(row.Description).trim() || null : null,
        price: Math.round(Number(row.Price) || 0),
        // Tal cual (puede ser negativo si se vendió de más): la tienda lo ajusta.
        stock: Math.floor(Number(row.Stock) || 0),
        enabled: Boolean(row.IsEnabled),
        group: row.GroupName ? String(row.GroupName).trim() || null : null,
        // Marca de que tiene foto (y si cambió de tamaño). La foto en sí se
        // lee aparte, solo cuando la tienda la pide.
        image_hash: imageSize > 8 ? `len-${imageSize}` : null,
        barcodes: barcodes.get(Number(row.Id)) ?? [],
      })
    }
    return products
  } finally {
    db.close()
  }
}

/**
 * Fotos de los códigos pedidos (JPEG o PNG).
 * @param {string} dbPath
 * @param {string[]} codes
 * @returns {Map<string, { base64: string, mimeType: string }>}
 */
export function readImages(dbPath, codes) {
  const out = new Map()
  if (!codes.length) return out
  const db = open(dbPath)
  try {
    const stmt = db.prepare('SELECT Code, Image FROM Product WHERE Code = ?')
    for (const code of codes) {
      const row = stmt.get(code)
      const image = row ? toImage(row.Image) : null
      if (image) out.set(code, image)
    }
    return out
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
