// Formas de entrega del local (confirmadas por e-relojes el 19/11/2026).
//
// Los nombres son iguales a los servicios de Aronium (grupo "Delivery"): el
// conector pone en la proforma el servicio que se llama como la forma de
// entrega elegida (connector/src/write.mjs). Si se agrega una ciudad, crear el
// servicio en Aronium con el mismo nombre.
//
// El checkout agrupa las "Delivery <ciudad>" en un selector de ciudad y no
// permite efectivo al recibir en la encomienda (storefront/app/carrito).

export const DELIVERY_PREFIX = 'Delivery '

export const DELIVERY_BY_CITY: [city: string, price: number][] = [
  ['Asunción', 10000],
  ['Fernando de la Mora', 20000],
  ['Lambaré', 20000],
  ['Loma Pyta', 20000],
  ['San Lorenzo', 25000],
  ['Luque', 30000],
  ['Mariano Roque Alonso', 30000],
  ['Villa Elisa', 30000],
  ['Ñemby', 30000],
  ['San Antonio', 30000],
  ['Capiatá', 30000],
  ['Itauguá', 40000],
  ['Limpio', 40000],
]

// Al interior: el flete lo paga el cliente al recibir (sin costo en la web).
export const PARCEL_OPTION = 'Envío de encomienda (a cobrar)'

// Forma de entrega anterior, con precio único para todo el país.
export const OLD_FLAT_OPTION = 'Envío a domicilio'
