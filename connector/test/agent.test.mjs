// El agente entero (src/index.mjs) contra una tienda simulada: lo que pasa
// cuando se corta internet, la clave no sirve, la tienda falla o está en
// pausa, y cómo quedan state.json, avisos.json, el log y las copias de
// respaldo. Cada prueba copia src/ a una carpeta temporal con su config.json y
// una COPIA de pos.db.
//   ARONIUM_TEST_DB=C:/ruta/copia.db node --test test/
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const SOURCE = process.env.ARONIUM_TEST_DB ?? path.join(process.env.LOCALAPPDATA ?? '', 'Aronium', 'Data', 'pos.db')
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'aronium-agent-'))
const DB = path.join(BASE, 'pos.db')
let CODE // un código con stock de la base
let PRODUCT_ID

// ---- Tienda simulada --------------------------------------------------------

let handler = () => null
const requests = []
const server = http.createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const entry = { method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null }
  requests.push(entry)
  const out = (await handler(entry)) ?? defaults(entry)
  res.writeHead(out.status ?? 200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(out.json ?? {}))
})
function defaults(r) {
  if (r.url.endsWith('/sync')) return { json: { created: 0, settings: { interval_minutes: null, full_requested: false } } }
  if (r.url.includes('/web-sales?')) return { json: { work: [] } }
  if (r.url.includes('/web-sales/')) return { json: { web_sale: {} } }
  if (r.url.endsWith('/images')) return { json: { images_added: r.body.items.length } }
  return { status: 404 }
}
let url

before(async () => {
  assert.ok(fs.existsSync(SOURCE), `No existe la base de prueba ${SOURCE}`)
  fs.copyFileSync(SOURCE, DB)
  const db = new DatabaseSync(DB)
  const row = db
    .prepare("SELECT p.Id, p.Code FROM Product p JOIN Stock s ON s.ProductId = p.Id WHERE p.IsService = 0 AND trim(coalesce(p.Code,'')) <> '' GROUP BY p.Id ORDER BY p.Id LIMIT 1")
    .get()
  CODE = row.Code
  PRODUCT_ID = row.Id
  db.prepare('UPDATE Stock SET Quantity = 30 WHERE ProductId = ?').run(PRODUCT_ID)
  db.close()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server.close()
  fs.rmSync(BASE, { recursive: true, force: true })
})

// ---- Agente en una carpeta propia ---------------------------------------------

let n = 0
function agentDir(config = {}, { db = DB } = {}) {
  const dir = path.join(BASE, `agent-${++n}`)
  fs.cpSync(SRC, path.join(dir, 'src'), { recursive: true })
  const cfg = { storeUrl: url, token: 'arag_prueba', aroniumDb: db, intervalMinutes: 1, webSales: { defaultCustomerName: 'Unknown', paymentTypes: { bank_transfer: 'Efectivo' } }, ...config }
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg))
  return dir
}

/** Corre el agente; `loopMs`: en bucle durante ese tiempo (si no, --once). */
function runAgent(dir, { loopMs = 0 } = {}) {
  return new Promise((resolve) => {
    const args = ['--disable-warning=ExperimentalWarning', path.join(dir, 'src', 'index.mjs'), ...(loopMs ? [] : ['--once'])]
    const child = spawn(process.execPath, args, { cwd: dir })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    const timer = loopMs ? setTimeout(() => child.kill(), loopMs) : null
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out })
    })
  })
}
const read = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const logOf = (dir) => fs.readFileSync(path.join(dir, 'connector.log'), 'utf8')
const since = (i) => requests.slice(i)

function quoteJob(id, sku = CODE, extra = {}) {
  return {
    id: `ws_${id}`,
    action: 'quote',
    tracking_code: `PW-${id}-AG`,
    aronium_quote_number: null,
    aronium_number: null,
    payload: {
      order_id: `order_${id}`,
      display_id: id,
      tracking_code: `PW-${id}-AG`,
      created_at: new Date().toISOString(),
      currency: 'PYG',
      total: 10000,
      payment_method: 'bank_transfer',
      delivery: 'Retiro en el local',
      customer: { name: 'Agente Prueba', phone: '0981 999 000', email: `agente${id}@example.com`, ruc: null, business_name: null, address: {} },
      address: null,
      notes: null,
      gift: false,
      lines: [{ line_item_id: `li_${id}`, sku, title: 'Producto', quantity: 1, unit_price: 10000, total: 10000 }],
      shipping: null,
    },
    ...extra,
  }
}
const docsFor = (code) => {
  const db = new DatabaseSync(DB, { readOnly: true })
  try {
    return db.prepare('SELECT Number, DocumentTypeId FROM Document WHERE OrderNumber = ?').all(code)
  } finally {
    db.close()
  }
}

// ---- Pruebas ----------------------------------------------------------------

