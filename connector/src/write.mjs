import { DatabaseSync } from 'node:sqlite'

// Escritura de ventas web en Aronium (docs/sincronizador-aronium.md, 4.2).
//
// Escribe exactamente lo que escribe la caja al cobrar (estudiado en pos.db,
// Aronium Lite 1.52): Document (tipo 200, número siguiente del año), un
// DocumentItem por producto, DocumentItemTax con el impuesto de cada
// producto, Payment si está pagada, Stock (resta) y Counter (numeración).
// Todo en una transacción: entra la venta completa o nada. Antes se fija si
// ya existe una venta con ese número de pedido (WEB-123): nunca la duplica.
//
// Las devoluciones (pedido cancelado en la tienda después de estar en
// Aronium) son un documento tipo 220 que devuelve el stock y hace referencia
// a la venta.
//
// Errores:
// - AroniumDataError: algo que hay que resolver (un código que no existe en
//   Aronium, la venta no está). Se informa al panel.
// - Base ocupada (la caja está grabando): se reintenta en la pasada
//   siguiente sin informar nada (isTransient).

const SALE = '200'
const REFUND = '220'

export class AroniumDataError extends Error {}

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
// 4 decimales, como Aronium (318181,8182): así sus reportes de IVA cuadran.
const money = (n) => Math.round(n * 10000) / 10000

