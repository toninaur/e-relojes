import { MedusaService } from '@medusajs/framework/utils'
import { AroniumAgent } from './models/agent'
import { AroniumChange } from './models/change'
import { AroniumRun } from './models/run'
import { AroniumWebSale } from './models/web-sale'

class AroniumModuleService extends MedusaService({ AroniumAgent, AroniumRun, AroniumChange, AroniumWebSale }) {}

export default AroniumModuleService
