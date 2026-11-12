import { MedusaService } from '@medusajs/framework/utils'
import { AroniumAgent } from './models/agent'
import { AroniumChange } from './models/change'
import { AroniumRun } from './models/run'

class AroniumModuleService extends MedusaService({ AroniumAgent, AroniumRun, AroniumChange }) {}

export default AroniumModuleService
