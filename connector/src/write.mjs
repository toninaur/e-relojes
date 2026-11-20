import { DatabaseSync } from 'node:sqlite'
import { productByCode } from './aronium.mjs'

// Escritura de pedidos web en Aronium (docs/sincronizador-aronium.md, 4.2).
//
// Ciclo de un pedido web:
// 1. writeQuote: PROFORMA (tipo 230) "No pagado" (PaidStatus 1), con el
//    cliente, los renglones y la nota interna "Pedido web PW-1042-K7". No
//    mueve stock. Aronium crea las proformas como "Pagado" por defecto: acá se
//    fija 1 explícitamente.
// 2. La cajera marca la proforma "Pagado" en Aronium (PaidStatus 2; Aronium no
//    crea ningún pago ni toca el stock). quoteStatus lo detecta.
// 3. invoiceQuote: VENTA (tipo 200) con los renglones de la proforma, el pago
//    y el stock descontado; la proforma queda anotada "Facturado 26-200-…".
// Cancelado en la tienda: voidQuote anota ANULADO en la proforma; si ya era
// venta, cancelSale escribe la devolución (tipo 220).
//
// Escribe exactamente lo que escribe la caja (estudiado en pos.db, Aronium Lite
// 1.52). Cada paso en una transacción: entra completo o nada. Antes de escribir
// se busca el código PW- en el número de orden: nunca se duplica.
//
// Errores:
// - AroniumDataError: algo que hay que resolver (un código que no existe en
//   Aronium, la proforma se borró). Se informa al panel.
// - Base ocupada (la caja está grabando): se reintenta en la pasada
//   siguiente sin informar nada (isTransient).

/** Para comparar nombres: sin tildes, mayúsculas ni espacios de más. */
const fold = (text) => String(text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Teléfono comparable: solo números, sin el 595 de Paraguay ni el 0 inicial
 * ("0981 444 555", "+595 981 444555" → "981444555"). Menos de 6 números: nada.
 */
function phoneKey(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '').replace(/^595/, '').replace(/^0+/, '')
  return digits.length >= 6 ? digits : null
}

const QUOTE = '230'
const SALE = '200'
const REFUND = '220'

// Document.PaidStatus (verificado en Aronium el 18/11/2026).
export const PAID = 2
export const UNPAID = 1

export class AroniumDataError extends Error {}

/**
 * Forma de pago por nombre, sin importar tildes ni mayúsculas ("Itau" en
 * config.json encuentra "Itaú"). Por defecto solo las activas; con
 * `includeDisabled`, también las desactivadas (para avisar en vez de crear otra).
 * @returns {{ Id: number, Name: string, IsEnabled: number } | null}
 */
export function findPaymentType(db, name, { includeDisabled = false } = {}) {
  const key = fold(name)
  if (!key) return null
  const rows = db.prepare('SELECT Id, Name, IsEnabled FROM PaymentType ORDER BY IsEnabled DESC, Id').all()
  return rows.find((r) => fold(r.Name) === key && (includeDisabled || Number(r.IsEnabled) === 1)) ?? null
}

export function isTransient(error) {
  // SQLITE_BUSY (5) / SQLITE_LOCKED (6): otra conexión (la caja) está escribiendo.
  return error?.errcode === 5 || error?.errcode === 6 || /database is locked|SQLITE_BUSY/i.test(String(error?.message))
}

const pad = (n, len = 2) => String(n).padStart(len, '0')

/** Fecha y hora local como las guarda Aronium: "2026-11-17 14:45:57.0125345". */
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}0000`
}
/** Solo el día: "2026-11-17 00:00:00". */
function day(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 00:00:00`
}
/** "18/11/2026 14:05", para las notas. */
function human(d = new Date()) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
// 4 decimales, como Aronium (318181,8182): así sus reportes de IVA cuadran.
const money = (n) => Math.round(n * 10000) / 10000
// Las notas de Aronium (cuadro de texto de Windows) usan \r\n.
const lines = (...parts) => parts.filter(Boolean).join('\r\n')
const PAYMENT_NAMES = { bank_transfer: 'Transferencia', cash_on_delivery: 'Efectivo al recibir' }

