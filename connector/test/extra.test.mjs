// Más pruebas del agente sobre una COPIA de pos.db (nunca la base real):
// impuestos reales, numeración, cambio de año, dos agentes a la vez, datos
// raros del cliente, cambios de la cajera y lectura del catálogo.
//   ARONIUM_TEST_DB=C:/ruta/copia.db node --test test/
// A diferencia de write.test.mjs, no toca los impuestos de la base: se prueba
// el IVA tal como está cargado en el local.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'
import { productByCode, readImages, readProducts } from '../src/aronium.mjs'
import { AroniumDataError, createWriter, findPaymentType, PAID, UNPAID } from '../src/write.mjs'

const SOURCE = process.env.ARONIUM_TEST_DB ?? path.join(process.env.LOCALAPPDATA ?? '', 'Aronium', 'Data', 'pos.db')
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aronium-extra-'))
const DB = path.join(DIR, 'pos.db')

const baseConfig = {
  aroniumDb: DB,
  warehouseId: null,
  webSales: {
    enabled: true,
    userName: '',
    defaultCustomerName: 'Unknown',
    paymentTypes: { bank_transfer: 'Transferencia extra', cash_on_delivery: 'Efectivo' },
    shippingCode: 'ENVIO',
    serviceType: null,
  },
}

let db
const one = (sql, ...args) => db.prepare(sql).get(...args)
const all = (sql, ...args) => db.prepare(sql).all(...args)
const code = (id) => `PW-${id}-XT`
const byNumber = (n) => one('SELECT * FROM Document WHERE Number = ?', n)
const items = (docId) => all('SELECT di.*, p.Name FROM DocumentItem di JOIN Product p ON p.Id = di.ProductId WHERE di.DocumentId = ? ORDER BY di.Id', docId)
const stockOf = (productId) => Number(one('SELECT sum(Quantity) AS q FROM Stock WHERE ProductId = ?', productId)?.q ?? 0)
const markPaid = (n) => db.prepare('UPDATE Document SET PaidStatus = 2 WHERE Number = ?').run(n)
const typeId = (c) => one('SELECT Id FROM DocumentType WHERE Code = ?', c).Id
let skus = []

const customer = (extra = {}) => ({
  name: 'Cliente Extra',
  phone: '0981 000 111',
  email: null,
  ruc: null,
  business_name: null,
  address: { line1: 'Calle 1', line2: null, city: 'Asunción', postal_code: null, country_code: 'PY' },
  ...extra,
})

function payload(id, lines, extra = {}) {
  return {
    order_id: `order_extra_${id}`,
    display_id: id,
    tracking_code: code(id),
    created_at: new Date().toISOString(),
    currency: 'PYG',
    total: lines.reduce((s, l) => s + l.total, 0),
    payment_method: 'bank_transfer',
    delivery: 'Retiro en el local',
    customer: customer(),
    address: null,
    notes: null,
    gift: false,
    lines: lines.map((l, i) => ({ line_item_id: `li_x_${id}_${i}`, title: `Producto ${l.sku}`, ...l })),
    shipping: null,
    ...extra,
  }
}
const line = (sku, quantity = 1, unit = 10000) => ({ sku, quantity, unit_price: unit, total: unit * quantity })

