// Marcas mal escritas en el buscador ("sieko" → Seiko). El buscador de Medusa
// tolera errores de tipeo, pero con dos letras invertidas ordena mal: "sieko"
// dejaba los Seiko últimos. Antes de buscar, una palabra que está a una letra
// de una marca (cambiada, de más, de menos o dos invertidas) se reemplaza por
// la marca. Sin dependencias, para poder probarlo solo.

/**
 * Palabras del catálogo que se parecen a una marca y no hay que tocar
 * (revisado con todas las palabras de los títulos el 20/11/2026): "cartera"
 * no es Carrera, "Invictus" (perfume) no es Invicta.
 */
const KEEP = new Set(['cartera', 'carteras', 'decant', 'decants', 'invictus'])

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Distancia de edición con transposición de dos letras vecinas (OSA). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/**
 * @param q      lo que escribió el cliente
 * @param brands nombres de las marcas de la tienda ("Seiko", "Tommy Hilfiger")
 */
export function correctBrandTypos(q: string, brands: string[]): string {
  const words = new Map<string, string>()
  for (const brand of brands) {
    for (const w of brand.split(/[^\p{L}]+/u)) if (w.length >= 5) words.set(norm(w), w)
  }
  return q.replace(/\p{L}+/gu, (token) => {
    const key = norm(token)
    // Cortas (ruido), ya correctas o palabras comunes del catálogo: igual.
    if (key.length < 5 || words.has(key) || KEEP.has(key)) return token
    const max = key.length >= 8 ? 2 : 1
    const close = [...words].filter(([w]) => Math.abs(w.length - key.length) <= max && editDistance(key, w) <= max)
    // Una sola marca posible; si hay dos, no se adivina.
    return close.length === 1 ? close[0][1] : token
  })
}