export function createWriter(config) {
  const web = config.webSales

  function open() {
    // timeout: si la caja está grabando, espera hasta 5 s.
    return new DatabaseSync(config.aroniumDb, { timeout: 5000 })
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
   * Usuario de Aronium que figura en la venta web. El historial de ventas de
   * Aronium muestra solo las ventas del usuario con la sesión abierta, así que
   * por defecto es el usuario principal (el activo con más permisos): sus
   * ventas web aparecen en el historial de quien maneja la caja. Con
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
      warnings.push(`No existe el usuario "${web.userName}" en Aronium: la venta quedó a nombre del usuario principal.`)
    }
    const user = main()
    if (!user) throw new AroniumDataError('Aronium no tiene usuarios activos.')
    return user.Id
  }

  function findCustomer(db, payload) {
    const c = payload.customer ?? {}
    const ruc = (c.ruc ?? '').replace(/\s+/g, '')
    if (ruc) {
      // Con RUC: el cliente de Aronium con ese RUC (para la factura), o uno nuevo.
      const found = db.prepare("SELECT Id FROM Customer WHERE replace(coalesce(TaxNumber,''),' ','') = ? ORDER BY Id LIMIT 1").get(ruc)
      if (found) return found.Id
      const now = stamp()
      const res = db
        .prepare(
          `INSERT INTO Customer (Name, TaxNumber, PhoneNumber, Email, DateCreated, DateUpdated, IsEnabled, IsCustomer, IsSupplier)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1, 0)`
        )
        .run(c.business_name || c.name || 'Cliente web', ruc, c.phone ?? null, c.email ?? null, now, now)
      return Number(res.lastInsertRowid)
    }
    // Sin RUC: el consumidor final de Aronium.
    return db.prepare('SELECT Id FROM Customer WHERE Name = ? ORDER BY Id LIMIT 1').get(web.defaultCustomerName)?.Id ?? null
  }

  function paymentType(db, method) {
    const name = web.paymentTypes[method ?? ''] ?? web.paymentTypes.bank_transfer
    const row = db.prepare('SELECT Id FROM PaymentType WHERE IsEnabled = 1 AND lower(Name) = lower(?)').get(name)
    return { name, id: row?.Id ?? null }
  }

  function product(db, code) {
    return db.prepare('SELECT Id, Name, Cost, IsService FROM Product WHERE Code = ?').get(code) ?? null
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

  function internalNote(payload, warnings) {
    const c = payload.customer ?? {}
    const methods = { bank_transfer: 'Transferencia', cash_on_delivery: 'Efectivo al recibir' }
    return [
      `Tienda online, pedido #${payload.display_id}`,
      `Cliente: ${[c.name, c.phone, c.email].filter(Boolean).join(' · ')}`,
      c.ruc && `RUC: ${c.ruc}${c.business_name ? ` · ${c.business_name}` : ''}`,
      payload.delivery && `Entrega: ${payload.delivery}${payload.address ? ` · ${payload.address}` : ''}`,
      payload.payment_method && `Pago: ${methods[payload.payment_method] ?? payload.payment_method}`,
      payload.gift && 'Es para regalo',
      payload.notes && `Notas: ${payload.notes}`,
      ...warnings.map((w) => `Aviso: ${w}`),
    ]
      .filter(Boolean)
      .join('\n')
  }

  /**
   * Escribe la venta. `paid`: el pedido ya está pagado (va con su pago).
   * @returns {{ ok: true, aronium_number: string, payment_registered: boolean, warning?: string }}
   */
  function registerSale(payload, { paid }) {
    return transaction((db) => {
      const sale = docType(db, SALE)
      const orderNumber = `${web.orderPrefix}${payload.display_id}`

      // ¿Ya está? (el agente se cortó justo después de escribirla)
      const existing = db.prepare('SELECT Id, Number FROM Document WHERE OrderNumber = ? AND DocumentTypeId = ?').get(orderNumber, sale.Id)
      if (existing) {
        const payments = db.prepare('SELECT count(*) AS n FROM Payment WHERE DocumentId = ?').get(existing.Id).n
        return { ok: true, aronium_number: existing.Number, payment_registered: payments > 0 }
      }

      // Todos los productos tienen que existir en Aronium.
      const lines = payload.lines.map((l) => ({ ...l, product: l.sku ? product(db, l.sku) : null }))
      const missing = lines.filter((l) => !l.product)
      if (missing.length) {
        throw new AroniumDataError(
          `Estos productos no existen en Aronium: ${missing.map((l) => (l.sku ? `${l.title} (código ${l.sku})` : `${l.title} (sin código)`)).join(', ')}. Creá el código en Aronium o corregí el SKU en la tienda y reintentá.`
        )
      }

      const warnings = []
      const warehouseId = config.warehouseId ?? sale.WarehouseId ?? 1
      const userId = findUser(db, warnings)
      const customerId = findCustomer(db, payload)

      // Envío: un renglón con el producto-servicio de envío, si existe.
      let shippingProduct = null
      const shipping = payload.shipping && payload.shipping.total > 0 ? payload.shipping : null
      if (shipping) {
        shippingProduct = product(db, web.shippingCode)
        if (!shippingProduct) warnings.push(`No existe el producto "${web.shippingCode}" en Aronium: el envío (${shipping.total}) no está en el total.`)
      }

      let pay = null
      if (paid) {
        pay = paymentType(db, payload.payment_method)
        if (!pay.id) {
          warnings.push(`No existe la forma de pago "${pay.name}" en Aronium: la venta quedó impaga.`)
          pay = null
        }
      }

      const total = lines.reduce((s, l) => s + l.total, 0) + (shippingProduct ? shipping.total : 0)
      const number = nextNumber(db, SALE)
      const now = stamp()
      const date = day()
      const doc = db
        .prepare(
          `INSERT INTO Document (Number, UserId, CustomerId, OrderNumber, Date, StockDate, Total, IsClockedOut, DocumentTypeId, WarehouseId,
             ReferenceDocumentNumber, DateCreated, DateUpdated, InternalNote, Note, DueDate, Discount, DiscountType, PaidStatus,
             DiscountApplyRule, ServiceType)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?)`
        )
        .run(
          number,
          userId,
          customerId,
          orderNumber,
          date,
          now,
          total,
          sale.Id,
          warehouseId,
          now,
          now,
          internalNote(payload, warnings),
          `Pedido web #${payload.display_id}`,
          date,
          pay ? 2 : 0,
          web.serviceType
        )
      const documentId = Number(doc.lastInsertRowid)

      for (const l of lines) {
        insertItem(db, documentId, l.product, l.quantity, l.unit_price, l.total)
        if (!l.product.IsService) {
          const left = moveStock(db, l.product.Id, warehouseId, -l.quantity)
          if (left < 0) warnings.push(`${l.title}: Aronium quedó con stock ${left} (se vendió también en la caja).`)
        }
      }
      if (shippingProduct) insertItem(db, documentId, shippingProduct, 1, shipping.total, shipping.total)
      if (pay) insertPayment(db, documentId, pay.id, total, userId)

      // Los avisos que surgieron al final también van a la nota interna.
      if (warnings.length) db.prepare('UPDATE Document SET InternalNote = ? WHERE Id = ?').run(internalNote(payload, warnings), documentId)

      return { ok: true, aronium_number: number, payment_registered: Boolean(pay), ...(warnings.length ? { warning: warnings.join(' ') } : {}) }
    })
  }

  /** La venta ya está en Aronium y ahora se pagó: agrega el pago. */
  function addPayment(number, payload) {
    return transaction((db) => {
      const sale = docType(db, SALE)
      const doc = db.prepare('SELECT Id, Total, UserId FROM Document WHERE Number = ? AND DocumentTypeId = ?').get(number, sale.Id)
      if (!doc) throw new AroniumDataError(`No se encontró la venta ${number} en Aronium.`)
      const payments = db.prepare('SELECT count(*) AS n FROM Payment WHERE DocumentId = ?').get(doc.Id).n
      if (payments > 0) return { ok: true }
      const pay = paymentType(db, payload.payment_method)
      if (!pay.id) throw new AroniumDataError(`No existe la forma de pago "${pay.name}" en Aronium. Creala y el pago se registra solo.`)
      insertPayment(db, doc.Id, pay.id, Number(doc.Total), doc.UserId)
      db.prepare('UPDATE Document SET PaidStatus = 2, DateUpdated = ? WHERE Id = ?').run(stamp(), doc.Id)
      return { ok: true }
    })
  }

  /** Pedido cancelado en la tienda después de estar en Aronium: devolución. */
  function cancelSale(number, payload) {
    return transaction((db) => {
      const sale = docType(db, SALE)
      const refund = docType(db, REFUND)
      const original = db.prepare('SELECT * FROM Document WHERE Number = ? AND DocumentTypeId = ?').get(number, sale.Id)
      if (!original) throw new AroniumDataError(`No se encontró la venta ${number} en Aronium para devolverla.`)
      const done = db.prepare('SELECT Number FROM Document WHERE DocumentTypeId = ? AND ReferenceDocumentNumber = ?').get(refund.Id, number)
      if (done) return { ok: true, refund_number: done.Number }

      const items = db.prepare('SELECT * FROM DocumentItem WHERE DocumentId = ?').all(original.Id)
      const payments = db.prepare('SELECT PaymentTypeId, Amount FROM Payment WHERE DocumentId = ?').all(original.Id)
      const refundNumber = nextNumber(db, REFUND)
      const now = stamp()
      const date = day()
      const doc = db
        .prepare(
          `INSERT INTO Document (Number, UserId, CustomerId, OrderNumber, Date, StockDate, Total, IsClockedOut, DocumentTypeId, WarehouseId,
             ReferenceDocumentNumber, DateCreated, DateUpdated, InternalNote, Note, DueDate, Discount, DiscountType, PaidStatus,
             DiscountApplyRule, ServiceType)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?)`
        )
        .run(
          refundNumber,
          original.UserId,
          original.CustomerId,
          original.OrderNumber,
          date,
          now,
          original.Total,
          refund.Id,
          original.WarehouseId,
          number,
          now,
          now,
          `Pedido web #${payload.display_id} cancelado en la tienda. Devolución de la venta ${number}.`,
          `Devolución pedido web #${payload.display_id}`,
          date,
          payments.length ? 2 : 0,
          original.ServiceType
        )
      const documentId = Number(doc.lastInsertRowid)
      for (const it of items) {
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
        const prod = db.prepare('SELECT IsService FROM Product WHERE Id = ?').get(it.ProductId)
        if (prod && !prod.IsService) moveStock(db, it.ProductId, original.WarehouseId, Number(it.Quantity))
      }
      // Si la venta estaba pagada, la devolución devuelve la plata (en negativo).
      for (const p of payments) insertPayment(db, documentId, p.PaymentTypeId, -Number(p.Amount), original.UserId)
      return { ok: true, refund_number: refundNumber }
    })
  }

  return { registerSale, addPayment, cancelSale }
}
