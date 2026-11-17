import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { loadConfig } from './config.mjs'

// Deja Aronium listo para registrar ventas web, sin buscar menús. Lo corre
// solo install.ps1 (o a mano: npm run setup). Funciona con Aronium abierto o
// cerrado: Aronium carga usuarios y formas de pago al abrir, así que si estaba
// abierto los cambios se ven al reabrirlo. Antes de tocar nada hace una copia
// de respaldo de pos.db. Crea solo lo que falta:
// - Forma de pago "Transferencia" (webSales.paymentTypes.bank_transfer),
//   copiando la configuración de "Card" (no abre el cajón).
// - Producto-servicio de envío (webSales.shippingCode, "ENVIO"): si ya existe
//   como producto común, lo marca como servicio (sin stock).

const config = loadConfig()
const web = config.webSales

const aroniumOpen = aroniumRunning()
if (!fs.existsSync(config.aroniumDb)) {
  console.error(`No se encontró la base de Aronium en ${config.aroniumDb} (aroniumDb en config.json).`)
  process.exit(1)
}

// Copia de respaldo antes de tocar nada.
fs.mkdirSync(config.backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = path.join(config.backupDir, `pos-antes-de-setup-${stamp}.db`)
{
  const ro = new DatabaseSync(config.aroniumDb, { readOnly: true, timeout: 5000 })
  ro.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`)
  ro.close()
}
console.log(`Copia de respaldo: ${backup}`)

const db = new DatabaseSync(config.aroniumDb, { timeout: 5000 })
const done = []
try {
  db.exec('BEGIN IMMEDIATE')

  // 1. Usuario de las ventas web: no se crea ninguno. Van a nombre del usuario
  //    principal (el historial de ventas de Aronium muestra solo las del
  //    usuario con la sesión abierta). Se informa cuál es.
  const main = db.prepare("SELECT trim(coalesce(FirstName,'') || ' ' || coalesce(LastName,'')) AS name FROM User WHERE IsEnabled = 1 ORDER BY AccessLevel DESC, Id LIMIT 1").get()
  done.push(`Las ventas web van a quedar a nombre de "${web.userName.trim() || main?.name || '—'}" (se ven en su historial de ventas).`)

  // 2. Forma de pago de las transferencias.
  const transfer = web.paymentTypes.bank_transfer
  if (db.prepare('SELECT Id FROM PaymentType WHERE lower(Name) = lower(?)').get(transfer)) {
    done.push(`Forma de pago "${transfer}": ya existía.`)
  } else {
    const ordinal = Number(db.prepare('SELECT coalesce(max(Ordinal), 0) AS o FROM PaymentType').get().o) + 1
    const card = db.prepare("SELECT * FROM PaymentType WHERE lower(Name) = 'card'").get()
    db.prepare(
      `INSERT INTO PaymentType (Name, Code, IsCustomerRequired, IsFiscal, IsSlipRequired, IsChangeAllowed, Ordinal, IsEnabled,
         IsQuickPayment, OpenCashDrawer, ShortcutKey, MarkAsPaid, RoundingIncrement, RoundingRule, IconName)
       VALUES (?, NULL, 0, ?, 0, 0, ?, 1, 0, 0, NULL, 1, 0, 0, ?)`
    ).run(transfer, card?.IsFiscal ?? 1, ordinal, card?.IconName ?? null)
    done.push(`Forma de pago "${transfer}": creada (no abre el cajón).`)
  }

  // 3. Producto-servicio del envío.
  const code = web.shippingCode
  const shipping = db.prepare('SELECT Id, Name, IsService FROM Product WHERE Code = ?').get(code)
  if (shipping?.IsService) {
    done.push(`Envío (código ${code}): ya existía como servicio.`)
  } else if (shipping) {
    db.prepare('UPDATE Product SET IsService = 1 WHERE Id = ?').run(shipping.Id)
    db.prepare('UPDATE Stock SET Quantity = 0 WHERE ProductId = ?').run(shipping.Id)
    done.push(`Envío (código ${code}, "${shipping.Name}"): marcado como servicio (sin stock).`)
  } else {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
    db.prepare(
      `INSERT INTO Product (Name, Code, Price, IsTaxInclusivePrice, IsPriceChangeAllowed, IsService, IsUsingDefaultQuantity,
         IsEnabled, Cost, Markup, Color, DateCreated, DateUpdated)
       VALUES ('Envío', ?, 0, 1, 1, 1, 1, 1, 0, 0, 'Transparent', ?, ?)`
    ).run(code, now, now)
    done.push(`Envío (código ${code}): creado como servicio.`)
  }

  db.exec('COMMIT')
} catch (error) {
  try {
    db.exec('ROLLBACK')
  } catch {}
  console.error(`No se pudo completar (Aronium quedó como estaba): ${error.message}`)
  process.exit(1)
} finally {
  db.close()
}
for (const line of done) console.log(`✔ ${line}`)
console.log(aroniumOpen ? 'Listo. Aronium está abierto: los cambios se ven la próxima vez que se abra.' : 'Listo.')

function aroniumRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Aronium.Pos.exe', '/NH'], { encoding: 'utf8' })
    return /Aronium\.Pos\.exe/i.test(out)
  } catch {
    return false
  }
}
