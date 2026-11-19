import { MedusaContainer } from '@medusajs/framework'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { createShippingOptionsWorkflow, deleteShippingOptionsWorkflow } from '@medusajs/medusa/core-flows'
import { DELIVERY_BY_CITY, DELIVERY_PREFIX, OLD_FLAT_OPTION, PARCEL_OPTION } from '../lib/shipping-by-city'

// Delivery por ciudad con los precios del local, encomienda al interior (flete
// a cobrar) y retiro en el local, en lugar del envío a domicilio con precio
// único. Solo crea las que faltan; los precios se cambian después en el panel
// (Configuración → Ubicaciones y envíos).
const CURRENCY = 'pyg'

export default async function shipping_by_city_2026_11({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: options } = await query.graph({
    entity: 'shipping_option',
    fields: ['id', 'name', 'service_zone_id', 'shipping_profile_id', 'provider_id'],
  })
  const { data: regions } = await query.graph({ entity: 'region', fields: ['id'] })
  const template = options.find((o) => o.name === OLD_FLAT_OPTION) ?? options[0]
  if (!template || !regions[0]) {
    logger.info('Envíos por ciudad: no hay formas de entrega ni región todavía; nada que hacer.')
    return
  }

  const existing = new Set(options.map((o) => o.name))
  const rules = [
    { attribute: 'enabled_in_store', value: 'true', operator: 'eq' as const },
    { attribute: 'is_return', value: 'false', operator: 'eq' as const },
  ]
  const option = (name: string, amount: number, type: { label: string; description: string; code: string }) => ({
    name,
    price_type: 'flat' as const,
    provider_id: template.provider_id ?? 'manual_manual',
    service_zone_id: template.service_zone_id,
    shipping_profile_id: template.shipping_profile_id,
    type,
    prices: [
      { currency_code: CURRENCY, amount },
      { region_id: regions[0].id, amount },
    ],
    rules,
  })

  const create = [
    ...DELIVERY_BY_CITY.map(([city, price]) =>
      option(`${DELIVERY_PREFIX}${city}`, price, { label: 'Delivery', description: `Delivery en ${city}.`, code: 'delivery' })
    ),
    option(PARCEL_OPTION, 0, { label: 'Encomienda', description: 'Envío por encomienda al interior; el flete se paga al recibir.', code: 'parcel' }),
  ].filter((o) => !existing.has(o.name))

  if (create.length) {
    await createShippingOptionsWorkflow(container).run({ input: create })
    logger.info(`Envíos por ciudad: ${create.length} formas de entrega creadas.`)
  }

  const old = options.filter((o) => o.name === OLD_FLAT_OPTION)
  if (old.length) {
    await deleteShippingOptionsWorkflow(container).run({ input: { ids: old.map((o) => o.id) } })
    logger.info(`Envíos por ciudad: "${OLD_FLAT_OPTION}" (precio único) quitado.`)
  }
}