describe('agente contra una tienda simulada', () => {
  it('pasada completa: manda el catálogo con la versión, la clave y "puede escribir"', async () => {
    handler = () => null
    const i = requests.length
    const dir = agentDir()
    const { code } = await runAgent(dir)
    assert.equal(code, 0)
    const sync = since(i).find((r) => r.url === '/aronium-agent/sync')
    assert.equal(sync.auth, 'Bearer arag_prueba')
    assert.equal(sync.body.full, true)
    assert.ok(sync.body.items.length > 0)
    assert.ok(sync.body.items.some((p) => p.code === CODE))
    assert.equal(sync.body.agent.write_enabled, true)
    assert.match(sync.body.agent.version, /^\d+\.\d+\.\d+$/)
    const state = read(dir, 'state.json')
    assert.equal(Object.keys(state.lastSent).length, sync.body.items.length)
  })

  it('config.json guardado con BOM (Bloc de notas viejo, PowerShell 5) se lee igual', async () => {
    const dir = agentDir()
    const file = path.join(dir, 'config.json')
    fs.writeFileSync(file, '\uFEFF' + fs.readFileSync(file, 'utf8'))
    const { code, out } = await runAgent(dir)
    assert.equal(code, 0, out)
  })

  it('config.json con una sola \\ en la ruta: explica cómo arreglarlo', async () => {
    const dir = agentDir()
    fs.writeFileSync(path.join(dir, 'config.json'), '{ "storeUrl": "http://x", "token": "arag_x", "aroniumDb": "C:\\Users\\caja\\pos.db" }')
    const { code, out } = await runAgent(dir)
    assert.equal(code, 1)
    assert.match(out, /config\.json no es válido.*usá \/ o \\\\/s)
  })

  it('sin clave: lo dice y no arranca', async () => {
    const dir = agentDir({ token: '' })
    const { code, out } = await runAgent(dir)
    assert.equal(code, 1)
    assert.match(out, /falta token/)
  })

  it('storeUrl con / al final y con espacios en la clave: igual va a la ruta correcta', async () => {
    const i = requests.length
    const dir = agentDir({ storeUrl: `${url}/`, token: ' arag_prueba ' })
    await runAgent(dir)
    const r = since(i)
    assert.ok(r.length && r.every((x) => x.url.startsWith('/aronium-agent/')))
    assert.ok(r.every((x) => x.auth === 'Bearer arag_prueba'))
  })

  it('clave rechazada (401): lo explica y no da nada por enviado', async () => {
    handler = () => ({ status: 401, json: { message: 'no' } })
    const dir = agentDir()
    const { code } = await runAgent(dir)
    handler = () => null
    assert.equal(code, 1)
    assert.match(logOf(dir), /rechazó la clave del conector/)
    assert.equal(Object.keys(read(dir, 'state.json').lastSent).length, 0)
  })

  it('la tienda falla (500): no da nada por enviado y la pasada siguiente reenvía todo', async () => {
    handler = (r) => (r.url.endsWith('/sync') ? { status: 500, json: { message: 'boom' } } : null)
    const dir = agentDir()
    await runAgent(dir)
    assert.match(logOf(dir), /La tienda respondió 500/)
    assert.equal(Object.keys(read(dir, 'state.json').lastSent).length, 0)
    handler = () => null
    const i = requests.length
    await runAgent(dir)
    assert.ok(since(i).find((r) => r.url.endsWith('/sync')).body.items.length > 0)
    assert.ok(Object.keys(read(dir, 'state.json').lastSent).length > 0)
  })

  it('tienda apagada: el log dice por qué (conexión rechazada)', async () => {
    const dir = agentDir({ storeUrl: 'http://127.0.0.1:9' })
    const { code } = await runAgent(dir)
    assert.equal(code, 1)
    assert.match(logOf(dir), /Sin conexión con la tienda .*\((connect )?(ECONNREFUSED|.+)\)/)
    assert.doesNotMatch(logOf(dir), /fetch failed \(\)/)
  })

  it('pausado desde el panel: no da nada por enviado', async () => {
    handler = (r) => (r.url.endsWith('/sync') ? { json: { paused: true, settings: {} } } : null)
    const dir = agentDir()
    await runAgent(dir)
    handler = () => null
    assert.match(logOf(dir), /pausada desde el panel/)
    assert.equal(Object.keys(read(dir, 'state.json').lastSent).length, 0)
  })

  it('en bucle: sin cambios no manda productos; un precio cambiado manda solo ese', async () => {
    const dir = agentDir()
    await runAgent(dir) // pasada completa
    const db = new DatabaseSync(DB)
    db.prepare('UPDATE Product SET Price = Price + 1 WHERE Id = ?').run(PRODUCT_ID)
    db.close()
    const i = requests.length
    await runAgent(dir, { loopMs: 4000 })
    const sync = since(i).find((r) => r.url.endsWith('/sync'))
    assert.equal(sync.body.full, false)
    assert.deepEqual(
      sync.body.items.map((p) => p.code),
      [CODE]
    )
  })

  it('frecuencia cambiada en el panel: el agente la toma', async () => {
    handler = (r) => (r.url.endsWith('/sync') ? { json: { settings: { interval_minutes: 7 } } } : null)
    const dir = agentDir()
    await runAgent(dir)
    handler = () => null
    assert.match(logOf(dir), /Frecuencia cambiada desde el panel: cada 7 min/)
  })

  it('la tienda pide una foto: la manda en base64 con su tipo', async () => {
    const db = new DatabaseSync(DB)
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9, 9, 9])
    db.prepare('UPDATE Product SET Image = ? WHERE Id = ?').run(jpeg, PRODUCT_ID)
    db.close()
    handler = (r) => (r.url.endsWith('/sync') ? { json: { images_wanted: [CODE, CODE, 'NO-EXISTE'], settings: {} } } : null)
    const i = requests.length
    await runAgent(agentDir())
    handler = () => null
    const img = since(i).filter((r) => r.url.endsWith('/images'))
    assert.equal(img.length, 1)
    assert.deepEqual(
      img[0].body.items.map((x) => [x.code, x.mimeType, x.base64]),
      [[CODE, 'image/jpeg', jpeg.toString('base64')]]
    )
  })

  it('pedido web: escribe la proforma, informa el número y lo deja en avisos.json', async () => {
    handler = (r) => (r.url.includes('/web-sales?') ? { json: { work: [quoteJob(8101)] } } : null)
    const i = requests.length
    const dir = agentDir()
    await runAgent(dir)
    handler = () => null
    const result = since(i).find((r) => r.url === '/aronium-agent/web-sales/ws_8101')
    assert.equal(result.body.action, 'quote')
    assert.equal(result.body.ok, true)
    assert.match(result.body.quote_number, /^\d{2}-230-\d{6}$/)
    const alerts = read(dir, 'avisos.json')
    assert.equal(alerts.pending[0].code, 'PW-8101-AG')
    assert.equal(alerts.pending[0].quote, result.body.quote_number)
    assert.ok(fs.readdirSync(path.join(dir, 'backups')).some((f) => /^pos-\d{4}-\d{2}-\d{2}\.db$/.test(f)))
  })

  it('se corta internet justo después de escribir: el resultado queda guardado, se manda primero y la proforma no se duplica', async () => {
    let fail = true
    handler = (r) => {
      if (r.url.includes('/web-sales?')) return { json: { work: [quoteJob(8102)] } }
      if (r.url.includes('/web-sales/ws_8102') && fail) return { status: 503, json: {} }
      return null
    }
    const dir = agentDir()
    await runAgent(dir)
    const state = read(dir, 'state.json')
    assert.equal(state.pendingResults.length, 1)
    assert.equal(state.pendingResults[0].id, 'ws_8102')
    fail = false
    const i = requests.length
    await runAgent(dir)
    handler = () => null
    const r = since(i)
    // Lo primero que hace es mandar el resultado pendiente.
    assert.equal(r[0].url, '/aronium-agent/web-sales/ws_8102')
    assert.equal(read(dir, 'state.json').pendingResults.length, 0)
    assert.equal(docsFor('PW-8102-AG').length, 1)
  })

  it('proforma sin pagar ("watch"): no manda nada y la deja en avisos', async () => {
    handler = (r) => (r.url.includes('/web-sales?') ? { json: { work: [quoteJob(8101, CODE, { action: 'watch' })] } } : null)
    const i = requests.length
    const dir = agentDir()
    await runAgent(dir)
    handler = () => null
    assert.equal(since(i).filter((r) => r.url.includes('/web-sales/')).length, 0)
    assert.equal(read(dir, 'avisos.json').pending[0].code, 'PW-8101-AG')
  })

  it('producto que no existe en Aronium: informa el error y lo pone en avisos', async () => {
    handler = (r) => (r.url.includes('/web-sales?') ? { json: { work: [quoteJob(8103, 'NO-EXISTE-XYZ')] } } : null)
    const i = requests.length
    const dir = agentDir()
    await runAgent(dir)
    handler = () => null
    const res = since(i).find((r) => r.url === '/aronium-agent/web-sales/ws_8103')
    assert.equal(res.body.ok, false)
    assert.match(res.body.error, /no existen en Aronium/)
    assert.equal(read(dir, 'avisos.json').errors[0].code, 'PW-8103-AG')
  })

  it('state.json roto: arranca de cero con una pasada completa', async () => {
    const dir = agentDir()
    fs.writeFileSync(path.join(dir, 'state.json'), '{ esto no es json')
    const i = requests.length
    const { code } = await runAgent(dir)
    assert.equal(code, 0)
    assert.equal(since(i).find((r) => r.url.endsWith('/sync')).body.full, true)
  })

  it('copias de respaldo: una por día y solo las últimas keepBackups', async () => {
    const dir = agentDir({ keepBackups: 3 })
    const backups = path.join(dir, 'backups')
    fs.mkdirSync(backups)
    for (const d of ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-01-05']) fs.writeFileSync(path.join(backups, `pos-${d}.db`), 'x')
    fs.writeFileSync(path.join(backups, 'pos-antes-de-setup-2020.db'), 'x')
    handler = (r) => (r.url.includes('/web-sales?') ? { json: { work: [quoteJob(8105)] } } : null)
    await runAgent(dir)
    handler = () => null
    const files = fs.readdirSync(backups).sort()
    // La del setup no se toca; de las diarias quedan 3 (la de hoy y las 2 más nuevas).
    assert.ok(files.includes('pos-antes-de-setup-2020.db'))
    const daily = files.filter((f) => /^pos-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    assert.equal(daily.length, 3)
    assert.deepEqual(daily.slice(0, 2), ['pos-2020-01-04.db', 'pos-2020-01-05.db'])
    // La copia de hoy es una base válida.
    const today = path.join(backups, daily[2])
    const copy = new DatabaseSync(today, { readOnly: true })
    assert.ok(copy.prepare('SELECT count(*) AS n FROM Product').get().n > 0)
    copy.close()
  })

  it('base de Aronium que no está: avisa a la tienda con el error y termina con error', async () => {
    const i = requests.length
    const dir = agentDir({ aroniumDb: path.join(BASE, 'no-existe.db') })
    const { code } = await runAgent(dir)
    assert.equal(code, 1)
    const sync = since(i).find((r) => r.url.endsWith('/sync'))
    assert.match(sync.body.error, /No se pudo leer Aronium/)
    assert.equal(sync.body.agent.write_enabled, false)
  })

  it('ventas web apagadas en config.json: no pide trabajo de pedidos', async () => {
    const i = requests.length
    await runAgent(agentDir({ webSales: { enabled: false } }))
    assert.equal(since(i).filter((r) => r.url.includes('web-sales')).length, 0)
  })

  it('clave de administrador vieja (apiKey): solo catálogo, por /admin/aronium con Basic', async () => {
    const i = requests.length
    const dir = agentDir({ token: '', apiKey: 'sk_vieja' })
    await runAgent(dir)
    const r = since(i)
    assert.ok(r.every((x) => x.url.startsWith('/admin/aronium/')))
    assert.equal(r[0].auth, `Basic ${Buffer.from('sk_vieja:').toString('base64')}`)
    assert.match(r.find((x) => x.url.endsWith('/sync')).body.agent.write_blocked_reason, /clave de administrador vieja/)
  })

  it('Aronium con la base cambiada (versión desconocida): sincroniza el catálogo pero no escribe pedidos', async () => {
    const other = path.join(BASE, 'otra-version.db')
    fs.copyFileSync(DB, other)
    const db = new DatabaseSync(other)
    db.exec('ALTER TABLE Document DROP COLUMN Note')
    db.close()
    handler = (r) => (r.url.includes('/web-sales?') ? { json: { work: [quoteJob(8106)] } } : null)
    const i = requests.length
    const dir = agentDir({}, { db: other })
    await runAgent(dir)
    handler = () => null
    const r = since(i)
    assert.equal(r.filter((x) => x.url.includes('web-sales')).length, 0)
    const sync = r.find((x) => x.url.endsWith('/sync'))
    assert.equal(sync.body.agent.write_enabled, false)
    assert.match(sync.body.agent.write_blocked_reason, /Document sin Note/)
    assert.ok(sync.body.items.length > 0)
  })

  it('el producto ENVIO no se manda a la tienda aunque esté cargado como producto común', async () => {
    const db = new DatabaseSync(DB)
    db.exec("DELETE FROM Product WHERE Code = 'ENVIO' AND Id NOT IN (SELECT ProductId FROM DocumentItem)")
    if (!db.prepare("SELECT Id FROM Product WHERE Code = 'ENVIO'").get()) {
      db.exec("INSERT INTO Product (Name, Code, Price, IsTaxInclusivePrice, IsPriceChangeAllowed, IsService, IsUsingDefaultQuantity, IsEnabled, Cost, Markup, Color) VALUES ('Envío', 'ENVIO', 0, 1, 1, 0, 1, 1, 0, 0, 'Transparent')")
    } else db.exec("UPDATE Product SET IsService = 0 WHERE Code = 'ENVIO'")
    db.close()
    const i = requests.length
    await runAgent(agentDir())
    assert.equal(since(i).find((r) => r.url.endsWith('/sync')).body.items.some((p) => p.code === 'ENVIO'), false)
  })
})
