// Pruebas del escritor de pedidos web sobre una COPIA de pos.db (nunca la base
// real). Uso:
//   node --test test/                      (copia la base de Aronium de esta PC)
//   ARONIUM_TEST_DB=C:/ruta/pos.db node --test test/
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, it } from 'node:test'
import { checkSchema } from '../src/schema.mjs'
import { AroniumDataError, createWriter, isTransient, PAID, UNPAID } from '../src/write.mjs'

const SOURCE = process.env.ARONIUM_TEST_DB ?? path.join(process.env.LOCALAPPDATA ?? '', 'Aronium', 'Data', 'pos.db')
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aronium-test-'))
const DB = path.join(DIR, 'pos.db')

const config = {
  aroniumDb: DB,
  warehouseId: null,
  webSales: {
    enabled: true,
    userName: '',
    defaultCustomerName: 'Walk-in customer',
    paymentTypes: { bank_transfer: 'Transferencia', cash_on_delivery: 'Cash' },
    shippingCode: 'ENVIO',
    serviceType: 0,
  },
}

let db
const q = (sql, ...args) => db.prepare(sql).all(...args)
const one = (sql, ...args) => db.prepare(sql).get(...args)
const stockOf = (code) => Number(one('SELECT sum(s.Quantity) AS q FROM Stock s JOIN Product p ON p.Id = s.ProductId WHERE p.Code = ?', code).q ?? 0)
const mainUser = () => one('SELECT Id FROM User WHERE IsEnabled = 1 ORDER BY AccessLevel DESC, Id LIMIT 1').Id
const counter = (type) => Number(one('SELECT Value FROM Counter WHERE Name = ?', `Document.${type}.${new Date().getFullYear()}`)?.Value ?? 0)
const code = (id) => `PW-${id}-TT`

const CUSTOMER = {
  name: 'Cliente Prueba',
  phone: '0981 123 456',
  email: 'prueba@example.com',
  ruc: null,
  business_name: null,
  address: { line1: 'Av. Mcal. López 1234', line2: 'Piso 2', city: 'Asunción', postal_code: null, country_code: 'PY' },
}

function payload(display_id, lines, extra = {}) {
  return {
    order_id: `order_test_${display_id}`,
    display_id,
    tracking_code: code(display_id),
    created_at: new Date().toISOString(),
    currency: 'PYG',
    total: lines.reduce((s, l) => s + l.total, 0) + (extra.shipping?.total ?? 0),
    payment_method: 'bank_transfer',
    delivery: 'Retiro en el local',
    customer: CUSTOMER,
    address: 'Av. Mcal. López 1234, Piso 2, Asunción',
    notes: null,
    gift: false,
    lines: lines.map((l, i) => ({ line_item_id: `li_${display_id}_${i}`, title: `Producto ${l.sku}`, ...l })),
    shipping: null,
    ...extra,
  }
}

