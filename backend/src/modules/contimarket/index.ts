import { Module } from '@medusajs/framework/utils'
import ContimarketModuleService from './service'

// Conector tienda → ContiMarket (docs/conector-contimarket.md). Aparte del
// de Aronium: corre en el servidor, después de cada sincronización, y si
// falla no afecta a la tienda ni a Aronium.
export const CONTIMARKET_MODULE = 'contimarket'

export default Module(CONTIMARKET_MODULE, { service: ContimarketModuleService })
