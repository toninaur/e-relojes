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

/**
 * Producto de Aronium por el código de la tienda (SKU): su código o, si no
 * tiene código, uno de sus códigos de barras (ver readProducts).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} code
 * @param {string} [columns]
 */
export function productByCode(db, code, columns = 'p.Id') {
  return (
    db.prepare(`SELECT ${columns} FROM Product p WHERE p.Code = ? LIMIT 1`).get(code) ??
    db
      .prepare(
        `SELECT ${columns} FROM Product p JOIN Barcode b ON b.ProductId = p.Id
          WHERE trim(coalesce(p.Code, '')) = '' AND trim(b.Value) = ? ORDER BY b.Id LIMIT 1`
      )
      .get(code) ??
    null
  )
}

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
    for (const b of db.prepare('SELECT ProductId, Value FROM Barcode WHERE Value IS NOT NULL ORDER BY Id').all()) {
      const value = String(b.Value).trim()
      if (!value) continue
      barcodes.set(Number(b.ProductId), [...(barcodes.get(Number(b.ProductId)) ?? []), value])
    }

    // Sin código, el primer código de barras hace de código (el local no
    // carga código en todos los productos). Salvo que sea el código de otro
    // producto o el de barras de otro sin código: ahí no se sabe cuál es.
    const codes = new Set(rows.map((r) => String(r.Code ?? '').trim()).filter(Boolean))
    const fallbackUses = new Map()
    for (const row of rows) {
      const first = String(row.Code ?? '').trim() ? null : barcodes.get(Number(row.Id))?.[0]
      if (first) fallbackUses.set(first, (fallbackUses.get(first) ?? 0) + 1)
    }

    /** @type {AroniumProduct[]} */
    const products = []
    for (const row of rows) {
      let code = String(row.Code ?? '').trim()
      if (!code) {
        const first = barcodes.get(Number(row.Id))?.[0]
        if (first && !codes.has(first) && fallbackUses.get(first) === 1) code = first
      }
      // Sin código ni código de barras no hay cómo unirlo con la tienda.
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
    for (const code of codes) {
      const row = productByCode(db, code, 'p.Image AS Image')
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
