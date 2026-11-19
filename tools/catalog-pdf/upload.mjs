// Sube a la tienda las fotos del catálogo extraído y el catalog.json con las
// direcciones de cada foto, para importarlo en el servidor sin copiar archivos:
//
//   STORE_URL=https://… ADMIN_KEY=sk_… node upload.mjs "<carpeta extraída>"
//
// ADMIN_KEY es una clave secreta de administrador (panel → Configuración →
// Claves de API secretas). Usa la misma subida que el panel (/admin/uploads),
// así las fotos quedan donde la tienda guarda las suyas.
//
// Al final imprime la dirección del catalog.json subido, para:
//   CATALOG_URL=<esa dirección> npx medusa exec ./src/scripts/import-catalog.ts publicar
//
// Sube una foto por producto (la más pesada si aparece en varios catálogos) y
// saltea las que salieron vacías. Si se corta, se puede correr de nuevo: lo ya
// subido queda anotado en uploaded.json.
import fs from 'node:fs'
import path from 'node:path'

const [, , dir] = process.argv
const store = (process.env.STORE_URL ?? '').replace(/\/+$/, '')
const key = process.env.ADMIN_KEY ?? ''
if (!dir || !store || !key) {
  console.error('Uso: STORE_URL=https://… ADMIN_KEY=sk_… node upload.mjs "<carpeta extraída>"')
  process.exit(1)
}
const MIN_PHOTO_BYTES = 5_000
const auth = `Basic ${Buffer.from(`${key}:`).toString('base64')}`

const pages = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'))
const size = (p) => (p.image ? fs.statSync(path.join(dir, 'img', p.image.file)).size : 0)
const best = new Map()
for (const p of pages) {
  if (!p.code || size(p) < MIN_PHOTO_BYTES) continue
  if (!best.has(p.code) || size(p) > size(best.get(p.code))) best.set(p.code, p)
}

const donePath = path.join(dir, 'uploaded.json')
const done = fs.existsSync(donePath) ? JSON.parse(fs.readFileSync(donePath, 'utf8')) : {}

async function upload(file, name, type) {
  const form = new FormData()
  form.append('files', new Blob([fs.readFileSync(file)], { type }), name)
  const res = await fetch(`${store}/admin/uploads`, { method: 'POST', headers: { authorization: auth }, body: form })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  const { files } = await res.json()
  return files[0].url
}

let count = 0
for (const [code, page] of best) {
  if (done[page.image.file]) continue
  const name = `catalogo-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`
  done[page.image.file] = await upload(path.join(dir, 'img', page.image.file), name, 'image/jpeg')
  if (++count % 25 === 0) {
    fs.writeFileSync(donePath, JSON.stringify(done, null, 1))
    console.log(`Fotos subidas: ${Object.keys(done).length} de ${best.size}`)
  }
}
fs.writeFileSync(donePath, JSON.stringify(done, null, 1))
console.log(`Fotos subidas: ${Object.keys(done).length} de ${best.size}`)

// catalog.json con la dirección y el peso de cada foto (el servidor no tiene img/).
const remote = pages.map((p) =>
  p.image && done[p.image.file] ? { ...p, image: { ...p.image, url: done[p.image.file], bytes: size(p) } } : { ...p, image: null }
)
const remotePath = path.join(dir, 'catalog-remoto.json')
fs.writeFileSync(remotePath, JSON.stringify(remote))
const url = await upload(remotePath, 'catalogo-datos.json', 'application/json')
console.log(`\nListo. En el servidor:\n  CATALOG_URL=${url} npx medusa exec ./src/scripts/import-catalog.ts publicar`)
