// Extrae del catálogo PDF (una página = un producto): foto, textos, precio y
// el código de Aronium que aparece en la página.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const [, , pdfDir, dbPath, outDir, onlyFile, maxPages] = process.argv
fs.mkdirSync(path.join(outDir, 'img'), { recursive: true })
const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '')

// Códigos de Aronium (normalizados) y códigos de barras → código.
const db = new DatabaseSync(dbPath, { readOnly: true })
const byNorm = new Map()
for (const r of db.prepare("SELECT Id, Code FROM Product WHERE IsService = 0 AND Code <> ''").all()) byNorm.set(norm(r.Code), r.Code)
const byBarcode = new Map()
for (const r of db.prepare("SELECT b.Value, p.Code FROM Barcode b JOIN Product p ON p.Id = b.ProductId WHERE p.Code <> ''").all()) byBarcode.set(norm(r.Value), r.Code)

const mul = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]]
const out = []
const files = fs.readdirSync(pdfDir).filter((f) => f.endsWith('.pdf') && (!onlyFile || f.includes(onlyFile)))
for (const file of files) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(pdfDir, file))), verbosity: 0, isOffscreenCanvasSupported: false }).promise
  const last = Math.min(doc.numPages, Number(maxPages) || Infinity)
  for (let p = 1; p <= last; p++) {
    const page = await doc.getPage(p)
    const text = await page.getTextContent()
    // Renglones: textos agrupados por altura, de arriba abajo.
    const rows = new Map()
    for (const t of text.items) {
      if (!t.str.trim()) continue
      const y = Math.round(t.transform[5] / 4) * 4
      rows.set(y, [...(rows.get(y) ?? []), { x: t.transform[4], s: t.str }])
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, ts]) => ts.sort((a, b) => a.x - b.x).map((t) => t.s).join(' ').replace(/\s+/g, ' ').replace(/\s+:/g, ':').trim())
    if (!lines.some((l) => /precio|oferta/i.test(l))) continue

    // Código: un renglón (o palabra) que sea un código de Aronium o un código de barras.
    let code = null, codeLine = -1, matchedBy = null
    lines.forEach((l, i) => {
      if (code) return
      for (const cand of [l, ...l.split(/\s+/)]) {
        const n = norm(cand)
        if (n.length < 4) continue
        if (byNorm.has(n)) { code = byNorm.get(n); codeLine = i; matchedBy = 'code'; return }
        if (byBarcode.has(n)) { code = byBarcode.get(n); codeLine = i; matchedBy = 'barcode'; return }
      }
    })
    const priceLine = lines.findIndex((l) => /precio|oferta/i.test(l))
    const num = (re) => { const m = lines.join(' ').match(re); return m ? Number(m[1].replace(/\./g, '')) : null }
    const price = num(/Precio(?: de lista)?\s*:?\s*([\d.]+)/i)
    const offer = num(/Oferta\s*:?\s*([\d.]+)/i)
    const isCodeish = (l) => /^[A-Z0-9][A-Z0-9.\-\/ ]{3,}$/.test(l) && /\d/.test(l) && !/\s[a-záéíóú]/.test(l)
    // Título: lo de arriba del código. Características: entre el código y el precio.
    const head = lines.slice(0, codeLine >= 0 ? codeLine : priceLine).filter((l) => !isCodeish(l))
    const specs = lines.slice(codeLine >= 0 ? codeLine + 1 : priceLine, priceLine).filter((l) => !isCodeish(l)).map((l) => l.replace(/^[*•\-–]\s*/, '')).reduce((acc, l) => {
      // Renglón cortado: sigue en minúscula o paréntesis, o el anterior termina en coma o dos puntos.
      const prev = acc.at(-1)
      if (prev && (/^[a-záéíóúñ(]/.test(l) || /[,:]$/.test(prev))) acc[acc.length - 1] = `${prev} ${l}`
      else acc.push(l)
      return acc
    }, [])

    // Foto: la imagen de la página con más píxeles.
    const ops = await page.getOperatorList()
    let ctm = [[1, 0, 0, 1, 0, 0]], best = null
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], args = ops.argsArray[i]
      if (fn === pdfjs.OPS.save) ctm.push(ctm.at(-1))
      else if (fn === pdfjs.OPS.restore) ctm.pop()
      else if (fn === pdfjs.OPS.transform) ctm[ctm.length - 1] = mul(ctm.at(-1), args)
      else if (fn === pdfjs.OPS.paintImageXObject) {
        // Por píxeles, no por el lugar que ocupa: algunas páginas tienen de fondo
        // una imagen chiquita estirada que ocupa más que la foto.
        const area = Number(args[1]) * Number(args[2])
        if (!best || area > best.area) best = { name: args[0], area }
      }
    }
    let image = null
    if (best) {
      // Las imágenes repetidas en varias páginas ("g_…") están en commonObjs.
      const store = best.name.startsWith('g_') ? page.commonObjs : page.objs
      const obj = await Promise.race([new Promise((res) => store.get(best.name, res)), new Promise((res) => setTimeout(() => res(null), 5000))])
      if (obj?.data && obj.width) {
        const channels = obj.data.length / (obj.width * obj.height)
        const name = `${path.basename(file, '.pdf').replace(/[^\w]+/g, '_')}_p${p}.jpg`
        await sharp(Buffer.from(obj.data), { raw: { width: obj.width, height: obj.height, channels } })
          .flatten({ background: '#ffffff' })
          .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toFile(path.join(outDir, 'img', name))
        image = { file: name, width: obj.width, height: obj.height }
      }
    }
    out.push({ file, page: p, code, matchedBy, title: head, specs, price, offer, image, lines })
    page.cleanup()
  }
  await doc.destroy()
  console.error(`${file}: ${out.filter((o) => o.file === file).length} productos, ${out.filter((o) => o.file === file && o.code).length} con código de Aronium`)
}
fs.writeFileSync(path.join(outDir, onlyFile ? 'sample.json' : 'catalog.json'), JSON.stringify(out, null, 1))
