import { BRAND_ALIASES, BRAND_DEFAULT_TYPE, CATEGORY_DEFAULT_TYPE, GROUP_ALIASES, TYPE_KEYWORDS } from './catalog-taxonomy'

// Completa categoría, marca y tipo de un producto nuevo de Aronium, a partir
// de su grupo y su nombre. Lo que no se pueda deducir queda vacío para
// completarlo en el panel. Sin dependencias, para poder probarlo solo.

export interface Classification {
  category: string | null
  brand: string | null
  type: string | null
}

/** Sin acentos, minúsculas, y todo lo que no es letra o número como espacio. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Para lo que no es reloj, la categoría sale del tipo. Un reloj sin grupo no
// se sabe si es de caballero o de dama (salvo Casio, que tiene la suya).
const CATEGORY_BY_TYPE: Record<string, string> = {
  Perfume: 'Perfumes y decants',
  Decant: 'Perfumes y decants',
  'Lentes de sol': 'Lentes de sol',
  Joya: 'Joyas y pulseras',
  Pulsera: 'Joyas y pulseras',
  Billetera: 'Bolsos y billeteras',
  Cinto: 'Bolsos y billeteras',
  'Mochila o bolso': 'Bolsos y billeteras',
  Cartera: 'Bolsos y billeteras',
  Necessaire: 'Bolsos y billeteras',
  Organizador: 'Organizadores y accesorios',
  'Botella o vaso': 'Organizadores y accesorios',
  Herramienta: 'Organizadores y accesorios',
}

/**
 * @param categories nombres de las categorías que existen en la tienda
 * @param brands     nombres de las marcas (colecciones) que existen en la tienda
 */
export function classify(
  item: { name: string; group?: string | null },
  categories: string[],
  brands: string[]
): Classification {
  const name = normalize(item.name)
  const brand = findBrand(name, brands)
  // Tipo: por palabras del nombre, o el de la marca si vende una sola cosa.
  const keywordType =
    TYPE_KEYWORDS.find(([pattern]) => pattern.test(item.name))?.[1] ?? (brand ? (BRAND_DEFAULT_TYPE[brand] ?? null) : null)

  let category = item.group ? findCategory(item.group, categories) : null
  if (!category && keywordType && CATEGORY_BY_TYPE[keywordType]) category = CATEGORY_BY_TYPE[keywordType]
  if (!category && brand === 'Casio' && (!keywordType || keywordType === 'Reloj')) category = 'Casio'
  if (category && !categories.includes(category)) category = null

  const type = keywordType ?? (category ? (CATEGORY_DEFAULT_TYPE[category] ?? null) : null)
  return { category, brand, type }
}

function findCategory(group: string, categories: string[]): string | null {
  const key = normalize(group)
  const direct = categories.find((c) => normalize(c) === key)
  if (direct) return direct
  const alias = Object.entries(GROUP_ALIASES).find(([k]) => normalize(k) === key)?.[1]
  return alias ?? null
}

function findBrand(name: string, brands: string[]): string | null {
  // Marcas y alias, de la clave más larga a la más corta ("Armani Exchange"
  // antes que "Armani").
  const keys: [string, string][] = [
    ...brands.map((b) => [normalize(b), b] as [string, string]),
    ...Object.entries(BRAND_ALIASES)
      .filter(([, brand]) => brands.includes(brand))
      .map(([alias, brand]) => [normalize(alias), brand] as [string, string]),
  ].sort((a, b) => b[0].length - a[0].length)

  // 1) Al principio del nombre: "Tissot PRX", "G-Shock GA-2100", "MK5774".
  for (const [key, brand] of keys) {
    if (name === key || name.startsWith(`${key} `)) return brand
    // Códigos de modelo pegados a la sigla: "MK5774", "AX1870".
    if (key.length <= 2 && new RegExp(`^${key}\\d`).test(name)) return brand
  }
  // 2) En cualquier parte, como palabra entera ("Reloj Tissot PRX"). Solo
  //    claves largas, para no confundir siglas con palabras.
  for (const [key, brand] of keys) {
    if (key.length >= 4 && ` ${name} `.includes(` ${key} `)) return brand
  }
  return null
}
