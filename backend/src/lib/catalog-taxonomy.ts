// Estructura del catálogo de E-Relojes, armada a partir de sus catálogos PDF
// (noviembre 2026): Relojes Caballeros, Casio Caballeros, Damas, Lentes y
// accesorios, Organizadores, Perfumes y decants.
//
// La usan la migración que crea categorías, tipos y marcas
// (migration-scripts/catalog-taxonomy.ts) y el panel (widget "Filtros de la
// tienda" en cada producto), para que todos carguen los mismos valores.
// Sin dependencias: el panel también la importa.

/** Categorías de la tienda (filtro "Categoría" y tarjetas del inicio). */
export const CATEGORIES = [
  { name: 'Caballeros', handle: 'caballeros', description: 'Relojes de hombre' },
  { name: 'Damas', handle: 'damas', description: 'Relojes de mujer' },
  { name: 'Casio', handle: 'casio', description: 'G-Shock, Edifice, Baby-G y clásicos de Casio' },
  { name: 'Perfumes y decants', handle: 'perfumes', description: 'Perfumes, decants y combos', renamedFrom: 'Perfumes' },
  { name: 'Lentes de sol', handle: 'lentes-de-sol', description: 'Anteojos de sol de hombre y mujer' },
  {
    name: 'Joyas y pulseras',
    handle: 'joyas-y-pulseras',
    description: 'Swarovski, Michael Kors, pulseras y brazaletes',
    renamedFrom: 'Accesorios',
  },
  { name: 'Bolsos y billeteras', handle: 'bolsos-y-billeteras', description: 'Mochilas, carteras, billeteras, cintos y necessaires' },
  {
    name: 'Organizadores y accesorios',
    handle: 'organizadores-y-accesorios',
    description: 'Organizadores de relojes y anteojos, botellas Spartan y herramientas',
  },
] as const

/** Tipos de producto (filtro "Tipo de producto"). */
export const PRODUCT_TYPES = [
  'Reloj',
  'Perfume',
  'Decant',
  'Lentes de sol',
  'Joya',
  'Pulsera',
  'Billetera',
  'Cinto',
  'Mochila o bolso',
  'Cartera',
  'Necessaire',
  'Organizador',
  'Botella o vaso',
  'Herramienta',
  'Accesorio',
] as const

/** Marcas (colecciones en Medusa; filtro "Marca"). */
export const BRANDS = [
  // Relojes
  'Tissot',
  'Seiko',
  'Citizen',
  'Casio',
  'Invicta',
  'Emporio Armani',
  'Armani Exchange',
  'Tommy Hilfiger',
  'Michael Kors',
  'Fossil',
  'Guess',
  'Nautica',
  'Timex',
  'Q&Q',
  'Curren',
  'Skmei',
  'Fiore',
  // Lentes de sol
  'Ray-Ban',
  'Polaroid',
  'Lacoste',
  'Carrera',
  "Levi's",
  'Calvin Klein',
  // Joyas, bolsos y accesorios
  'Swarovski',
  'DKNY',
  'Timberland',
  'Lava',
  'Spartan',
  'Sun+Stone',
  'Club Room',
  'Steve Madden',
  // Perfumes
  'Afnan',
  'Al Haramain',
  'Armaf',
  'Bharara',
  'Rasasi',
  'Lattafa',
  'Carolina Herrera',
  'Paco Rabanne',
  'Jean Paul Gaultier',
  'Giorgio Armani',
  'Valentino',
  'Dior',
  'Xerjoff',
  'Azzaro',
] as const

/**
 * Colores (filtro "Color", metadata `color`): el del dial y la caja en un
 * reloj, el del marco en unos lentes, el del producto en lo demás. La muestra
 * de cada uno está en storefront/lib/colors.ts.
 */
export const COLORS = [
  'Negro',
  'Blanco',
  'Plateado',
  'Dorado',
  'Oro rosa',
  'Azul',
  'Azul marino',
  'Celeste',
  'Verde',
  'Verde militar',
  'Turquesa',
  'Tiffany',
  'Rojo',
  'Bordo',
  'Rosa',
  'Lila',
  'Violeta',
  'Naranja',
  'Amarillo',
  'Gris',
  'Marrón',
  'Beige',
  'Crema',
  'Champagne',
  'Transparente',
  'Multicolor',
] as const

/**
 * Material de la malla (filtro "Malla", metadata `malla`). "Acero" incluye las
 * metálicas; "Silicona", las de goma y caucho; "Tela", las de lona.
 */
export const STRAPS = ['Acero', 'Mesh', 'Cuero', 'Silicona', 'Resina', 'Nylon', 'Tela'] as const

// ---- Reglas del conector de Aronium (productos nuevos en borrador) ---------
// Lo que no viene de Aronium se completa con estas reglas al crear el
// producto; después se puede corregir en el panel.

/**
 * Grupo de Aronium → categoría de la tienda, cuando no se llaman igual. Se
 * comparan sin mayúsculas ni acentos. Completar con los grupos reales del
 * local. Un grupo que se llame igual que una categoría no necesita estar acá.
 */
