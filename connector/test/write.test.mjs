// Pruebas del escritor de ventas web sobre una COPIA de pos.db (nunca la base
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
import { AroniumDataError, createWriter, isTransient } from '../src/write.mjs'

const SOURCE = process.env.ARONIUM_TEST_DB ?? path.join(process.env.LOCALAPPDATA ?? '', 'Aronium', 'Data', 'pos.db')
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aronium-test-'))
const DB = path.join(DIR, 'pos.db')

const config = {
  aroniumDb: DB,
  warehouseId: null,
  webSales: {
    enabled: true,
    orderPrefix: 'WEB-',
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
const counter = () => Number(one("SELECT Value FROM Counter WHERE Name = ?", `Document.200.${new Date().getFullYear()}`)?.Value ?? 0)

function payload(display_id, lines, extra = {}) {
  return {
    order_id: `order_test_${display_id}`,
    display_id,
    created_at: new Date().toISOString(),
    currency: 'PYG',
    total: lines.reduce((s, l) => s + l.total, 0) + (extra.shipping?.total ?? 0),
    payment_method: 'bank_transfer',
    delivery: 'Retiro en el local',
    customer: { name: 'Cliente Prueba', phone: '0981 123 456', email: 'prueba@example.com', ruc: null, business_name: null },
    address: null,
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
  // - un usuario principal de prueba (el de más permisos);
  // - forma de pago "Transferencia";
  // - IVA 10 % solo en el producto 2;
  // - producto-servicio de envío "ENVIO".
  db.exec("UPDATE User SET FirstName = 'Cajero', LastName = '', Username = NULL WHERE lower(trim(coalesce(FirstName,'') || ' ' || coalesce(LastName,''))) = 'tienda web' OR lower(trim(coalesce(FirstName,''))) = 'tienda web' OR lower(coalesce(Username,'')) = 'tienda web'")
  if (!one("SELECT Id FROM PaymentType WHERE lower(Name) = 'transferencia'")) {
    db.exec("INSERT INTO PaymentType (Name, IsCustomerRequired, IsFiscal, IsSlipRequired, IsChangeAllowed, Ordinal, IsEnabled, IsQuickPayment, OpenCashDrawer, MarkAsPaid) VALUES ('Transferencia', 0, 1, 0, 0, 9, 1, 0, 0, 1)")
  }
  db.exec('DELETE FROM ProductTax')
  db.exec("INSERT INTO Tax (Name, Rate, IsFixed, IsTaxOnTotal, IsEnabled) VALUES ('IVA 10% prueba', 10, 0, 0, 1)")
  const taxId = one('SELECT max(Id) AS id FROM Tax').id
  db.prepare("INSERT INTO ProductTax (ProductId, TaxId) VALUES ((SELECT Id FROM Product WHERE Code = '2'), ?)").run(taxId)
  db.exec("DELETE FROM Product WHERE Code = 'ENVIO' AND Id NOT IN (SELECT ProductId FROM DocumentItem)")
  db.exec("UPDATE Product SET Code = 'ENVIO-viejo' WHERE Code = 'ENVIO'")
  db.exec("INSERT INTO Product (Name, Code, Price, IsTaxInclusivePrice, IsPriceChangeAllowed, IsService, IsUsingDefaultQuantity, IsEnabled, Cost, Markup, Color) VALUES ('Envío', 'ENVIO', 0, 1, 1, 1, 1, 1, 0, 0, 'Transparent')")
})

after(() => {
  db?.close()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('venta web → Aronium (sobre una copia de pos.db)', () => {
  const writer = createWriter(config)
  let unpaidNumber
  let paidNumber

  it('la base es una versión conocida', () => {
    assert.deepEqual(checkSchema(DB), { ok: true })
  })

  it('registra una venta impaga: documento, renglón, stock y numeración', () => {
    const before = { stock: stockOf('3'), counter: counter() }
    const r = writer.registerSale(payload(9001, [{ sku: '3', quantity: 2, unit_price: 20000, total: 40000 }]), { paid: false })
    unpaidNumber = r.aronium_number
    assert.equal(r.ok, true)
    assert.equal(r.payment_registered, false)
    assert.match(r.aronium_number, /^\d{2}-200-\d{6}$/)
    assert.equal(counter(), before.counter + 1)
    assert.equal(stockOf('3'), before.stock - 2)
    const doc = one('SELECT * FROM Document WHERE Number = ?', r.aronium_number)
    assert.equal(doc.OrderNumber, 'WEB-9001')
    assert.equal(doc.Total, 40000)
    assert.equal(doc.PaidStatus, 0)
    assert.equal(doc.CustomerId, one("SELECT Id FROM Customer WHERE Name = 'Walk-in customer'").Id)
    assert.match(doc.InternalNote, /Cliente Prueba/)
    // A nombre del usuario principal (el de más permisos), sin aviso: así se
    // ve en su historial de ventas.
    assert.equal(doc.UserId, mainUser())
    assert.equal(r.warning, undefined)
    const items = q('SELECT * FROM DocumentItem WHERE DocumentId = ?', doc.Id)
    assert.equal(items.length, 1)
    assert.equal(items[0].Quantity, 2)
    assert.equal(items[0].Total, 40000)
    assert.equal(q('SELECT * FROM Payment WHERE DocumentId = ?', doc.Id).length, 0)
  })

  it('no la duplica si se repite el pedido', () => {
    const docs = q('SELECT count(*) AS n FROM Document')[0].n
    const stock = stockOf('3')
    const r = writer.registerSale(payload(9001, [{ sku: '3', quantity: 2, unit_price: 20000, total: 40000 }]), { paid: false })
    assert.equal(r.aronium_number, unpaidNumber)
    assert.equal(q('SELECT count(*) AS n FROM Document')[0].n, docs)
    assert.equal(stockOf('3'), stock)
  })

  it('registra una venta pagada con IVA, envío y RUC (cliente nuevo)', () => {
    const p = payload(9002, [{ sku: '2', quantity: 1, unit_price: 1100000, total: 1100000 }], {
      customer: { name: 'Juan Pérez', phone: '0981 000 000', email: null, ruc: '80012345-6', business_name: 'Pérez SA' },
      shipping: { name: 'Envío a domicilio', total: 30000 },
    })
    const r = writer.registerSale(p, { paid: true })
    paidNumber = r.aronium_number
    assert.equal(r.payment_registered, true)
    assert.equal(r.warning, undefined)
    const doc = one('SELECT * FROM Document WHERE Number = ?', r.aronium_number)
    assert.equal(doc.PaidStatus, 2)
    assert.equal(doc.Total, 1130000)
    assert.equal(doc.UserId, mainUser())
    const customer = one('SELECT * FROM Customer WHERE Id = ?', doc.CustomerId)
    assert.equal(customer.TaxNumber, '80012345-6')
    assert.equal(customer.Name, 'Pérez SA')
    const items = q('SELECT di.*, p.Code FROM DocumentItem di JOIN Product p ON p.Id = di.ProductId WHERE DocumentId = ? ORDER BY di.Id', doc.Id)
    assert.deepEqual(items.map((i) => i.Code), ['2', 'ENVIO'])
    // IVA incluido: 1.100.000 / 1,1 = 1.000.000 antes de impuesto, 100.000 de IVA.
    assert.equal(items[0].PriceBeforeTax, 1000000)
    assert.equal(one('SELECT Amount FROM DocumentItemTax WHERE DocumentItemId = ?', items[0].Id).Amount, 100000)
    const pay = one('SELECT pt.Name, p.Amount FROM Payment p JOIN PaymentType pt ON pt.Id = p.PaymentTypeId WHERE p.DocumentId = ?', doc.Id)
    assert.deepEqual({ ...pay }, { Name: 'Transferencia', Amount: 1130000 })
    // El mismo RUC otra vez no crea otro cliente.
    const r2 = writer.registerSale({ ...p, display_id: 9003, order_id: 'order_test_9003' }, { paid: false })
    assert.equal(one('SELECT CustomerId FROM Document WHERE Number = ?', r2.aronium_number).CustomerId, doc.CustomerId)
  })

  it('si falta un producto en Aronium no escribe nada', () => {
    const before = { docs: q('SELECT count(*) AS n FROM Document')[0].n, counter: counter(), stock: stockOf('1') }
    assert.throws(
      () => writer.registerSale(payload(9004, [{ sku: '1', quantity: 1, unit_price: 350000, total: 350000 }, { sku: 'NO-EXISTE', quantity: 1, unit_price: 1, total: 1 }]), { paid: false }),
      (e) => e instanceof AroniumDataError && /NO-EXISTE/.test(e.message)
    )
    assert.equal(q('SELECT count(*) AS n FROM Document')[0].n, before.docs)
    assert.equal(counter(), before.counter)
    assert.equal(stockOf('1'), before.stock)
  })

  it('agrega el pago a una venta impaga (una sola vez)', () => {
    writer.addPayment(unpaidNumber, payload(9001, []))
    writer.addPayment(unpaidNumber, payload(9001, []))
    const doc = one('SELECT * FROM Document WHERE Number = ?', unpaidNumber)
    assert.equal(doc.PaidStatus, 2)
    assert.equal(q('SELECT * FROM Payment WHERE DocumentId = ?', doc.Id).length, 1)
  })

  it('cancelación: devolución que devuelve stock y plata (una sola vez)', () => {
    const before = stockOf('2')
    const r = writer.cancelSale(paidNumber, payload(9002, []))
    assert.match(r.refund_number, /^\d{2}-220-\d{6}$/)
    assert.equal(stockOf('2'), before + 1)
    const refund = one('SELECT * FROM Document WHERE Number = ?', r.refund_number)
    assert.equal(refund.ReferenceDocumentNumber, paidNumber)
    assert.equal(refund.OrderNumber, 'WEB-9002')
    assert.equal(one('SELECT sum(Amount) AS a FROM Payment WHERE DocumentId = ?', refund.Id).a, -1130000)
    const again = writer.cancelSale(paidNumber, payload(9002, []))
    assert.equal(again.refund_number, r.refund_number)
    assert.equal(stockOf('2'), before + 1)
  })

  it('si la caja está grabando, es un error pasajero (se reintenta)', () => {
    const lock = new DatabaseSync(DB)
    lock.exec('BEGIN IMMEDIATE')
    try {
      assert.throws(
        () => writer.registerSale(payload(9005, [{ sku: '4', quantity: 1, unit_price: 5000, total: 5000 }]), { paid: false }),
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