before(() => {
  assert.ok(fs.existsSync(SOURCE), `No existe la base de prueba ${SOURCE}`)
  fs.copyFileSync(SOURCE, DB)
  db = new DatabaseSync(DB)
  // Punto de partida fijo, tenga lo que tenga la base copiada (en la copia,
  // nunca en la real):
  // - forma de pago "Transferencia";
  // - IVA 10 % solo en el producto 2;
  // - producto-servicio de envío "ENVIO";
  // - sin clientes de prueba de pasadas anteriores.
  if (!one("SELECT Id FROM PaymentType WHERE lower(Name) = 'transferencia'")) {
    db.exec("INSERT INTO PaymentType (Name, IsCustomerRequired, IsFiscal, IsSlipRequired, IsChangeAllowed, Ordinal, IsEnabled, IsQuickPayment, OpenCashDrawer, MarkAsPaid) VALUES ('Transferencia', 0, 1, 0, 0, 9, 1, 0, 0, 1)")
  }
  // - productos con códigos 1 a 4 (la base del local no los tiene: se los
  //   pone a productos con stock);
  for (const c of ['1', '2', '3', '4']) {
    if (!one('SELECT Id FROM Product WHERE Code = ?', c)) {
      db.prepare("UPDATE Product SET Code = ? WHERE Id = (SELECT p.Id FROM Product p JOIN Stock s ON s.ProductId = p.Id WHERE p.IsService = 0 AND p.Code NOT IN ('1', '2', '3', '4') GROUP BY p.Id HAVING sum(s.Quantity) >= 10 ORDER BY p.Id LIMIT 1)").run(c)
    }
  }
  db.exec('DELETE FROM ProductTax')
  db.exec("INSERT INTO Tax (Name, Rate, IsFixed, IsTaxOnTotal, IsEnabled) VALUES ('IVA 10% prueba', 10, 0, 0, 1)")
  const taxId = one('SELECT max(Id) AS id FROM Tax').id
  db.prepare("INSERT INTO ProductTax (ProductId, TaxId) VALUES ((SELECT Id FROM Product WHERE Code = '2'), ?)").run(taxId)
  db.exec("DELETE FROM Product WHERE Code = 'ENVIO' AND Id NOT IN (SELECT ProductId FROM DocumentItem)")
  db.exec("UPDATE Product SET Code = 'ENVIO-viejo' WHERE Code = 'ENVIO'")
  db.exec("INSERT INTO Product (Name, Code, Price, IsTaxInclusivePrice, IsPriceChangeAllowed, IsService, IsUsingDefaultQuantity, IsEnabled, Cost, Markup, Color) VALUES ('Envío', 'ENVIO', 0, 1, 1, 1, 1, 1, 0, 0, 'Transparent')")
  db.exec("UPDATE Customer SET TaxNumber = NULL, Email = NULL WHERE TaxNumber = '80012345-6' OR Email LIKE '%@example.com'")
})