export const GROUP_ALIASES: Record<string, string> = {
  'relojes caballeros': 'Caballeros',
  'relojes hombre': 'Caballeros',
  'relojes de hombre': 'Caballeros',
  hombre: 'Caballeros',
  'relojes damas': 'Damas',
  'relojes mujer': 'Damas',
  'relojes de mujer': 'Damas',
  mujer: 'Damas',
  'casio caballeros': 'Casio',
  'casio damas': 'Casio',
  'g-shock': 'Casio',
  perfumes: 'Perfumes y decants',
  perfume: 'Perfumes y decants',
  decants: 'Perfumes y decants',
  lentes: 'Lentes de sol',
  anteojos: 'Lentes de sol',
  'anteojos de sol': 'Lentes de sol',
  gafas: 'Lentes de sol',
  joyas: 'Joyas y pulseras',
  pulseras: 'Joyas y pulseras',
  bijouterie: 'Joyas y pulseras',
  billeteras: 'Bolsos y billeteras',
  mochilas: 'Bolsos y billeteras',
  carteras: 'Bolsos y billeteras',
  cintos: 'Bolsos y billeteras',
  necessaires: 'Bolsos y billeteras',
  organizadores: 'Organizadores y accesorios',
  botellas: 'Organizadores y accesorios',
  termos: 'Organizadores y accesorios',
  accesorios: 'Organizadores y accesorios',
}

/**
 * Nombres de línea que no son la marca: "G-Shock GA-2100" es Casio. Se buscan
 * al principio del nombre, como las marcas.
 */
export const BRAND_ALIASES: Record<string, string> = {
  'g-shock': 'Casio',
  'g shock': 'Casio',
  edifice: 'Casio',
  'baby-g': 'Casio',
  'baby g': 'Casio',
  'ray ban': 'Ray-Ban',
  rayban: 'Ray-Ban',
  armani: 'Emporio Armani',
  ax: 'Armani Exchange',
  tommy: 'Tommy Hilfiger',
  'michael kors': 'Michael Kors',
  mk: 'Michael Kors',
  haramain: 'Al Haramain',
  'carolina herrera': 'Carolina Herrera',
  'jean paul gaultier': 'Jean Paul Gaultier',
  jpg: 'Jean Paul Gaultier',
  'paco rabanne': 'Paco Rabanne',
  'sun stone': 'Sun+Stone',
  levis: "Levi's",
}

/**
 * Tipo de producto por palabras del nombre (la primera que aparezca gana).
 * Si ninguna aparece, se usa el tipo de la categoría (CATEGORY_DEFAULT_TYPE).
 */
export const TYPE_KEYWORDS: [RegExp, string][] = [
  [/\bdecants?\b/i, 'Decant'],
  [/\b(perfume|edp|edt|parfum|eau de)\b/i, 'Perfume'],
  [/\b(lentes|anteojos|gafas|sunglasses)\b/i, 'Lentes de sol'],
  [/\b(organizador|estuche)\b/i, 'Organizador'],
  [/\b(billetera|wallet)\b/i, 'Billetera'],
  [/\b(cinto|cintur[oó]n)\b/i, 'Cinto'],
  [/\b(necess?aire|neceser)\b/i, 'Necessaire'],
  [/\b(cartera|tote|bandolera|porchete)\b/i, 'Cartera'],
  [/\b(mochila|bolso|ri[nñ]onera|fanny)\b/i, 'Mochila o bolso'],
  [/\b(botella|vaso|termo)\b/i, 'Botella o vaso'],
  [/\b(pulsera|brazalete|bracelet|bangle)\b/i, 'Pulsera'],
  [/\b(collar|aros|pendientes|broche|anillo|necklace|earrings)\b/i, 'Joya'],
  [/\b(herramienta|destornillador)/i, 'Herramienta'],
  [/\breloj\b/i, 'Reloj'],
]

/** Tipo de producto por defecto según la categoría. */
export const CATEGORY_DEFAULT_TYPE: Record<string, string> = {
  Caballeros: 'Reloj',
  Damas: 'Reloj',
  Casio: 'Reloj',
  'Perfumes y decants': 'Perfume',
  'Lentes de sol': 'Lentes de sol',
  'Joyas y pulseras': 'Joya',
  'Bolsos y billeteras': 'Mochila o bolso',
  'Organizadores y accesorios': 'Organizador',
}

/**
 * Tipo por defecto de las marcas que en los catálogos venden una sola cosa,
 * para cuando el nombre no dice qué es ("Curren 8301" es un reloj). Las que
 * venden de todo (Tommy Hilfiger, Guess, Fossil, Michael Kors…) no van acá.
 */
export const BRAND_DEFAULT_TYPE: Record<string, string> = {
  Tissot: 'Reloj',
  Seiko: 'Reloj',
  Citizen: 'Reloj',
  Casio: 'Reloj',
  Invicta: 'Reloj',
  Timex: 'Reloj',
  'Q&Q': 'Reloj',
  Curren: 'Reloj',
  Skmei: 'Reloj',
  'Armani Exchange': 'Reloj',
  'Ray-Ban': 'Lentes de sol',
  Polaroid: 'Lentes de sol',
  Carrera: 'Lentes de sol',
  Swarovski: 'Joya',
  Lava: 'Pulsera',
  Spartan: 'Botella o vaso',
  Afnan: 'Perfume',
  'Al Haramain': 'Perfume',
  Armaf: 'Perfume',
  Bharara: 'Perfume',
  Rasasi: 'Perfume',
  Lattafa: 'Perfume',
  'Carolina Herrera': 'Perfume',
  'Paco Rabanne': 'Perfume',
  'Jean Paul Gaultier': 'Perfume',
  'Giorgio Armani': 'Perfume',
  Valentino: 'Perfume',
  Dior: 'Perfume',
  Xerjoff: 'Perfume',
  Azzaro: 'Perfume',
}
