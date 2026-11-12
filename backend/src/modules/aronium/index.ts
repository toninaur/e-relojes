import { Module } from '@medusajs/framework/utils'
import AroniumModuleService from './service'

export const ARONIUM_MODULE = 'aronium'

export default Module(ARONIUM_MODULE, { service: AroniumModuleService })
