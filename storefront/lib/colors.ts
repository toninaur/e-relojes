// Muestra de color para el filtro "Color". Los nombres son los que se cargan
// en la metadata `color` del producto en Medusa; uno que no esté acá se
// muestra con un círculo gris.
const SWATCHES: Record<string, string> = {
  negro: '#151515',
  blanco: '#ffffff',
  azul: '#1f4fa8',
  celeste: '#7fb6e6',
  verde: '#1e7a4a',
  rojo: '#c62b2b',
  bordo: '#6d1a2a',
  rosa: '#e9a2b8',
  'oro rosa': 'linear-gradient(135deg,#f0c3ad,#b97a64)',
  dorado: 'linear-gradient(135deg,#f3dc8e,#b8902f)',
  plateado: 'linear-gradient(135deg,#f2f2f2,#a9a9a9)',
  gris: '#8a8a8a',
  marrón: '#7a4a2a',
  marron: '#7a4a2a',
  beige: '#d9c7a7',
  naranja: '#e5782b',
  amarillo: '#f2c531',
  violeta: '#6b4aa8',
  champagne: '#e8d5b0',
  'azul marino': '#1b2a4a',
  'verde militar': '#4b5320',
  turquesa: '#2bb5b0',
  tiffany: '#81d8d0',
  lila: '#b9a2d8',
  crema: '#f3ead4',
  transparente: 'repeating-linear-gradient(45deg,#ffffff 0 4px,#e6e6e6 4px 8px)',
  multicolor: 'conic-gradient(#e5482b,#f2c531,#2bb57a,#2b7fe5,#9b4ae5,#e5482b)',
}

export function colorSwatch(name: string): string {
  return SWATCHES[name.trim().toLowerCase()] ?? '#c8c5be'
}