before(() => {
  assert.ok(fs.existsSync(SOURCE), `No existe la base de prueba ${SOURCE}`)
  fs.copyFileSync(SOURCE, DB)
  db = new DatabaseSync(DB)
  // Forma de pago propia de estas pruebas (no depende de cómo se llame en la base).
  if (!one("SELECT Id FROM PaymentType WHERE Name = 'Transferencia extra'")) {
    db.exec("INSERT INTO PaymentType (Name, IsCustomerRequired, IsFiscal, IsSlipRequired, IsChangeAllowed, Ordinal, IsEnabled, IsQuickPayment, OpenCashDrawer, MarkAsPaid) VALUES ('Transferencia extra', 0, 1, 0, 0, 99, 1, 0, 0, 1)")
  }
  // Productos con código y stock de sobra, para no depender de qué hay en la base.
  skus = all(
    `SELECT p.Code FROM Product p JOIN Stock s ON s.ProductId = p.Id
      WHERE p.IsService = 0 AND trim(coalesce(p.Code, '')) <> '' GROUP BY p.Id ORDER BY p.Id LIMIT 6`
  ).map((r) => r.Code)
  // Una base chica (la de desarrollo) puede no tener 6: se crean los que faltan.
  for (let i = skus.length; i < 6; i++) {
    const c = `EXTRA-${i}`
    db.prepare("INSERT INTO Product (Name, Code, Price, IsTaxInclusivePrice, IsPriceChangeAllowed, IsService, IsUsingDefaultQuantity, IsEnabled, Cost, Markup, Color) VALUES (?, ?, 10000, 1, 0, 0, 1, 1, 0, 0, 'Transparent')").run(`Prueba extra ${i}`, c)
    db.prepare('INSERT INTO Stock (ProductId, WarehouseId, Quantity) VALUES ((SELECT Id FROM Product WHERE Code = ?), 1, 50)').run(c)
    skus.push(c)
  }
  for (const c of skus) db.prepare('UPDATE Stock SET Quantity = 50 WHERE ProductId = (SELECT Id FROM Product WHERE Code = ?)').run(c)
  assert.equal(skus.length, 6)
})

