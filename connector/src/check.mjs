import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readProducts } from './aronium.mjs'
import { createApi } from './api.mjs'
import { loadConfig, ROOT } from './config.mjs'
import { errorMessage } from './log.mjs'
import { checkSchema } from './schema.mjs'
import { findPaymentType } from './write.mjs'

// Revisión antes de instalar (npm run revisar, o install.ps1 -Prueba): todo lo
// que el sincronizador necesita en esta PC, sin escribir nada en Aronium ni en
// la tienda. ✖ = hay que arreglarlo antes de instalar; ⚠ = conviene mirarlo.

const results = []
const ok = (text) => results.push(['✔', text])
const warn = (text) => results.push(['⚠', text])
const bad = (text) => results.push(['✖', text])

// ---- Node y config.json -------------------------------------------------------

const [major, minor] = process.versions.node.split('.').map(Number)
if (major > 22 || (major === 22 && minor >= 13)) ok(`Node ${process.versions.node}.`)
else bad(`Node ${process.versions.node} es viejo: hace falta 22.13 o más nuevo (nodejs.org, versión LTS).`)

let config = null
try {
  config = loadConfig({ exitOnError: false })
  ok(`config.json: tienda ${config.storeUrl}.`)
} catch (error) {
  bad(errorMessage(error))
}

if (/onedrive/i.test(ROOT)) warn(`La carpeta está dentro de OneDrive (${ROOT}): conviene C:\\SincronizadorAronium (OneDrive bloquea los archivos al sincronizar).`)
try {
  const probe = path.join(ROOT, `.prueba-escritura-${process.pid}`)
  fs.writeFileSync(probe, 'x')
  fs.rmSync(probe)
  ok('Se puede escribir en la carpeta del sincronizador (registro, estado, copias).')
} catch (error) {
  bad(`No se puede escribir en ${ROOT}: ${errorMessage(error)}`)
}