after(() => {
  db?.close()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('pedido web → proforma → venta (sobre una copia de pos.db)', () => {
  const writer = createWriter(config)
  const docs = () => one('SELECT count(*) AS n FROM Document').n
  const byNumber = (n) => one('SELECT * FROM Document WHERE Number = ?', n)
  const markPaid = (n) => db.prepare('UPDATE Document SET PaidStatus = 2 WHERE Number = ?').run(n)
  let quoteNumber
  let saleNumber

  it('la base es una versión conocida', () => {
    assert.deepEqual(checkSchema(DB), { ok: true })
  })

  it('escribe la proforma "No pagado" sin tocar el stock, y registra al cliente', () => {
    const before = { stock: stockOf('3'), quotes: counter('230') }
    const r = writer.writeQuote(payload(9001, [{ sku: '3', quantity: 2, unit_price: 20000, total: 40000 }]), code(9001))
    quoteNumber = r.quote_number
    assert.equal(r.ok, true)
    assert.equal(r.warning, undefined)
    assert.match(r.quote_number, /^\d{2}-230-\d{6}$/)
    assert.equal(counter('230'), before.quotes + 1)
    assert.equal(stockOf('3'), before.stock)
    const doc = byNumber(r.quote_number)
    assert.equal(doc.DocumentTypeId, one("SELECT Id FROM DocumentType WHERE Code = '230'").Id)
    assert.equal(doc.PaidStatus, UNPAID)
    assert.equal(doc.OrderNumber, code(9001))
    assert.equal(doc.Total, 40000)
    assert.equal(doc.UserId, mainUser())
    assert.match(doc.InternalNote, /^Pedido web PW-9001-TT\r\nTienda online, pedido #9001\r\nCliente: Cliente Prueba/)
    assert.equal(q('SELECT * FROM DocumentItem WHERE DocumentId = ?', doc.Id).length, 1)
    // Cliente nuevo (sin RUC: por email), con dirección, ciudad y país.
    const c = one('SELECT * FROM Customer WHERE Id = ?', doc.CustomerId)
    assert.equal(c.Name, 'Cliente Prueba')
    assert.equal(c.Email, 'prueba@example.com')
    assert.equal(c.Address, 'Av. Mcal. López 1234, Piso 2')
    assert.equal(c.City, 'Asunción')
    assert.equal(c.CountryId, one("SELECT Id FROM Country WHERE Code = 'PY'").Id)
  })

  it('no duplica la proforma ni el cliente', () => {
    const before = { docs: docs(), customers: one('SELECT count(*) AS n FROM Customer').n }
    const r = writer.writeQuote(payload(9001, [{ sku: '3', quantity: 2, unit_price: 20000, total: 40000 }]), code(9001))
    assert.equal(r.quote_number, quoteNumber)
    assert.equal(docs(), before.docs)
    // Otro pedido del mismo email usa el mismo cliente.
    const r2 = writer.writeQuote(payload(9010, [{ sku: '4', quantity: 1, unit_price: 5000, total: 5000 }]), code(9010))
    assert.equal(one('SELECT count(*) AS n FROM Customer').n, before.customers)
    assert.equal(byNumber(r2.quote_number).CustomerId, byNumber(quoteNumber).CustomerId)
  })

  it('ve si la cajera la marcó "Pagado"', () => {
    assert.deepEqual({ ...writer.quoteStatus(quoteNumber, code(9001)) }, { exists: true, number: quoteNumber, paid: false, voided: false, invoiced: null })
    markPaid(quoteNumber)
    assert.equal(writer.quoteStatus(quoteNumber, code(9001)).paid, true)
    // También la encuentra solo por el código.
    assert.equal(writer.quoteStatus(null, code(9001)).number, quoteNumber)
    assert.deepEqual(writer.quoteStatus('26-230-999999', 'PW-0-XX'), { exists: false })
  })

  it('pagada: crea la venta con el pago y el stock, y anota la proforma (una sola vez)', () => {
    const before = { stock: stockOf('3'), sales: counter('200') }
    const r = writer.invoiceQuote(quoteNumber, payload(9001, [{ sku: '3', quantity: 2, unit_price: 20000, total: 40000 }]), code(9001))
    saleNumber = r.aronium_number
    assert.match(r.aronium_number, /^\d{2}-200-\d{6}$/)
    assert.equal(r.warning, undefined)
    assert.equal(counter('200'), before.sales + 1)
    assert.equal(stockOf('3'), before.stock - 2)
    const sale = byNumber(r.aronium_number)
    const quote = byNumber(quoteNumber)
    assert.equal(sale.PaidStatus, PAID)
    assert.equal(sale.OrderNumber, code(9001))
    assert.equal(sale.CustomerId, quote.CustomerId)
    assert.equal(sale.Total, 40000)
    assert.ok(sale.InternalNote.startsWith(`Pedido web PW-9001-TT · Proforma ${quoteNumber}`))
    const pay = one('SELECT pt.Name, p.Amount FROM Payment p JOIN PaymentType pt ON pt.Id = p.PaymentTypeId WHERE p.DocumentId = ?', sale.Id)
    assert.deepEqual({ ...pay }, { Name: 'Transferencia', Amount: 40000 })
    assert.ok(quote.InternalNote.includes(`Facturado ${r.aronium_number}`))
    assert.equal(writer.quoteStatus(quoteNumber, code(9001)).invoiced, r.aronium_number)

    const again = writer.invoiceQuote(quoteNumber, payload(9001, []), code(9001))
    assert.equal(again.aronium_number, saleNumber)
    assert.equal(stockOf('3'), before.stock - 2)
  })

  it('con RUC, IVA y envío; un cliente que ya existe solo completa lo vacío', () => {
    db.prepare(
      "INSERT INTO Customer (Name, TaxNumber, PhoneNumber, DateCreated, DateUpdated, IsEnabled, IsCustomer, IsSupplier) VALUES ('Pérez (cargado en la caja)', '80012345-6', '021 555', '2026-01-01', '2026-01-01', 1, 1, 0)"
    ).run()
    const p = payload(9002, [{ sku: '2', quantity: 1, unit_price: 1100000, total: 1100000 }], {
      customer: { ...CUSTOMER, name: 'Juan Pérez', phone: '0981 000 000', email: 'juan@example.com', ruc: '80012345-6', business_name: 'Pérez SA' },
      shipping: { name: 'Envío a domicilio', total: 30000 },
    })
    const r = writer.writeQuote(p, code(9002))
    const doc = byNumber(r.quote_number)
    assert.equal(doc.Total, 1130000)
    const c = one('SELECT * FROM Customer WHERE Id = ?', doc.CustomerId)
    assert.equal(c.Name, 'Pérez (cargado en la caja)')
    assert.equal(c.PhoneNumber, '021 555')
    assert.equal(c.Email, 'juan@example.com')
    assert.equal(c.City, 'Asunción')
    const items = q('SELECT di.*, p.Code FROM DocumentItem di JOIN Product p ON p.Id = di.ProductId WHERE DocumentId = ? ORDER BY di.Id', doc.Id)
    assert.deepEqual(
      items.map((i) => i.Code),
      ['2', 'ENVIO']
    )
    // IVA incluido: 1.100.000 / 1,1 = 1.000.000 antes de impuesto, 100.000 de IVA.
    assert.equal(items[0].PriceBeforeTax, 1000000)
    assert.equal(one('SELECT Amount FROM DocumentItemTax WHERE DocumentItemId = ?', items[0].Id).Amount, 100000)
    // La venta copia los impuestos de la proforma.
    markPaid(r.quote_number)
    const s = writer.invoiceQuote(r.quote_number, p, code(9002))
    const sale = byNumber(s.aronium_number)
    const saleItems = q('SELECT * FROM DocumentItem WHERE DocumentId = ? ORDER BY Id', sale.Id)
    assert.equal(one('SELECT Amount FROM DocumentItemTax WHERE DocumentItemId = ?', saleItems[0].Id).Amount, 100000)
    assert.equal(one('SELECT Amount FROM Payment WHERE DocumentId = ?', sale.Id).Amount, 1130000)
  })

  it('efectivo al recibir: la venta lleva el pago en efectivo', () => {
    const p = payload(9011, [{ sku: '4', quantity: 1, unit_price: 5000, total: 5000 }], { payment_method: 'cash_on_delivery' })
    const r = writer.writeQuote(p, code(9011))
    assert.match(byNumber(r.quote_number).InternalNote, /Pago: Efectivo al recibir/)
    markPaid(r.quote_number)
    const s = writer.invoiceQuote(r.quote_number, p, code(9011))
    assert.equal(s.warning, undefined)
    const pay = one('SELECT pt.Name, p.Amount FROM Payment p JOIN PaymentType pt ON pt.Id = p.PaymentTypeId WHERE p.DocumentId = ?', byNumber(s.aronium_number).Id)
    // "Cash" en el Aronium en inglés, "Efectivo" en el del local.
    assert.match(pay.Name, /^(Cash|Efectivo)$/)
    assert.equal(pay.Amount, 5000)
  })

  it('sin producto de envío en Aronium: la proforma sale sin el envío y la venta no avisa un cambio que no hubo', () => {
    const noShipping = createWriter({ ...config, webSales: { ...config.webSales, shippingCode: 'NO-EXISTE' } })
    const p = payload(9020, [{ sku: '1', quantity: 1, unit_price: 5000, total: 5000 }], { shipping: { name: 'Envío sin servicio', total: 15000 } })
    const r = noShipping.writeQuote(p, code(9020))
    assert.match(r.warning, /No existe el producto "NO-EXISTE"/)
    assert.equal(byNumber(r.quote_number).Total, 5000)
    markPaid(r.quote_number)
    const s = noShipping.invoiceQuote(r.quote_number, p, code(9020))
    assert.doesNotMatch(s.warning ?? '', /se cambió/)
    assert.equal(byNumber(s.aronium_number).Total, 5000)
  })

  it('producto sin código (por su código de barras) y delivery con el servicio de esa ciudad', () => {
    db.exec("INSERT INTO Product (Name, Code, Price, IsTaxInclusivePrice, IsPriceChangeAllowed, IsService, IsUsingDefaultQuantity, IsEnabled, Cost, Markup, Color) VALUES ('Perfume sin código (prueba)', NULL, 300000, 1, 0, 0, 1, 1, 0, 0, 'Transparent')")
    const perfume = one('SELECT max(Id) AS id FROM Product').id
    db.prepare("INSERT INTO Barcode (ProductId, Value) VALUES (?, '7790000999991')").run(perfume)
    db.exec("INSERT INTO Product (Name, Code, Price, IsTaxInclusivePrice, IsPriceChangeAllowed, IsService, IsUsingDefaultQuantity, IsEnabled, Cost, Markup, Color) VALUES ('Delivery Ciudad de Prueba', NULL, 15000, 1, 1, 1, 1, 1, 0, 0, 'Transparent')")
    const delivery = one('SELECT max(Id) AS id FROM Product').id
    const p = payload(9012, [{ sku: '7790000999991', quantity: 1, unit_price: 300000, total: 300000 }], {
      shipping: { name: 'Delivery Ciudad de Prueba', total: 15000 },
    })
    const r = writer.writeQuote(p, code(9012))
    assert.equal(r.warning, undefined)
    const doc = byNumber(r.quote_number)
    assert.equal(doc.Total, 315000)
    const items = q('SELECT ProductId, Total FROM DocumentItem WHERE DocumentId = ? ORDER BY Id', doc.Id)
    assert.deepEqual(
      items.map((i) => [i.ProductId, i.Total]),
      [
        [perfume, 300000],
        [delivery, 15000],
      ]
    )
  })

  it('encomienda a cobrar (sin costo): renglón con el servicio de Aronium; retiro: sin renglón', () => {
    db.exec("INSERT INTO Product (Name, Code, Price, IsTaxInclusivePrice, IsPriceChangeAllowed, IsService, IsUsingDefaultQuantity, IsEnabled, Cost, Markup, Color) VALUES ('Envío de encomienda (a cobrar) prueba', NULL, 0, 1, 1, 1, 1, 1, 0, 0, 'Transparent')")
    const encomienda = one('SELECT max(Id) AS id FROM Product').id
    const sent = writer.writeQuote(
      payload(9013, [{ sku: '4', quantity: 1, unit_price: 5000, total: 5000 }], { shipping: { name: 'Envio de encomienda (a cobrar) prueba', total: 0 } }),
      code(9013)
    )
    const sentItems = q('SELECT ProductId FROM DocumentItem WHERE DocumentId = ?', byNumber(sent.quote_number).Id)
    assert.deepEqual(sentItems.map((i) => i.ProductId).slice(1), [encomienda])
    const pickup = writer.writeQuote(
      payload(9014, [{ sku: '4', quantity: 1, unit_price: 5000, total: 5000 }], { shipping: { name: 'Retiro en el local', total: 0 } }),
      code(9014)
    )
    assert.equal(q('SELECT Id FROM DocumentItem WHERE DocumentId = ?', byNumber(pickup.quote_number).Id).length, 1)
  })

  it('si la cajera cambió la proforma, la venta sale con lo de la proforma y avisa', () => {
    const p = payload(9003, [{ sku: '4', quantity: 2, unit_price: 5000, total: 10000 }])
    const r = writer.writeQuote(p, code(9003))
    const doc = byNumber(r.quote_number)
    db.prepare('UPDATE DocumentItem SET Quantity = 1, Total = 5000, TotalAfterDocumentDiscount = 5000 WHERE DocumentId = ?').run(doc.Id)
    db.prepare('UPDATE Document SET Total = 5000, PaidStatus = 2 WHERE Id = ?').run(doc.Id)
    const before = stockOf('4')
    const s = writer.invoiceQuote(r.quote_number, p, code(9003))
    assert.match(s.warning, /La proforma se cambió en Aronium: total 5000 en vez de 10000/)
    assert.equal(byNumber(s.aronium_number).Total, 5000)
    assert.equal(stockOf('4'), before - 1)
  })

  it('si la cajera ya cargó la venta a mano, no crea otra y avisa', () => {
    const p = payload(9004, [{ sku: '4', quantity: 1, unit_price: 5000, total: 5000 }], {
      customer: { ...CUSTOMER, name: 'María Gómez', email: 'maria@example.com' },
    })
    const r = writer.writeQuote(p, code(9004))
    const quote = byNumber(r.quote_number)
    // Venta hecha a mano en la caja: mismo cliente y productos, después de la proforma.
    db.prepare(
      `INSERT INTO Document (Number, UserId, CustomerId, OrderNumber, Date, StockDate, Total, IsClockedOut, DocumentTypeId, WarehouseId, DateCreated, DateUpdated, DueDate, Discount, DiscountType, PaidStatus, DiscountApplyRule, ServiceType)
       VALUES ('26-200-777777', ?, ?, NULL, '2026-11-18', '2026-11-18', 5000, 0, (SELECT Id FROM DocumentType WHERE Code = '200'), 1, '2099-01-01', '2099-01-01', '2026-11-18', 0, 0, 2, 0, 1)`
    ).run(quote.UserId, quote.CustomerId)
    db.prepare(
      "INSERT INTO DocumentItem (DocumentId, ProductId, Quantity, ExpectedQuantity, PriceBeforeTax, Price, Discount, DiscountType, ProductCost, PriceBeforeTaxAfterDiscount, PriceAfterDiscount, Total, TotalAfterDocumentDiscount, DiscountApplyRule) VALUES ((SELECT Id FROM Document WHERE Number = '26-200-777777'), (SELECT Id FROM Product WHERE Code = '4'), 1, 0, 5000, 5000, 0, 0, 0, 5000, 5000, 5000, 5000, 0)"
    ).run()
    markPaid(r.quote_number)
    const before = { stock: stockOf('4'), docs: docs() }
    const s = writer.invoiceQuote(r.quote_number, p, code(9004))
    assert.equal(s.aronium_number, '26-200-777777')
    assert.match(s.warning, /Posible venta duplicada/)
    assert.equal(docs(), before.docs)
    assert.equal(stockOf('4'), before.stock)
  })

  it('si falta un producto en Aronium no escribe nada', () => {
    const before = { docs: docs(), counter: counter('230'), customers: one('SELECT count(*) AS n FROM Customer').n }
    assert.throws(
      () =>
        writer.writeQuote(
          payload(9005, [{ sku: '1', quantity: 1, unit_price: 350000, total: 350000 }, { sku: 'NO-EXISTE', quantity: 1, unit_price: 1, total: 1 }], {
            customer: { ...CUSTOMER, email: 'nuevo@example.com' },
          }),
          code(9005)
        ),
      (e) => e instanceof AroniumDataError && /NO-EXISTE/.test(e.message)
    )
    assert.equal(docs(), before.docs)
    assert.equal(counter('230'), before.counter)
    assert.equal(one('SELECT count(*) AS n FROM Customer').n, before.customers)
  })

  it('si borraron la proforma, la venta da un error para resolver', () => {
    const r = writer.writeQuote(payload(9006, [{ sku: '4', quantity: 1, unit_price: 5000, total: 5000 }]), code(9006))
    const id = byNumber(r.quote_number).Id
    db.prepare('DELETE FROM DocumentItemTax WHERE DocumentItemId IN (SELECT Id FROM DocumentItem WHERE DocumentId = ?)').run(id)
    db.prepare('DELETE FROM DocumentItem WHERE DocumentId = ?').run(id)
    db.prepare('DELETE FROM Document WHERE Id = ?').run(id)
    assert.equal(writer.quoteStatus(r.quote_number, code(9006)).exists, false)
    assert.throws(
      () => writer.invoiceQuote(r.quote_number, payload(9006, []), code(9006)),
      (e) => e instanceof AroniumDataError && /ya no existe/.test(e.message)
    )
  })

  it('cancelado antes de pagar: la proforma queda ANULADO (una sola vez)', () => {
    const r = writer.writeQuote(payload(9007, [{ sku: '4', quantity: 1, unit_price: 5000, total: 5000 }]), code(9007))
    const before = stockOf('4')
    assert.deepEqual({ ...writer.voidQuote(r.quote_number, payload(9007, []), code(9007)) }, { ok: true })
    writer.voidQuote(r.quote_number, payload(9007, []), code(9007))
    assert.equal(byNumber(r.quote_number).InternalNote.match(/ANULADO/g).length, 1)
    assert.equal(stockOf('4'), before)
    assert.equal(writer.quoteStatus(r.quote_number, code(9007)).voided, true)
    // Si ya estaba marcada "Pagado", avisa.
    const r2 = writer.writeQuote(payload(9008, [{ sku: '4', quantity: 1, unit_price: 5000, total: 5000 }]), code(9008))
    markPaid(r2.quote_number)
    assert.match(writer.voidQuote(r2.quote_number, payload(9008, []), code(9008)).warning, /estaba marcada "Pagado"/)
  })

  it('cancelado después de la venta: devolución con stock y plata, y la proforma ANULADO', () => {
    const before = stockOf('3')
    const r = writer.cancelSale(saleNumber, payload(9001, []))
    assert.match(r.refund_number, /^\d{2}-220-\d{6}$/)
    assert.equal(stockOf('3'), before + 2)
    const refund = byNumber(r.refund_number)
    assert.equal(refund.ReferenceDocumentNumber, saleNumber)
    assert.equal(refund.OrderNumber, code(9001))
    assert.equal(one('SELECT sum(Amount) AS a FROM Payment WHERE DocumentId = ?', refund.Id).a, -40000)
    assert.match(byNumber(quoteNumber).InternalNote, /ANULADO: devolución/)
    const again = writer.cancelSale(saleNumber, payload(9001, []))
    assert.equal(again.refund_number, r.refund_number)
    assert.equal(stockOf('3'), before + 2)
  })

  it('números repetidos (copia de respaldo restaurada): nunca toma la proforma ni la venta de otro pedido', () => {
    // El pedido 9031 tenía la proforma N; se restauró una copia de Aronium y
    // ahora N es la proforma de otro pedido (9030).
    const p30 = payload(9030, [{ sku: '1', quantity: 1, unit_price: 5000, total: 5000 }])
    const other = writer.writeQuote(p30, code(9030))
    markPaid(other.quote_number)
    assert.deepEqual(writer.quoteStatus(other.quote_number, code(9031)), { exists: false })
    const docsBefore = docs()
    assert.throws(
      () => writer.invoiceQuote(other.quote_number, payload(9031, [{ sku: '4', quantity: 1, unit_price: 5000, total: 5000 }]), code(9031)),
      (e) => e instanceof AroniumDataError && /ya no existe/.test(e.message)
    )
    assert.equal(docs(), docsBefore)
    // Anular el 9031 no anota la proforma del 9030.
    writer.voidQuote(other.quote_number, payload(9031, []), code(9031))
    assert.doesNotMatch(byNumber(other.quote_number).InternalNote, /ANULADO/)
    // La devolución del 9031 no devuelve la venta del 9030.
    const sale30 = writer.invoiceQuote(other.quote_number, p30, code(9030))
    assert.throws(
      () => writer.cancelSale(sale30.aronium_number, payload(9031, [])),
      (e) => e instanceof AroniumDataError && /No se encontró la venta/.test(e.message)
    )
    assert.equal(one('SELECT count(*) AS n FROM Document WHERE ReferenceDocumentNumber = ?', sale30.aronium_number).n, 0)
  })

  it('si la caja está grabando, es un error pasajero (se reintenta)', () => {
    const lock = new DatabaseSync(DB)
    lock.exec('BEGIN IMMEDIATE')
    try {
      assert.throws(
        () => writer.writeQuote(payload(9009, [{ sku: '4', quantity: 1, unit_price: 5000, total: 5000 }]), code(9009)),
        (e) => isTransient(e)
      )
    } finally {
      lock.exec('ROLLBACK')
      lock.close()
    }
  })

  it('una versión de Aronium que cambió la base bloquea la escritura', () => {
    const other = path.join(DIR, 'otra-version.db')
    fs.copyFileSync(DB, other)
    const odb = new DatabaseSync(other)
    odb.exec('ALTER TABLE Document DROP COLUMN Note')
    odb.close()
    const r = checkSchema(other)
    assert.equal(r.ok, false)
    assert.match(r.reason, /Document sin Note/)
  })
})