export function createWriter(config) {
  const web = config.webSales

  function open(readOnly = false) {
    // timeout: si la caja está grabando, espera hasta 5 s.
    return new DatabaseSync(config.aroniumDb, { timeout: 5000, readOnly })
  }

  function transaction(fn) {
    const db = open()
    try {
      // IMMEDIATE: toma el lugar de escritura al empezar; si la caja está
      // grabando, espera (timeout) en vez de fallar a la mitad.
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = fn(db)
        db.exec('COMMIT')
        return result
      } catch (error) {
        try {
          db.exec('ROLLBACK')
        } catch {}
        throw error
      }
    } finally {
      db.close()
    }
  }

  /** ServiceType de las ventas: el de config.json o el que más usa la caja. */
  function saleServiceType(db, saleTypeId) {
    if (web.serviceType !== null && Number.isFinite(web.serviceType)) return web.serviceType
    const row = db
      .prepare('SELECT ServiceType FROM Document WHERE DocumentTypeId = ? GROUP BY ServiceType ORDER BY count(*) DESC LIMIT 1')
      .get(saleTypeId)
    return Number(row?.ServiceType ?? 0)
  }

  function docType(db, code) {
    const row = db.prepare('SELECT Id, WarehouseId FROM DocumentType WHERE Code = ?').get(code)
    if (!row) throw new AroniumDataError(`Aronium no tiene el tipo de documento ${code}.`)
    return row
  }

  /**
   * Número siguiente del año: "26-200-000045". Usa el mayor entre el contador
   * de Aronium y el último número que existe (la base no impide números
   * repetidos, así que no alcanza con el contador).
   */
  function nextNumber(db, code) {
    const now = new Date()
    const year = now.getFullYear()
    const prefix = `${String(year).slice(2)}-${code}-`
    const counterName = `Document.${code}.${year}`
    const counter = Number(db.prepare('SELECT Value FROM Counter WHERE Name = ?').get(counterName)?.Value ?? 0)
    let max = 0
    for (const r of db.prepare('SELECT Number FROM Document WHERE Number LIKE ?').all(`${prefix}%`)) {
      const n = Number(String(r.Number).slice(prefix.length))
      if (Number.isFinite(n) && n > max) max = n
    }
    const next = Math.max(counter, max) + 1
    const updated = db.prepare('UPDATE Counter SET Value = ? WHERE Name = ?').run(next, counterName)
    if (!updated.changes) db.prepare('INSERT INTO Counter (Name, Value) VALUES (?, ?)').run(counterName, next)
    return `${prefix}${pad(next, 6)}`
  }

  /**
   * Usuario de Aronium que figura en la proforma y la venta. El historial de
   * Aronium muestra solo los documentos del usuario con la sesión abierta, así
   * que por defecto es el usuario principal (el activo con más permisos). Con
   * webSales.userName se elige otro.
   */
  function findUser(db, warnings) {
    const main = () => db.prepare('SELECT Id FROM User WHERE IsEnabled = 1 ORDER BY AccessLevel DESC, Id LIMIT 1').get()
    const name = web.userName.trim().toLowerCase()
    if (name) {
      const row = db
        .prepare(
          `SELECT Id FROM User WHERE IsEnabled = 1 AND (
             lower(trim(coalesce(FirstName,'') || ' ' || coalesce(LastName,''))) = ?
             OR lower(trim(coalesce(FirstName,''))) = ? OR lower(coalesce(Username,'')) = ?)
           ORDER BY Id LIMIT 1`
        )
        .get(name, name, name)
      if (row) return row.Id
      warnings.push(`No existe el usuario "${web.userName}" en Aronium: quedó a nombre del usuario principal.`)
    }
    const user = main()
    if (!user) throw new AroniumDataError('Aronium no tiene usuarios activos.')
    return user.Id
  }

  // ---- Clientes (punto 4.3) -------------------------------------------------

  function countryId(db, code) {
    if (!code) return null
    return db.prepare('SELECT Id FROM Country WHERE upper(Code) = upper(?) LIMIT 1').get(code)?.Id ?? null
  }

  /**
   * Todo cliente web queda registrado en Aronium. Se busca por RUC y, sin RUC,
   * por email; si no está, se crea. Aronium manda: de un cliente que ya existe
   * solo se completan los datos vacíos.
   */
  function upsertCustomer(db, payload) {
    const c = payload.customer ?? {}
    const a = c.address ?? {}
    const ruc = (c.ruc ?? '').replace(/\s+/g, '') || null
    const email = (c.email ?? '').trim().toLowerCase() || null
    const data = {
      Name: c.business_name || c.name || 'Cliente web',
      TaxNumber: ruc,
      Email: c.email ?? null,
      PhoneNumber: c.phone ?? null,
      // Pedidos encolados antes del rediseño traen la dirección en una línea.
      Address: [a.line1, a.line2].filter(Boolean).join(', ') || (a.line1 === undefined ? payload.address ?? null : null),
      City: a.city ?? null,
      PostalCode: a.postal_code ?? null,
      CountryId: countryId(db, a.country_code),
    }

    let found = null
    if (ruc) found = db.prepare("SELECT Id FROM Customer WHERE replace(coalesce(TaxNumber,''),' ','') = ? ORDER BY Id LIMIT 1").get(ruc)
    if (!found && email) found = db.prepare("SELECT Id FROM Customer WHERE lower(trim(coalesce(Email,''))) = ? ORDER BY Id LIMIT 1").get(email)
    // Sin RUC ni email (el email es opcional en la tienda): mismo teléfono y
    // mismo nombre. Solo el teléfono no alcanza: una familia puede compartirlo.
    const phone = phoneKey(c.phone)
    if (!found && !ruc && !email && phone) {
      const name = fold(data.Name)
      found =
        db
          .prepare("SELECT Id, Name, PhoneNumber FROM Customer WHERE trim(coalesce(PhoneNumber, '')) <> '' AND Id <> 1 ORDER BY Id")
          .all()
          .find((r) => phoneKey(r.PhoneNumber) === phone && fold(r.Name) === name) ?? null
    }

    const now = stamp()
    if (found) {
      // Solo lo vacío (incluido el RUC, si lo encontró por email y no tenía).
      const fill = Object.entries(data).filter(([k, v]) => k !== 'Name' && v !== null && v !== '')
      if (fill.length) {
        const sets = fill.map(([k]) => (k === 'CountryId' ? `${k} = coalesce(${k}, ?)` : `${k} = coalesce(nullif(trim(${k}), ''), ?)`))
        const res = db.prepare(`UPDATE Customer SET ${sets.join(', ')} WHERE Id = ?`).run(...fill.map(([, v]) => v), found.Id)
        if (res.changes) db.prepare('UPDATE Customer SET DateUpdated = ? WHERE Id = ?').run(now, found.Id)
      }
      return found.Id
    }
    const res = db
      .prepare(
        `INSERT INTO Customer (Name, TaxNumber, Email, PhoneNumber, Address, City, PostalCode, CountryId, DateCreated, DateUpdated, IsEnabled, IsCustomer, IsSupplier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0)`
      )
      .run(data.Name, data.TaxNumber, data.Email, data.PhoneNumber, data.Address, data.City, data.PostalCode, data.CountryId, now, now)
    return Number(res.lastInsertRowid)
  }

  // ---- Renglones, stock y pagos ---------------------------------------------

  function paymentType(db, method) {
    const name = web.paymentTypes[method ?? ''] ?? web.paymentTypes.bank_transfer
    const find = (n) => findPaymentType(db, n)?.Id ?? null
    // El efectivo se llama "Cash" en el Aronium en inglés y "Efectivo" en el
    // del local: vale cualquiera de los dos si el configurado no está.
    for (const n of [name, ...(method === 'cash_on_delivery' ? ['Efectivo', 'Cash'] : [])]) {
      const id = find(n)
      if (id) return { name: n, id }
    }
    return { name, id: null }
  }

  function product(db, code) {
    return productByCode(db, code, 'p.Id AS Id, p.Name AS Name, p.Cost AS Cost, p.IsService AS IsService')
  }

  /** Servicio de Aronium con este nombre (sin importar mayúsculas ni tildes). */
  function serviceByName(db, name) {
    const key = fold(name)
    if (!key) return null
    const rows = db.prepare('SELECT Id, Name, Cost, IsService FROM Product WHERE IsService = 1 AND IsEnabled = 1').all()
    return rows.find((r) => fold(r.Name) === key) ?? null
  }

  function taxes(db, productId) {
    return db
      .prepare('SELECT t.Id, t.Rate FROM ProductTax pt JOIN Tax t ON t.Id = pt.TaxId WHERE pt.ProductId = ? AND t.IsEnabled = 1 AND t.IsFixed = 0')
      .all(productId)
  }

  /** Un renglón con su impuesto (el precio de la tienda es final, con IVA). */
  function insertItem(db, documentId, prod, quantity, unitPrice, total) {
    const rates = taxes(db, prod.Id)
    const rateSum = rates.reduce((s, t) => s + Number(t.Rate), 0)
    const factor = 1 + rateSum / 100
    const before = money(unitPrice / factor)
    const res = db
      .prepare(
        `INSERT INTO DocumentItem (DocumentId, ProductId, Quantity, ExpectedQuantity, PriceBeforeTax, Price, Discount, DiscountType,
           ProductCost, PriceBeforeTaxAfterDiscount, PriceAfterDiscount, Total, TotalAfterDocumentDiscount, DiscountApplyRule)
         VALUES (?, ?, ?, 0, ?, ?, 0, 0, ?, ?, ?, ?, ?, 0)`
      )
      .run(documentId, prod.Id, quantity, before, unitPrice, Number(prod.Cost) || 0, before, unitPrice, total, total)
    const itemId = Number(res.lastInsertRowid)
    const taxTotal = total - total / factor
    for (const t of rates) {
      db.prepare('INSERT INTO DocumentItemTax (DocumentItemId, TaxId, Amount) VALUES (?, ?, ?)').run(itemId, t.Id, money((taxTotal * Number(t.Rate)) / rateSum))
    }
    return itemId
  }

  /** Copia un renglón (con sus impuestos) de un documento a otro. */
  function copyItem(db, it, documentId) {
    const res = db
      .prepare(
        `INSERT INTO DocumentItem (DocumentId, ProductId, Quantity, ExpectedQuantity, PriceBeforeTax, Price, Discount, DiscountType,
           ProductCost, PriceBeforeTaxAfterDiscount, PriceAfterDiscount, Total, TotalAfterDocumentDiscount, DiscountApplyRule)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(documentId, it.ProductId, it.Quantity, it.PriceBeforeTax, it.Price, it.Discount, it.DiscountType, it.ProductCost, it.PriceBeforeTaxAfterDiscount, it.PriceAfterDiscount, it.Total, it.TotalAfterDocumentDiscount, it.DiscountApplyRule)
    const itemId = Number(res.lastInsertRowid)
    for (const t of db.prepare('SELECT TaxId, Amount FROM DocumentItemTax WHERE DocumentItemId = ?').all(it.Id)) {
      db.prepare('INSERT INTO DocumentItemTax (DocumentItemId, TaxId, Amount) VALUES (?, ?, ?)').run(itemId, t.TaxId, t.Amount)
    }
    return itemId
  }

  /** Suma (o resta) stock del depósito. Devuelve el stock que quedó. */
  function moveStock(db, productId, warehouseId, delta) {
    const res = db.prepare('UPDATE Stock SET Quantity = Quantity + ? WHERE ProductId = ? AND WarehouseId = ?').run(delta, productId, warehouseId)
    if (!res.changes) db.prepare('INSERT INTO Stock (ProductId, WarehouseId, Quantity) VALUES (?, ?, ?)').run(productId, warehouseId, delta)
    return Number(db.prepare('SELECT Quantity FROM Stock WHERE ProductId = ? AND WarehouseId = ?').get(productId, warehouseId)?.Quantity ?? delta)
  }

  function insertPayment(db, documentId, typeId, amount, userId) {
    db.prepare(
      `INSERT INTO Payment (DocumentId, PaymentTypeId, Amount, Date, UserId, ZReportId, DateCreated, RoundingAdjustment)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 0)`
    ).run(documentId, typeId, amount, day(), userId, stamp())
  }

  function insertDocument(db, d) {
    const now = stamp()
    const date = day()
    const res = db
      .prepare(
        `INSERT INTO Document (Number, UserId, CustomerId, OrderNumber, Date, StockDate, Total, IsClockedOut, DocumentTypeId, WarehouseId,
           ReferenceDocumentNumber, DateCreated, DateUpdated, InternalNote, Note, DueDate, Discount, DiscountType, PaidStatus,
           DiscountApplyRule, ServiceType)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        d.number,
        d.userId,
        d.customerId,
        d.orderNumber,
        date,
        now,
        d.total,
        d.typeId,
        d.warehouseId,
        d.reference ?? null,
        now,
        now,
        d.internalNote,
        d.note,
        date,
        d.discount ?? 0,
        d.discountType ?? 0,
        d.paidStatus,
        d.discountApplyRule ?? 0,
        d.serviceType
      )
    return Number(res.lastInsertRowid)
  }

  function appendNote(db, documentId, text) {
    const row = db.prepare('SELECT InternalNote FROM Document WHERE Id = ?').get(documentId)
    const current = String(row?.InternalNote ?? '').replace(/(\r?\n)+$/, '')
    db.prepare('UPDATE Document SET InternalNote = ?, DateUpdated = ? WHERE Id = ?').run(lines(current, text), stamp(), documentId)
  }

  /** Lo que el local necesita ver en la nota interna. */
  function orderInfo(payload) {
    const c = payload.customer ?? {}
    const a = c.address ?? {}
    const address = [a.line1, a.line2, a.city].filter(Boolean).join(', ') || payload.address
    return [
      `Tienda online, pedido #${payload.display_id}`,
      `Cliente: ${[c.name, c.phone, c.email].filter(Boolean).join(' · ')}`,
      c.ruc && `RUC: ${c.ruc}${c.business_name ? ` · ${c.business_name}` : ''}`,
      payload.delivery && `Entrega: ${payload.delivery}${address ? ` · ${address}` : ''}`,
      payload.payment_method && `Pago: ${PAYMENT_NAMES[payload.payment_method] ?? payload.payment_method}`,
      payload.gift && 'Es para regalo',
      payload.notes && `Notas: ${payload.notes}`,
    ]
  }

  /**
   * Documento del pedido web: por número y, si no, por el código PW-. El
   * número solo vale si el documento es de este pedido (mismo código en el
   * número de orden): al restaurar una copia de respaldo de Aronium los números
   * se vuelven a usar, y el de una proforma vieja puede ser el de la de otro
   * pedido.
   */
  function findDoc(db, typeId, { number, code }) {
    if (number) {
      const row = code
        ? db.prepare('SELECT * FROM Document WHERE Number = ? AND DocumentTypeId = ? AND OrderNumber = ?').get(number, typeId, code)
        : db.prepare('SELECT * FROM Document WHERE Number = ? AND DocumentTypeId = ?').get(number, typeId)
      if (row) return row
    }
    if (code) return db.prepare('SELECT * FROM Document WHERE OrderNumber = ? AND DocumentTypeId = ? ORDER BY Id LIMIT 1').get(code, typeId) ?? null
    return null
  }

  // ---- 1. Proforma ----------------------------------------------------------

  /**
   * Escribe la proforma "No pagado".
   * @returns {{ ok: true, quote_number: string, warning?: string }}
   */
  function writeQuote(payload, code) {
    return transaction((db) => {
      const quote = docType(db, QUOTE)

      // ¿Ya está? (el agente se cortó justo después de escribirla)
      const existing = findDoc(db, quote.Id, { code })
      if (existing) return { ok: true, quote_number: existing.Number }

      // Todos los productos tienen que existir en Aronium.
      const items = payload.lines.map((l) => ({ ...l, product: l.sku ? product(db, l.sku) : null }))
      const missing = items.filter((l) => !l.product)
      if (missing.length) {
        throw new AroniumDataError(
          `Estos productos no existen en Aronium: ${missing.map((l) => (l.sku ? `${l.title} (código ${l.sku})` : `${l.title} (sin código)`)).join(', ')}. Creá el código en Aronium o corregí el SKU en la tienda y reintentá.`
        )
      }

      const warnings = []
      const userId = findUser(db, warnings)
      const customerId = upsertCustomer(db, payload)

      // Envío: un renglón con el servicio de Aronium que se llama como la
      // forma de entrega ("Delivery Asunción", "Envío de encomienda (a
      // cobrar)"), o si no con el de webSales.shippingCode. El retiro en el
      // local (sin costo y sin servicio con ese nombre) no lleva renglón.
      let shippingProduct = null
      const shipping = payload.shipping ?? null
      if (shipping) {
        shippingProduct = serviceByName(db, shipping.name)
        if (!shippingProduct && shipping.total > 0) {
          shippingProduct = product(db, web.shippingCode)
          if (!shippingProduct) warnings.push(`No existe el producto "${web.shippingCode}" en Aronium: el envío (${shipping.total}) no está en el total.`)
        }
      }

      const total = items.reduce((s, l) => s + l.total, 0) + (shippingProduct ? shipping.total : 0)
      const number = nextNumber(db, QUOTE)
      const documentId = insertDocument(db, {
        number,
        userId,
        customerId,
        orderNumber: code,
        total,
        typeId: quote.Id,
        warehouseId: config.warehouseId ?? quote.WarehouseId ?? 1,
        reference: '',
        internalNote: lines(`Pedido web ${code}`, ...orderInfo(payload), ...warnings.map((w) => `Aviso: ${w}`)),
        note: `Pedido web ${code}`,
        paidStatus: UNPAID,
        // Como las proformas que hace la caja.
        serviceType: 0,
      })
      for (const l of items) insertItem(db, documentId, l.product, l.quantity, l.unit_price, l.total)
      if (shippingProduct) insertItem(db, documentId, shippingProduct, 1, shipping.total, shipping.total)

      return { ok: true, quote_number: number, ...(warnings.length ? { warning: warnings.join(' ') } : {}) }
    })
  }

  // ---- 2. ¿La marcaron "Pagado"? ----------------------------------------------

  /**
   * Lectura (sin bloquear la caja): estado de la proforma.
   * @returns {{ exists: false } | { exists: true, number: string, paid: boolean, voided: boolean, invoiced: string | null }}
   */
  function quoteStatus(quoteNumber, code) {
    const db = open(true)
    try {
      const quote = db.prepare('SELECT Id FROM DocumentType WHERE Code = ?').get(QUOTE)
      const sale = db.prepare('SELECT Id FROM DocumentType WHERE Code = ?').get(SALE)
      if (!quote) return { exists: false }
      const doc = findDoc(db, quote.Id, { number: quoteNumber, code })
      if (!doc) return { exists: false }
      const invoiced = sale ? db.prepare('SELECT Number FROM Document WHERE OrderNumber = ? AND DocumentTypeId = ?').get(code, sale.Id)?.Number ?? null : null
      return { exists: true, number: doc.Number, paid: Number(doc.PaidStatus) === PAID, voided: /ANULADO/.test(doc.InternalNote ?? ''), invoiced }
    } finally {
      db.close()
    }
  }

  // ---- 3. Venta -------------------------------------------------------------

  /**
   * Una venta hecha a mano en la caja que parece ser este mismo pedido: del
   * mismo cliente (no el consumidor final), creada después de la proforma, con
   * los mismos productos y cantidades.
   */
  function manualDuplicate(db, saleTypeId, quoteDoc, quoteItems) {
    // El consumidor final es el cliente 1 ("Walk-in customer" en inglés,
    // "Unknown" en el local), o el que diga webSales.defaultCustomerName.
    const walkIn = db.prepare('SELECT Id FROM Customer WHERE Name = ? ORDER BY Id LIMIT 1').get(web.defaultCustomerName)?.Id ?? null
    if (!quoteDoc.CustomerId || quoteDoc.CustomerId === walkIn || quoteDoc.CustomerId === 1) return null
    const key = (items) =>
      items
        .map((i) => `${i.ProductId}x${Number(i.Quantity)}`)
        .sort()
        .join(',')
    const wanted = key(quoteItems)
    const candidates = db
      .prepare(
        `SELECT Id, Number FROM Document
         WHERE DocumentTypeId = ? AND CustomerId = ? AND DateCreated >= ? AND coalesce(OrderNumber, '') NOT LIKE 'PW-%'
         ORDER BY Id`
      )
      .all(saleTypeId, quoteDoc.CustomerId, quoteDoc.DateCreated)
    for (const c of candidates) {
      const items = db.prepare('SELECT ProductId, Quantity FROM DocumentItem WHERE DocumentId = ?').all(c.Id)
      if (key(items) === wanted) return c
    }
    return null
  }

  /**
   * La proforma está "Pagado": crea la venta con lo que dice la proforma (lo
   * que acordó la cajera con el cliente), el pago y el stock.
   * @returns {{ ok: true, aronium_number: string, warning?: string }}
   */
  function invoiceQuote(quoteNumber, payload, code) {
    return transaction((db) => {
      const quote = docType(db, QUOTE)
      const sale = docType(db, SALE)

      const existing = findDoc(db, sale.Id, { code })
      if (existing) return { ok: true, aronium_number: existing.Number }

      const q = findDoc(db, quote.Id, { number: quoteNumber, code })
      if (!q) throw new AroniumDataError(`La proforma ${quoteNumber ?? code} ya no existe en Aronium (¿la borraron?). Cargá la venta a mano en la caja.`)
      const items = db.prepare('SELECT * FROM DocumentItem WHERE DocumentId = ? ORDER BY Id').all(q.Id)
      if (!items.length) throw new AroniumDataError(`La proforma ${q.Number} no tiene productos.`)

      const warnings = []
      const duplicate = manualDuplicate(db, sale.Id, q, items)
      if (duplicate) {
        // La cajera ya cargó la venta a mano: no se crea otra.
        appendNote(db, q.Id, `Facturado ${duplicate.Number} (cargada a mano en la caja) · ${human()}`)
        return {
          ok: true,
          aronium_number: duplicate.Number,
          warning: `Posible venta duplicada: la venta ${duplicate.Number} se cargó a mano en la caja con los mismos productos y el mismo cliente; se tomó esa y no se creó otra. Revisá que corresponda a este pedido.`,
        }
      }

      const linesTotal = payload.lines.reduce((s, l) => s + l.total, 0)
      const expected = linesTotal + (payload.shipping?.total ?? 0)
      // Sin servicio de envío en Aronium, la proforma se escribió sin el envío
      // (writeQuote ya lo avisó): eso no es un cambio de la cajera.
      const unchanged = [expected, linesTotal].some((t) => Math.round(Number(q.Total)) === Math.round(t))
      if (!unchanged) {
        warnings.push(`La proforma se cambió en Aronium: total ${Number(q.Total)} en vez de ${expected} del pedido web. La venta se hizo con lo de la proforma.`)
      }

      const pay = paymentType(db, payload.payment_method)
      if (!pay.id) warnings.push(`No existe la forma de pago "${pay.name}" en Aronium: la venta quedó sin pago registrado.`)

      const number = nextNumber(db, SALE)
      const documentId = insertDocument(db, {
        number,
        userId: q.UserId,
        customerId: q.CustomerId,
        orderNumber: code,
        total: q.Total,
        typeId: sale.Id,
        warehouseId: q.WarehouseId,
        reference: null,
        internalNote: lines(`Pedido web ${code} · Proforma ${q.Number}`, ...orderInfo(payload), ...warnings.map((w) => `Aviso: ${w}`)),
        note: `Pedido web ${code}`,
        discount: q.Discount,
        discountType: q.DiscountType,
        discountApplyRule: q.DiscountApplyRule,
        paidStatus: pay.id ? PAID : UNPAID,
        serviceType: saleServiceType(db, sale.Id),
      })
      for (const it of items) {
        copyItem(db, it, documentId)
        const prod = db.prepare('SELECT IsService, Name FROM Product WHERE Id = ?').get(it.ProductId)
        if (prod && !prod.IsService) {
          const left = moveStock(db, it.ProductId, q.WarehouseId, -Number(it.Quantity))
          if (left < 0) warnings.push(`${prod.Name}: Aronium quedó con stock ${left} (se vendió también en la caja).`)
        }
      }
      if (pay.id) insertPayment(db, documentId, pay.id, Number(q.Total), q.UserId)
      appendNote(db, q.Id, `Facturado ${number} · ${human()}`)

      return { ok: true, aronium_number: number, ...(warnings.length ? { warning: warnings.join(' ') } : {}) }
    })
  }

  // ---- Cancelaciones --------------------------------------------------------

  /**
   * Pedido cancelado con la proforma (sin venta) en Aronium: queda anotada
   * ANULADO. Si la cajera la había marcado "Pagado", se avisa.
   * @returns {{ ok: true, warning?: string }}
   */
  function voidQuote(quoteNumber, payload, code) {
    return transaction((db) => {
      const quote = docType(db, QUOTE)
      const q = findDoc(db, quote.Id, { number: quoteNumber, code })
      if (!q) return { ok: true }
      if (!/ANULADO/.test(q.InternalNote ?? '')) appendNote(db, q.Id, `ANULADO: pedido #${payload.display_id} cancelado en la tienda · ${human()}`)
      return Number(q.PaidStatus) === PAID
        ? { ok: true, warning: `La proforma ${q.Number} estaba marcada "Pagado": si el cliente pagó, falta devolverle el dinero.` }
        : { ok: true }
    })
  }

  /** Pedido cancelado en la tienda después de ser venta: devolución. */
  function cancelSale(number, payload, code = payload?.tracking_code) {
    return transaction((db) => {
      const sale = docType(db, SALE)
      const refund = docType(db, REFUND)
      // La venta de este pedido, nunca la de otro con el mismo número (findDoc).
      const original = findDoc(db, sale.Id, { number, code })
      if (!original) throw new AroniumDataError(`No se encontró la venta ${number} en Aronium para devolverla.`)
      const done = db
        .prepare('SELECT Number FROM Document WHERE DocumentTypeId = ? AND ReferenceDocumentNumber = ? AND coalesce(OrderNumber, \'\') = coalesce(?, \'\')')
        .get(refund.Id, original.Number, original.OrderNumber)
      if (done) return { ok: true, refund_number: done.Number }

      const items = db.prepare('SELECT * FROM DocumentItem WHERE DocumentId = ?').all(original.Id)
      const payments = db.prepare('SELECT PaymentTypeId, Amount FROM Payment WHERE DocumentId = ?').all(original.Id)
      const refundNumber = nextNumber(db, REFUND)
      const documentId = insertDocument(db, {
        number: refundNumber,
        userId: original.UserId,
        customerId: original.CustomerId,
        orderNumber: original.OrderNumber,
        total: original.Total,
        typeId: refund.Id,
        warehouseId: original.WarehouseId,
        reference: original.Number,
        internalNote: `Pedido web #${payload.display_id} cancelado en la tienda. Devolución de la venta ${original.Number}.`,
        note: `Devolución pedido web #${payload.display_id}`,
        discount: original.Discount,
        discountType: original.DiscountType,
        discountApplyRule: original.DiscountApplyRule,
        paidStatus: payments.length ? PAID : 0,
        serviceType: original.ServiceType,
      })
      for (const it of items) {
        copyItem(db, it, documentId)
        const prod = db.prepare('SELECT IsService FROM Product WHERE Id = ?').get(it.ProductId)
        if (prod && !prod.IsService) moveStock(db, it.ProductId, original.WarehouseId, Number(it.Quantity))
      }
      // Si la venta estaba pagada, la devolución devuelve la plata (en negativo).
      for (const p of payments) insertPayment(db, documentId, p.PaymentTypeId, -Number(p.Amount), original.UserId)
      // La proforma de origen también queda anotada.
      const quote = docType(db, QUOTE)
      const q = original.OrderNumber ? findDoc(db, quote.Id, { code: original.OrderNumber }) : null
      if (q && !/ANULADO/.test(q.InternalNote ?? '')) appendNote(db, q.Id, `ANULADO: devolución ${refundNumber} · ${human()}`)
      return { ok: true, refund_number: refundNumber }
    })
  }

  return { writeQuote, quoteStatus, invoiceQuote, voidQuote, cancelSale }
}