if (config) {
  // ---- Aronium ------------------------------------------------------------------
  const web = config.webSales
  if (!fs.existsSync(config.aroniumDb)) {
    bad(`No se encontró la base de Aronium en ${config.aroniumDb}. En Aronium: Configuración → Base de datos → "Abrir ubicación", y poné esa ruta en aroniumDb.`)
  } else {
    try {
      const products = readProducts(config.aroniumDb, { warehouseId: config.warehouseId })
      const withStock = products.filter((p) => p.stock > 0).length
      ok(`Aronium: ${products.length} productos con código (${withStock} con stock).`)
    } catch (error) {
      bad(`No se pudo leer la base de Aronium: ${errorMessage(error)}`)
    }
    try {
      const schema = checkSchema(config.aroniumDb)
      if (schema.ok) ok('Aronium: versión conocida, se pueden registrar pedidos web.')
      else bad(schema.reason)
    } catch (error) {
      bad(`No se pudo revisar la versión de Aronium: ${errorMessage(error)}`)
    }
    let db = null
    try {
      db = new DatabaseSync(config.aroniumDb, { readOnly: true, timeout: 5000 })
      // Usuario de las ventas web.
      const main = db.prepare("SELECT trim(coalesce(FirstName,'') || ' ' || coalesce(LastName,'')) AS name FROM User WHERE IsEnabled = 1 ORDER BY AccessLevel DESC, Id LIMIT 1").get()
      if (web.userName.trim()) {
        const name = web.userName.trim().toLowerCase()
        const found = db
          .prepare("SELECT 1 FROM User WHERE IsEnabled = 1 AND (lower(trim(coalesce(FirstName,'') || ' ' || coalesce(LastName,''))) = ? OR lower(trim(coalesce(FirstName,''))) = ? OR lower(coalesce(Username,'')) = ?)")
          .get(name, name, name)
        if (found) ok(`Las ventas web van a nombre de "${web.userName}".`)
        else warn(`No existe el usuario "${web.userName}" en Aronium: las ventas van a nombre de "${main?.name}".`)
      } else if (main) ok(`Las ventas web van a nombre de "${main.name}" (el usuario principal).`)
      else bad('Aronium no tiene usuarios activos.')
      // Formas de pago.
      for (const [method, label] of [
        ['bank_transfer', 'transferencias'],
        ['cash_on_delivery', 'efectivo'],
      ]) {
        const name = web.paymentTypes[method]
        const pt = findPaymentType(db, name, { includeDisabled: true })
        if (pt && Number(pt.IsEnabled)) ok(`Forma de pago de ${label}: "${pt.Name}".`)
        else if (pt) bad(`La forma de pago "${pt.Name}" (${label}) está DESACTIVADA en Aronium: activala, o esas ventas van a quedar sin pago registrado.`)
        else if (method === 'bank_transfer') warn(`No existe la forma de pago "${name}" en Aronium: la instalación la crea. Si las transferencias se cargan con otro nombre, cambialo en config.json (webSales.paymentTypes.bank_transfer).`)
        else if (findPaymentType(db, 'Efectivo') || findPaymentType(db, 'Cash')) ok(`Forma de pago de ${label}: "Efectivo".`)
        else warn(`No existe la forma de pago "${name}" (${label}) en Aronium.`)
      }
      // Envío.
      const shipping = db.prepare('SELECT Name, IsService FROM Product WHERE Code = ?').get(web.shippingCode)
      if (shipping?.IsService) ok(`Producto de envío "${web.shippingCode}": listo.`)
      else warn(`Producto de envío "${web.shippingCode}": ${shipping ? 'existe pero no es servicio' : 'no existe'}; la instalación lo deja listo.`)
      const deliveries = db.prepare("SELECT Name FROM Product WHERE IsService = 1 AND IsEnabled = 1 AND Name LIKE 'Delivery %' ORDER BY Name").all()
      if (deliveries.length) ok(`Servicios de delivery en Aronium (van en la proforma con su precio): ${deliveries.map((d) => d.Name.replace(/^Delivery /, '')).join(', ')}.`)
      else warn('Aronium no tiene servicios "Delivery <ciudad>": el envío va como el producto ENVIO.')
      const noCode = db
        .prepare("SELECT count(*) AS n FROM Product p WHERE p.IsService = 0 AND trim(coalesce(p.Code,'')) = '' AND NOT EXISTS (SELECT 1 FROM Barcode b WHERE b.ProductId = p.Id AND trim(b.Value) <> '') AND EXISTS (SELECT 1 FROM Stock s WHERE s.ProductId = p.Id AND s.Quantity > 0)")
        .get().n
      if (noCode) warn(`${noCode} productos con stock no tienen código ni código de barras: no llegan a la tienda.`)
    } catch (error) {
      bad(`No se pudo revisar Aronium: ${errorMessage(error)}`)
    } finally {
      db?.close()
    }
    if (aroniumRunning()) ok('Aronium está abierto (no molesta: el sincronizador funciona igual).')
  }

  // ---- La tienda ------------------------------------------------------------------
  const api = createApi(config)
  try {
    await api.webSalesWork()
    ok(`La tienda responde y acepta la clave del conector.`)
    const skew = api.clockSkewMs()
    if (skew !== null) {
      const minutes = Math.round(skew / 60000)
      if (Math.abs(minutes) > 30) bad(`El reloj de esta PC está ${Math.abs(minutes)} minutos ${minutes > 0 ? 'adelantado' : 'atrasado'}: corregí la fecha y la hora de Windows (las ventas web saldrían con otra fecha).`)
      else if (Math.abs(minutes) > 2) warn(`El reloj de esta PC está ${Math.abs(minutes)} minutos ${minutes > 0 ? 'adelantado' : 'atrasado'}: conviene activar "Establecer la hora automáticamente".`)
      else ok('El reloj de la PC está en hora.')
    }
  } catch (error) {
    bad(errorMessage(error))
  }
}

for (const [mark, text] of results) console.log(`${mark} ${text}`)
const failed = results.filter(([m]) => m === '✖').length
console.log(failed ? `\n${failed} cosa(s) para arreglar antes de instalar.` : '\nTodo listo para instalar.')
process.exitCode = failed ? 1 : 0

function aroniumRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Aronium.Pos.exe', '/NH'], { encoding: 'utf8' })
    return /Aronium\.Pos\.exe/i.test(out)
  } catch {
    return false
  }
}
