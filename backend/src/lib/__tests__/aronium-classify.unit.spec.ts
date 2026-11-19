import { classify } from '../aronium-classify'
import { BRANDS, CATEGORIES } from '../catalog-taxonomy'

// Casos reales del Aronium del local (base del 18/11/2026).
const run = (name: string, group: string | null) =>
  classify(
    { name, group },
    CATEGORIES.map((c) => c.name),
    [...BRANDS]
  )

describe('clasificación de productos nuevos de Aronium', () => {
  it('la marca sale del grupo cuando el nombre no la dice', () => {
    expect(run('Remera Nautica negra - Talle M', 'Nautica').brand).toBe('Nautica')
    expect(run('Dorado Caballeros C02A-003PY', 'QyQ').brand).toBe('Q&Q')
    expect(run('AR11521 Dos tonos', 'Armani').brand).toBe('Emporio Armani')
  })

  it('el nombre manda sobre el grupo', () => {
    expect(run('Emporio Armani AR11521 Dos tonos', 'Varios').brand).toBe('Emporio Armani')
  })

  it('los subgrupos de Casio van a Casio', () => {
    expect(run('Edifice EFR-526D-1AVUDF', 'Casio Edifice').category).toBe('Casio')
    expect(run('GA-2100-1ADR', 'Casio G-Shock').category).toBe('Casio')
  })

  it('un reloj con "Damas" o "Caballeros" en el nombre va a esa categoría', () => {
    expect(run('Curren Damas 9024 Gold', 'Curren')).toMatchObject({ category: 'Damas', brand: 'Curren', type: 'Reloj' })
    expect(run('Invicta Caballeros Pro Diver 8926', 'Invicta').category).toBe('Caballeros')
  })

  it('un reloj sin "Damas" va a Caballeros (así nombra el local)', () => {
    expect(run('Curren 8415 Negro Dial Verde', 'Curren')).toMatchObject({ category: 'Caballeros', type: 'Reloj' })
    // Lo que no se sabe si es reloj no se toca.
    expect(run('Tommy Hilfiger Gunmetal', 'Tommy Hilfiger').category).toBe(null)
  })

  it('relojes de marcas que venden de todo: por palabras o código de modelo', () => {
    expect(run('Tommy Hilfiger bisel negro', 'Tommy Hilfiger')).toMatchObject({ type: 'Reloj', category: 'Caballeros' })
    expect(run('Michael Kors Dos Tonos MK3709', 'Michael Kors').type).toBe('Reloj')
    expect(run('Fossil Damas Rosegold ES4791', 'Fossil')).toMatchObject({ type: 'Reloj', category: 'Damas' })
    // Un lente con código MK sigue siendo lente.
    expect(run('Michael Kors Lente MK2175U-300587-54 Charleston Damas', 'Michael Kors').type).toBe('Lentes de sol')
  })

  it('ropa, lentes y bolsos', () => {
    expect(run('Tommy Hilfiger Remera roja - Talle L', 'Tommy Hilfiger')).toMatchObject({ type: 'Remera', category: 'Ropa' })
    expect(run('Corbata Calvin Klein Gris S52099', 'Calvin Klein')).toMatchObject({ type: 'Corbata', category: 'Ropa' })
    expect(run('Lente Lacoste L848S-001-54 Negro', 'Lacoste').category).toBe('Lentes de sol')
    expect(run('Club Room Bolsón Verde 100148440', 'Club Room').category).toBe('Bolsos y billeteras')
    // "Crema" es un color, no un producto de limpieza.
    expect(run('Casio Damas Dial Crema LTP-1241D-7A2DF', 'Casio').type).toBe('Reloj')
  })

  it('las mallas van a accesorios', () => {
    expect(run('Malla de silicona 22 mm negra', 'Mallas de relojes').category).toBe('Organizadores y accesorios')
  })
})
