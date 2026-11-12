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
