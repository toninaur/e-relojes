import { MedusaService } from '@medusajs/framework/utils'
import { ContimarketProduct } from './models/product'
import { ContimarketRun } from './models/run'
import { ContimarketSettings } from './models/settings'

class ContimarketModuleService extends MedusaService({ ContimarketSettings, ContimarketProduct, ContimarketRun }) {}

export default ContimarketModuleService