after(() => {
  db?.close()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('escritura: lo que la caja espera ver', () => {
  const writer = createWriter(baseConfig)

  it('ServiceType de la venta: el que más usan las ventas de la caja', () => {
    const sale = typeId('200')
    const expected = Number(one('SELECT ServiceType FROM Document WHERE DocumentTypeId = ? GROUP BY ServiceType ORDER BY count(*) DESC LIMIT 1', sale)?.ServiceType ?? 0)
    const q = writer.writeQuote(payload(7001, [line(skus[0])]), code(7001))
    markPaid(q.quote_number)
    const s = writer.invoiceQuote(q.quote_number, payload(7001, [line(skus[0])]), code(7001))
    assert.equal(byNumber(s.aronium_number).ServiceType, expected)
    // La proforma, como las que hace la caja: 0.
    assert.equal(byNumber(q.quote_number).ServiceType, 0)
  })

  it('ServiceType fijado en config.json manda', () => {
    const w = createWriter({ ...baseConfig, webSales: { ...baseConfig.webSales, serviceType: 3 } })
    const q = w.writeQuote(payload(7002, [line(skus[0])]), code(7002))
    markPaid(q.quote_number)
    assert.equal(byNumber(w.invoiceQuote(q.quote_number, payload(7002, [line(skus[0])]), code(7002)).aronium_number).ServiceType, 3)
  })

  it('IVA tal como está en la base: importe y precio sin impuesto con 4 decimales', () => {
    const p = one('SELECT Id FROM Product WHERE Code = ?', skus[1])
    const rates = all('SELECT t.Id, t.Rate FROM ProductTax pt JOIN Tax t ON t.Id = pt.TaxId WHERE pt.ProductId = ? AND t.IsEnabled = 1 AND t.IsFixed = 0', p.Id)
    const rate = rates.reduce((s, t) => s + Number(t.Rate), 0)
    const q = writer.writeQuote(payload(7003, [line(skus[1], 1, 390000)]), code(7003))
    const [it1] = items(byNumber(q.quote_number).Id)
    const before = Math.round((390000 / (1 + rate / 100)) * 10000) / 10000
    assert.equal(it1.PriceBeforeTax, before)
    const taxes = all('SELECT Amount FROM DocumentItemTax WHERE DocumentItemId = ?', it1.Id)
    assert.equal(taxes.length, rates.length)
    if (rates.length) assert.equal(Math.round(taxes.reduce((s, t) => s + t.Amount, 0) * 10000) / 10000, Math.round((390000 - 390000 / (1 + rate / 100)) * 10000) / 10000)
  })

  it('la numeración sigue el contador de la caja y lo actualiza', () => {
    const year = new Date().getFullYear()
    const name = `Document.200.${year}`
    const before = Number(one('SELECT Value FROM Counter WHERE Name = ?', name)?.Value ?? 0)
    const max = Math.max(0, ...all('SELECT Number FROM Document WHERE Number LIKE ?', `${String(year).slice(2)}-200-%`).map((r) => Number(r.Number.slice(7))))
    const q = writer.writeQuote(payload(7004, [line(skus[0])]), code(7004))
    markPaid(q.quote_number)
    const s = writer.invoiceQuote(q.quote_number, payload(7004, [line(skus[0])]), code(7004))
    const n = Math.max(before, max) + 1
    assert.equal(s.aronium_number, `${String(year).slice(2)}-200-${String(n).padStart(6, '0')}`)
    assert.equal(Number(one('SELECT Value FROM Counter WHERE Name = ?', name).Value), n)
  })

  it('contador atrasado (restauraron algo): no repite un número que ya existe', () => {
    const year = new Date().getFullYear()
    db.prepare('UPDATE Counter SET Value = 1 WHERE Name = ?').run(`Document.230.${year}`)
    const q = writer.writeQuote(payload(7005, [line(skus[0])]), code(7005))
    assert.equal(all('SELECT Id FROM Document WHERE Number = ?', q.quote_number).length, 1)
  })

  it('cambio de año: empieza en 000001 con el prefijo y el contador del año nuevo', () => {
    const RealDate = Date
    const fixed = new RealDate(2031, 0, 1, 0, 5, 0)
    globalThis.Date = class extends RealDate {
      constructor(...a) {
        super(...(a.length ? a : [fixed.getTime()]))
      }
      static now() {
        return fixed.getTime()
      }
    }
    try {
      const q = writer.writeQuote(payload(7006, [line(skus[0])]), code(7006))
      assert.equal(q.quote_number, '31-230-000001')
      assert.equal(Number(one("SELECT Value FROM Counter WHERE Name = 'Document.230.2031'").Value), 1)
      const doc = byNumber(q.quote_number)
      assert.equal(doc.Date, '2031-01-01 00:00:00')
      assert.match(doc.DateCreated, /^2031-01-01 00:05:00\.0000000$/)
    } finally {
      globalThis.Date = RealDate
    }
  })

  it('dos agentes a la vez con el mismo pedido (tarea + "npm run once"): una sola proforma', async () => {
    const script = path.join(DIR, 'writer-child.mjs')
    const writeUrl = pathToFileURL(path.resolve('src/write.mjs')).href
    fs.writeFileSync(
      script,
      `import { createWriter } from ${JSON.stringify(writeUrl)}
const cfg = JSON.parse(process.argv[2]); const p = JSON.parse(process.argv[3])
const w = createWriter(cfg)
for (let i = 0; i < 20; i++) { try { console.log(w.writeQuote(p, p.tracking_code).quote_number); break } catch (e) { if (!/locked|busy/i.test(e.message)) throw e } }`
    )
    const p = payload(7007, [line(skus[2])])
    const run = () =>
      new Promise((resolve, reject) => {
        const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', script, JSON.stringify(baseConfig), JSON.stringify(p)])
        let out = ''
        let err = ''
        c.stdout.on('data', (d) => (out += d))
        c.stderr.on('data', (d) => (err += d))
        c.on('close', (status) => (status === 0 ? resolve(out.trim()) : reject(new Error(err))))
      })
    const [a, b] = await Promise.all([run(), run(), run()])
    assert.equal(a, b)
    assert.equal(all('SELECT Id FROM Document WHERE OrderNumber = ? AND DocumentTypeId = ?', code(7007), typeId('230')).length, 1)
  })

  it('notas con comillas, emojis, saltos de línea y texto tipo SQL quedan tal cual', () => {
    const notes = `Timbre "2" — no anda 🙏\nDejar con el portero O'Brien; DROP TABLE Document; --`
    const p = payload(7008, [line(skus[0])], { notes, customer: customer({ name: "José D'Alessandro 😀", email: 'jose+web@example.com' }) })
    const q = writer.writeQuote(p, code(7008))
    const doc = byNumber(q.quote_number)
    assert.ok(doc.InternalNote.includes(`Notas: ${notes}`))
    assert.equal(one('SELECT Name FROM Customer WHERE Id = ?', doc.CustomerId).Name, "José D'Alessandro 😀")
    assert.ok(one("SELECT count(*) AS n FROM sqlite_master WHERE name = 'Document'").n === 1)
  })

  it('nota muy larga (5.000 caracteres)', () => {
    const notes = 'x'.repeat(5000)
    const q = writer.writeQuote(payload(7009, [line(skus[0])], { notes }), code(7009))
    assert.ok(byNumber(q.quote_number).InternalNote.endsWith(notes))
  })

  it('forma de entrega con otras mayúsculas y sin tildes encuentra el servicio de Aronium', (t) => {
    const svc = one("SELECT Id, Name FROM Product WHERE IsService = 1 AND IsEnabled = 1 AND Name LIKE 'Delivery %' ORDER BY Id LIMIT 1")
    if (!svc) return t.skip('la base no tiene servicios "Delivery …"')
    const loose = svc.Name.toUpperCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    const q = writer.writeQuote(payload(7010, [line(skus[0])], { shipping: { name: loose, total: 15000 } }), code(7010))
    const its = items(byNumber(q.quote_number).Id)
    assert.equal(its.at(-1).ProductId, svc.Id)
    assert.equal(byNumber(q.quote_number).Total, 25000)
  })

  it('un servicio desactivado con ese nombre no se usa (va el de ENVIO)', () => {
    db.exec("INSERT INTO Product (Name, Code, Price, IsTaxInclusivePrice, IsPriceChangeAllowed, IsService, IsUsingDefaultQuantity, IsEnabled, Cost, Markup, Color) VALUES ('Delivery Ciudad Apagada', NULL, 5000, 1, 1, 1, 1, 0, 0, 0, 'Transparent')")
    if (!one("SELECT Id FROM Product WHERE Code = 'ENVIO'")) {
      db.exec("INSERT INTO Product (Name, Code, Price, IsTaxInclusivePrice, IsPriceChangeAllowed, IsService, IsUsingDefaultQuantity, IsEnabled, Cost, Markup, Color) VALUES ('Envío', 'ENVIO', 0, 1, 1, 1, 1, 1, 0, 0, 'Transparent')")
    }
    const q = writer.writeQuote(payload(7011, [line(skus[0])], { shipping: { name: 'Delivery Ciudad Apagada', total: 5000 } }), code(7011))
    assert.equal(items(byNumber(q.quote_number).Id).at(-1).ProductId, one("SELECT Id FROM Product WHERE Code = 'ENVIO'").Id)
  })
})

describe('clientes', () => {
  const writer = createWriter(baseConfig)
  const customerOf = (n) => one('SELECT c.* FROM Customer c JOIN Document d ON d.CustomerId = c.Id WHERE d.Number = ?', n)

  it('RUC con espacios encuentra al cliente cargado sin espacios', () => {
    db.exec("INSERT INTO Customer (Name, TaxNumber, DateCreated, DateUpdated, IsEnabled, IsCustomer, IsSupplier) VALUES ('Empresa RUC', '80077777-1', '2026-01-01', '2026-01-01', 1, 1, 0)")
    const q = writer.writeQuote(payload(7020, [line(skus[0])], { customer: customer({ ruc: ' 80077777 -1 ' }) }), code(7020))
    assert.equal(customerOf(q.quote_number).Name, 'Empresa RUC')
  })

  it('el email encuentra al cliente sin importar mayúsculas', () => {
    db.exec("INSERT INTO Customer (Name, Email, DateCreated, DateUpdated, IsEnabled, IsCustomer, IsSupplier) VALUES ('Cliente Mail', 'Ana.Perez@Example.com', '2026-01-01', '2026-01-01', 1, 1, 0)")
    const q = writer.writeQuote(payload(7021, [line(skus[0])], { customer: customer({ email: 'ana.perez@example.com' }) }), code(7021))
    assert.equal(customerOf(q.quote_number).Name, 'Cliente Mail')
  })

  it('sin RUC ni email: el mismo teléfono reutiliza el cliente', () => {
    const c = customer({ name: 'Solo Teléfono', phone: '0981 444 555' })
    const a = writer.writeQuote(payload(7022, [line(skus[0])], { customer: c }), code(7022))
    const b = writer.writeQuote(payload(7023, [line(skus[0])], { customer: { ...c, phone: '+595 981 444555' } }), code(7023))
    assert.equal(customerOf(a.quote_number).Id, customerOf(b.quote_number).Id)
    // Mismo teléfono, otro nombre (alguien de la familia): otro cliente.
    const other = writer.writeQuote(payload(7025, [line(skus[0])], { customer: { ...c, name: 'Otra Persona' } }), code(7025))
    assert.notEqual(customerOf(other.quote_number).Id, customerOf(a.quote_number).Id)
  })

  it('nunca usa al consumidor final ("Unknown") como cliente web', () => {
    const c = customer({ name: 'Unknown', phone: null })
    const q = writer.writeQuote(payload(7024, [line(skus[0])], { customer: c }), code(7024))
    assert.notEqual(customerOf(q.quote_number).Id, 1)
  })
})

describe('pagos y cambios de la cajera', () => {
  const writer = createWriter(baseConfig)

  it('forma de pago desactivada en Aronium (como UENO): avisa y la venta queda impaga', () => {
    db.exec("INSERT INTO PaymentType (Name, IsCustomerRequired, IsFiscal, IsSlipRequired, IsChangeAllowed, Ordinal, IsEnabled, IsQuickPayment, OpenCashDrawer, MarkAsPaid) VALUES ('Apagada extra', 0, 1, 0, 0, 98, 0, 0, 0, 1)")
    const w = createWriter({ ...baseConfig, webSales: { ...baseConfig.webSales, paymentTypes: { bank_transfer: 'Apagada extra' } } })
    const q = w.writeQuote(payload(7030, [line(skus[0])]), code(7030))
    markPaid(q.quote_number)
    const s = w.invoiceQuote(q.quote_number, payload(7030, [line(skus[0])]), code(7030))
    assert.match(s.warning, /No existe la forma de pago "Apagada extra"/)
    const sale = byNumber(s.aronium_number)
    assert.equal(sale.PaidStatus, UNPAID)
    assert.equal(one('SELECT count(*) AS n FROM Payment WHERE DocumentId = ?', sale.Id).n, 0)
  })

  it('forma de pago escrita sin tilde ni mayúsculas ("itau") encuentra "Itaú"; una desactivada no se usa pero se ve', () => {
    db.exec("INSERT INTO PaymentType (Name, IsCustomerRequired, IsFiscal, IsSlipRequired, IsChangeAllowed, Ordinal, IsEnabled, IsQuickPayment, OpenCashDrawer, MarkAsPaid) VALUES ('Banco Ñandú Extra', 0, 1, 0, 0, 97, 1, 0, 0, 1)")
    assert.equal(findPaymentType(db, '  banco nandu   extra ')?.Name, 'Banco Ñandú Extra')
    assert.equal(findPaymentType(db, 'apagada extra'), null)
    assert.equal(findPaymentType(db, 'apagada extra', { includeDisabled: true })?.Name, 'Apagada extra')
    // El agente la usa con el nombre como esté en config.json.
    const w = createWriter({ ...baseConfig, webSales: { ...baseConfig.webSales, paymentTypes: { bank_transfer: 'BANCO NANDU EXTRA' } } })
    const q = w.writeQuote(payload(7038, [line(skus[0])]), code(7038))
    markPaid(q.quote_number)
    const s = w.invoiceQuote(q.quote_number, payload(7038, [line(skus[0])]), code(7038))
    assert.equal(s.warning, undefined)
    assert.equal(one('SELECT pt.Name FROM Payment p JOIN PaymentType pt ON pt.Id = p.PaymentTypeId WHERE p.DocumentId = ?', byNumber(s.aronium_number).Id).Name, 'Banco Ñandú Extra')
  })

  it('cantidad 3 con un total que no se divide justo: el total del renglón es el cobrado', () => {
    const p = payload(7031, [{ sku: skus[3], quantity: 3, unit_price: 33333, total: 100000 }])
    const q = writer.writeQuote(p, code(7031))
    const doc = byNumber(q.quote_number)
    assert.equal(doc.Total, 100000)
    assert.equal(items(doc.Id)[0].Total, 100000)
  })

  it('producto de regalo (cupón del 100 %): renglón en 0 y documento en 0', () => {
    const p = payload(7032, [{ sku: skus[0], quantity: 1, unit_price: 0, total: 0 }])
    const q = writer.writeQuote(p, code(7032))
    assert.equal(byNumber(q.quote_number).Total, 0)
    markPaid(q.quote_number)
    const s = writer.invoiceQuote(q.quote_number, p, code(7032))
    assert.equal(byNumber(s.aronium_number).Total, 0)
  })

  it('la cajera agregó un producto y subió una cantidad: la venta y el stock siguen a la proforma', () => {
    const p = payload(7033, [line(skus[4], 1)])
    const q = writer.writeQuote(p, code(7033))
    const doc = byNumber(q.quote_number)
    const [first] = items(doc.Id)
    // Sube la cantidad a 2 y agrega otro producto, como en la caja.
    db.prepare('UPDATE DocumentItem SET Quantity = 2, Total = 20000, TotalAfterDocumentDiscount = 20000 WHERE Id = ?').run(first.Id)
    const extra = one('SELECT Id FROM Product WHERE Code = ?', skus[5]).Id
    db.prepare(
      `INSERT INTO DocumentItem (DocumentId, ProductId, Quantity, ExpectedQuantity, PriceBeforeTax, Price, Discount, DiscountType, ProductCost, PriceBeforeTaxAfterDiscount, PriceAfterDiscount, Total, TotalAfterDocumentDiscount, DiscountApplyRule)
       VALUES (?, ?, 1, 0, 5000, 5000, 0, 0, 0, 5000, 5000, 5000, 5000, 0)`
    ).run(doc.Id, extra)
    db.prepare('UPDATE Document SET Total = 25000 WHERE Id = ?').run(doc.Id)
    const before = { a: stockOf(first.ProductId), b: stockOf(extra) }
    markPaid(q.quote_number)
    const s = writer.invoiceQuote(q.quote_number, p, code(7033))
    assert.match(s.warning, /La proforma se cambió en Aronium/)
    const sale = byNumber(s.aronium_number)
    assert.equal(sale.Total, 25000)
    assert.equal(items(sale.Id).length, 2)
    assert.equal(stockOf(first.ProductId), before.a - 2)
    assert.equal(stockOf(extra), before.b - 1)
  })

  it('devolución de una venta sin pago: sin pagos y sin marcarla pagada', () => {
    const w = createWriter({ ...baseConfig, webSales: { ...baseConfig.webSales, paymentTypes: { bank_transfer: 'No existe extra' } } })
    const p = payload(7034, [line(skus[0])])
    const q = w.writeQuote(p, code(7034))
    markPaid(q.quote_number)
    const s = w.invoiceQuote(q.quote_number, p, code(7034))
    const r = w.cancelSale(s.aronium_number, p)
    const refund = byNumber(r.refund_number)
    assert.equal(refund.PaidStatus, 0)
    assert.equal(one('SELECT count(*) AS n FROM Payment WHERE DocumentId = ?', refund.Id).n, 0)
  })

  it('un producto desactivado en Aronium después de vendido igual entra en la proforma', () => {
    db.prepare('UPDATE Product SET IsEnabled = 0 WHERE Code = ?').run(skus[5])
    try {
      const q = createWriter(baseConfig).writeQuote(payload(7035, [line(skus[5])]), code(7035))
      assert.ok(q.quote_number)
    } finally {
      db.prepare('UPDATE Product SET IsEnabled = 1 WHERE Code = ?').run(skus[5])
    }
  })

  it('un renglón sin código no escribe nada y lo dice', () => {
    const before = one('SELECT count(*) AS n FROM Document').n
    assert.throws(
      () => createWriter(baseConfig).writeQuote(payload(7036, [{ sku: null, quantity: 1, unit_price: 1, total: 1 }]), code(7036)),
      (e) => e instanceof AroniumDataError && /sin código/.test(e.message)
    )
    assert.equal(one('SELECT count(*) AS n FROM Document').n, before)
  })

  it('la proforma "Pagado" la detecta aunque la cajera también la haya editado', () => {
    const q = createWriter(baseConfig).writeQuote(payload(7037, [line(skus[0])]), code(7037))
    db.prepare("UPDATE Document SET PaidStatus = ?, Note = 'editada en caja' WHERE Number = ?").run(PAID, q.quote_number)
    assert.equal(createWriter(baseConfig).quoteStatus(q.quote_number, code(7037)).paid, true)
  })
})

describe('lectura del catálogo', () => {
  it('códigos casi iguales (puntos o guiones) son productos distintos', (t) => {
    const pairs = [
      ['T1184101605700', 'T118.410.16.057.00'],
      ['WS-1200H1AVDF', 'WS-1200H-1AVDF'],
    ]
    const products = readProducts(DB)
    const codes = new Set(products.map((p) => p.code))
    const present = pairs.filter(([a, b]) => one('SELECT 1 FROM Product WHERE Code = ?', a) && one('SELECT 1 FROM Product WHERE Code = ?', b))
    if (!present.length) return t.skip('la base no tiene esos códigos')
    for (const [a, b] of present) {
      assert.ok(codes.has(a) && codes.has(b))
      const ra = productByCode(db, a)
      const rb = productByCode(db, b)
      assert.notEqual(ra.Id, rb.Id)
    }
  })

  it('sin código: el código de barras hace de código, salvo que sea ambiguo', () => {
    db.exec("INSERT INTO Product (Name, Code, Price, IsTaxInclusivePrice, IsPriceChangeAllowed, IsService, IsUsingDefaultQuantity, IsEnabled, Cost, Markup, Color) VALUES ('Sin código A', NULL, 1000, 1, 0, 0, 1, 1, 0, 0, 'Transparent')")
    const a = one('SELECT max(Id) AS id FROM Product').id
    db.exec("INSERT INTO Product (Name, Code, Price, IsTaxInclusivePrice, IsPriceChangeAllowed, IsService, IsUsingDefaultQuantity, IsEnabled, Cost, Markup, Color) VALUES ('Sin código B', NULL, 1000, 1, 0, 0, 1, 1, 0, 0, 'Transparent')")
    const b = one('SELECT max(Id) AS id FROM Product').id
    db.exec("INSERT INTO Product (Name, Code, Price, IsTaxInclusivePrice, IsPriceChangeAllowed, IsService, IsUsingDefaultQuantity, IsEnabled, Cost, Markup, Color) VALUES ('Sin código C', NULL, 1000, 1, 0, 0, 1, 1, 0, 0, 'Transparent')")
    const c = one('SELECT max(Id) AS id FROM Product').id
    db.prepare("INSERT INTO Barcode (ProductId, Value) VALUES (?, '  7799999000001 ')").run(a)
    db.prepare("INSERT INTO Barcode (ProductId, Value) VALUES (?, '7799999000002')").run(b)
    db.prepare("INSERT INTO Barcode (ProductId, Value) VALUES (?, '7799999000002')").run(c)
    const codes = new Map(readProducts(DB).map((p) => [p.code, p]))
    assert.equal(codes.get('7799999000001')?.name, 'Sin código A')
    // El mismo código de barras en dos productos sin código: no se sabe cuál es.
    assert.equal(codes.has('7799999000002'), false)
  })

  it('un código de barras igual al código de otro producto no lo pisa', () => {
    db.exec("INSERT INTO Product (Name, Code, Price, IsTaxInclusivePrice, IsPriceChangeAllowed, IsService, IsUsingDefaultQuantity, IsEnabled, Cost, Markup, Color) VALUES ('Impostor', NULL, 1000, 1, 0, 0, 1, 1, 0, 0, 'Transparent')")
    const imp = one('SELECT max(Id) AS id FROM Product').id
    db.prepare('INSERT INTO Barcode (ProductId, Value) VALUES (?, ?)').run(imp, skus[0])
    const matches = readProducts(DB).filter((p) => p.code === skus[0])
    assert.equal(matches.length, 1)
    assert.notEqual(matches[0].name, 'Impostor')
    assert.notEqual(productByCode(db, skus[0]).Id, imp)
  })

  it('los servicios no van a la tienda; un producto desactivado va con enabled = false', () => {
    db.prepare('UPDATE Product SET IsEnabled = 0 WHERE Code = ?').run(skus[1])
    const products = readProducts(DB)
    const serviceCodes = new Set(all("SELECT Code FROM Product WHERE IsService = 1 AND trim(coalesce(Code,'')) <> ''").map((r) => r.Code))
    assert.equal(products.some((p) => serviceCodes.has(p.code)), false)
    assert.equal(products.find((p) => p.code === skus[1]).enabled, false)
    db.prepare('UPDATE Product SET IsEnabled = 1 WHERE Code = ?').run(skus[1])
  })

  it('stock negativo y por depósito', () => {
    const id = one('SELECT Id FROM Product WHERE Code = ?', skus[2]).Id
    if (!one('SELECT Id FROM Warehouse WHERE Id = 2')) db.exec("INSERT INTO Warehouse (Id, Name) VALUES (2, 'Depósito 2')")
    db.prepare('DELETE FROM Stock WHERE ProductId = ?').run(id)
    db.prepare('INSERT INTO Stock (ProductId, WarehouseId, Quantity) VALUES (?, 1, -2)').run(id)
    db.prepare('INSERT INTO Stock (ProductId, WarehouseId, Quantity) VALUES (?, 2, 7)').run(id)
    assert.equal(readProducts(DB).find((p) => p.code === skus[2]).stock, 5)
    assert.equal(readProducts(DB, { warehouseId: 1 }).find((p) => p.code === skus[2]).stock, -2)
    assert.equal(readProducts(DB, { warehouseId: 2 }).find((p) => p.code === skus[2]).stock, 7)
  })

  it('fotos: JPEG y PNG sí; cualquier otra cosa no', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6])
    const png = Buffer.from('89504e470d0a1a0a0000', 'hex')
    const junk = Buffer.from('no es una foto, es texto')
    const set = (c, b) => db.prepare('UPDATE Product SET Image = ? WHERE Code = ?').run(b, c)
    set(skus[3], jpeg)
    set(skus[4], png)
    set(skus[5], junk)
    const imgs = readImages(DB, [skus[3], skus[4], skus[5], 'NO-EXISTE'])
    assert.equal(imgs.get(skus[3]).mimeType, 'image/jpeg')
    assert.equal(imgs.get(skus[4]).mimeType, 'image/png')
    assert.equal(imgs.has(skus[5]), false)
    assert.equal(imgs.has('NO-EXISTE'), false)
    const p = readProducts(DB).find((x) => x.code === skus[3])
    assert.equal(p.image_hash, `len-${jpeg.length}`)
  })

  it('la caja grabando (lugar de escritura tomado) no impide leer el catálogo', () => {
    const lock = new DatabaseSync(DB)
    lock.exec('BEGIN IMMEDIATE')
    try {
      assert.ok(readProducts(DB).length > 0)
    } finally {
      lock.exec('ROLLBACK')
      lock.close()
    }
  })
})
