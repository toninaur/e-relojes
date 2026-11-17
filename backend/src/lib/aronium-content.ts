import { COLORS, STRAPS } from './catalog-taxonomy'

// Contenido del producto que viene de Aronium (ver docs/sincronizador-aronium.md,
// "Contenido del producto"). Sin dependencias de Medusa, para probarlo solo.
//
// Aronium tiene una sola "Descripción" por producto. Opcionalmente, el local
// puede escribir ahí, en líneas aparte:
//
//   Reloj automático con cristal de zafiro.
//   Color: Negro, Dorado
//   Malla: Acero
//   Características: 40 mm | Zafiro | Sumergible 10 BAR
//
// Esas líneas van a los filtros y a las características de la tienda; el resto
// es la descripción. Si no están, color y malla se deducen de las palabras del
// nombre y la descripción (solo valores de las listas cerradas del catálogo).

export interface AroniumContent {
  /** Descripción sin las líneas de filtros. */
  description: string
  /** Colores de la lista cerrada ("Negro | Dorado" en la metadata). */
  colors: string[]
  /** Material de la malla, de la lista cerrada. */
  strap: string | null
  specs: string[]
}

/** Sin acentos, minúsculas, signos como espacio. */
export function norm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Cómo se escribe cada color en la práctica (femenino, plural, inglés).
const COLOR_WORDS: Record<string, string[]> = {
  Negro: ['negro', 'negra', 'negros', 'negras', 'black'],
  Blanco: ['blanco', 'blanca', 'blancos', 'blancas', 'white'],
  Plateado: ['plateado', 'plateada', 'plata', 'silver', 'acero plateado'],
  Dorado: ['dorado', 'dorada', 'oro', 'gold'],
  'Oro rosa': ['oro rosa', 'rose gold', 'rosegold', 'rosado dorado'],
  Azul: ['azul', 'azules', 'blue'],
  'Azul marino': ['azul marino', 'navy'],
  Celeste: ['celeste', 'celestes', 'sky blue'],
  Verde: ['verde', 'verdes', 'green'],
  'Verde militar': ['verde militar', 'oliva', 'olive'],
  Turquesa: ['turquesa'],
  Tiffany: ['tiffany'],
  Rojo: ['rojo', 'roja', 'rojos', 'red'],
  Bordo: ['bordo', 'bordó', 'burdeos', 'vino', 'burgundy'],
  Rosa: ['rosa', 'rosado', 'rosada', 'pink'],
  Lila: ['lila'],
  Violeta: ['violeta', 'morado', 'morada', 'purpura', 'purple'],
  Naranja: ['naranja', 'orange'],
  Amarillo: ['amarillo', 'amarilla', 'yellow'],
  Gris: ['gris', 'grises', 'grey', 'gray', 'gunmetal'],
  Marrón: ['marron', 'marrón', 'cafe', 'chocolate', 'brown'],
  Beige: ['beige', 'nude'],
  Crema: ['crema', 'marfil', 'ivory'],
  Champagne: ['champagne', 'champan'],
  Transparente: ['transparente', 'cristal transparente'],
  Multicolor: ['multicolor', 'multicolores'],
}

const STRAP_WORDS: Record<string, string[]> = {
  Acero: ['acero', 'acero inoxidable', 'metal', 'metalica', 'metalico', 'eslabones', 'brazalete'],
  Mesh: ['mesh', 'milanesa', 'tejida', 'malla tejida'],
  Cuero: ['cuero', 'piel', 'leather'],
  Silicona: ['silicona', 'goma', 'caucho', 'rubber', 'silicone'],
  Resina: ['resina', 'resin', 'plastico'],
  Nylon: ['nylon', 'nailon'],
  Tela: ['tela', 'lona', 'textil', 'nato'],
}

function findAll(text: string, table: Record<string, string[]>): string[] {
  const hay = ` ${norm(text)} `
  // Las frases más largas primero ("oro rosa" antes que "rosa" y "oro").
  const entries = Object.entries(table)
    .flatMap(([value, words]) => words.map((w) => [norm(w), value] as const))
    .sort((a, b) => b[0].length - a[0].length)
  const found: string[] = []
  let rest = hay
  for (const [word, value] of entries) {
    if (rest.includes(` ${word} `)) {
      if (!found.includes(value)) found.push(value)
      rest = rest.split(` ${word} `).join(' ')
    }
  }
  return found
}

/** Valor de la lista cerrada para un texto libre ("negra" → "Negro"), o null. */
function oneOf(text: string, list: readonly string[], table: Record<string, string[]>): string | null {
  const key = norm(text)
  const direct = list.find((v) => norm(v) === key)
  if (direct) return direct
  return findAll(text, table)[0] ?? null
}

const LINE = /^\s*(colou?re?s?|malla|correa|caracter[ií]sticas?|specs?)\s*:\s*(.*)$/i

export function parseAroniumContent(name: string, rawDescription: string | null | undefined): AroniumContent {
  const lines = (rawDescription ?? '').replace(/\r\n/g, '\n').split('\n')
  const kept: string[] = []
  let colors: string[] | null = null
  let strap: string | null | undefined
  let specs: string[] = []

  for (const line of lines) {
    const m = LINE.exec(line)
    if (!m) {
      kept.push(line)
      continue
    }
    const key = norm(m[1])
    const value = m[2].trim()
    if (key.startsWith('color') || key.startsWith('colour')) {
      colors = value
        .split(/[,|/]| y /)
        .map((v) => oneOf(v, COLORS, COLOR_WORDS))
        .filter((v): v is string => Boolean(v))
        .filter((v, i, all) => all.indexOf(v) === i)
    } else if (key === 'malla' || key === 'correa') {
      strap = value ? oneOf(value, STRAPS, STRAP_WORDS) : null
    } else {
      specs = value
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)
    }
  }

  const description = kept.join('\n').trim()
  const text = `${name}\n${description}`
  return {
    description,
    // Sin línea "Color:", lo que se encuentre en el nombre y la descripción.
    colors: colors ?? findAll(text, COLOR_WORDS),
    strap: strap !== undefined ? strap : (findAll(text, STRAP_WORDS)[0] ?? null),
    specs,
  }
}

/** Como se guarda en la metadata de la tienda (lo mismo que el panel). */
export function toMetadataValues(content: AroniumContent) {
  return {
    description: content.description,
    color: content.colors.join(' | '),
    malla: content.strap ?? '',
    specs: content.specs.join(' | '),
  }
}

export type SyncedField = 'description' | 'color' | 'malla' | 'specs' | 'barcode'

/**
 * ¿Se puede escribir el valor de Aronium en la tienda?
 * - "Tomar de Aronium" (resync): sí.
 * - En la tienda está vacío: sí.
 * - En la tienda está lo último que se copió de Aronium: sí (nadie lo tocó).
 * - Producto creado por el conector y nunca sincronizado (versiones viejas): sí.
 * - Si no: alguien lo editó en el panel → se respeta.
 */
export function canWrite(opts: {
  store: string | null | undefined
  lastSynced: string | null | undefined
  connectorProduct: boolean
  resync: boolean
}): boolean {
  const store = (opts.store ?? '').trim()
  if (opts.resync || !store) return true
  if (opts.lastSynced !== undefined && opts.lastSynced !== null) return store === opts.lastSynced.trim()
  return opts.connectorProduct
}
