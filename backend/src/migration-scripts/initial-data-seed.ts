import { MedusaContainer } from "@medusajs/framework";
import { DEFAULT_REGION_STORE_POLICIES } from "../lib/region-store-policies";
import {
  ContainerRegistrationKeys,
  ModuleRegistrationName,
  Modules,
} from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows";

// Datos iniciales del e-commerce: una sola tienda en Paraguay, en guaraníes.
// Corre una única vez, con el primer `medusa db:migrate`. Todo lo que crea
// (región, envíos, local) se edita después desde el admin, así
// que el código no depende de estos valores.
//
// Los montos en Medusa 2 van en unidades mayores: 150000 = Gs. 150.000.
const COUNTRY = "py";
const CURRENCY = "pyg";
const SHIPPING_PRICE = DEFAULT_REGION_STORE_POLICIES.shipping_rate;

export default async function initial_data_seed({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(
    ModuleRegistrationName.FULFILLMENT
  );

  // Medusa registra los scripts por nombre de archivo: el mismo seed como .ts
  // (desarrollo) y como .js (build de producción) cuenta como dos scripts. Si
  // la base ya tiene los datos, no se crean duplicados.
  const { data: existingRegions } = await query.graph({
    entity: "region",
    fields: ["id"],
  });
  if (existingRegions.length) {
    logger.info("Initial data already present, skipping seed.");
    return;
  }

  logger.info("Seeding store data...");
  const {
    result: [defaultSalesChannel],
  } = await createSalesChannelsWorkflow(container).run({
    input: {
      salesChannelsData: [
        { name: "Tienda online", description: "Storefront web" },
      ],
    },
  });

  const {
    result: [publishableApiKey],
  } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [{ title: "Storefront", type: "publishable", created_by: "" }],
    },
  });

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: publishableApiKey.id, add: [defaultSalesChannel.id] },
  });

  await createStoresWorkflow(container).run({
    input: {
      stores: [
        {
          name: "Tienda",
          supported_currencies: [{ currency_code: CURRENCY, is_default: true }],
          default_sales_channel_id: defaultSalesChannel.id,
        },
      ],
    },
  });

  logger.info("Seeding region data...");
  const {
    result: [region],
  } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "Paraguay",
          currency_code: CURRENCY,
          countries: [COUNTRY],
          // Pago manual (transferencia / contra entrega). La pasarela online
          // queda pendiente.
          payment_providers: ["pp_system_default"],
          metadata: DEFAULT_REGION_STORE_POLICIES,
        },
      ],
    },
  });

  await createTaxRegionsWorkflow(container).run({
    input: [{ country_code: COUNTRY, provider_id: "tp_system" }],
  });

  logger.info("Seeding stock location data...");
  const {
    result: [stockLocation],
  } = await createStockLocationsWorkflow(container).run({
    input: {
      locations: [
        {
          name: "Local principal",
          address: { city: "Asunción", country_code: "PY", address_1: "" },
        },
      ],
    },
  });

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
  });

  logger.info("Seeding fulfillment data...");
  // El shipping profile por defecto lo crea una migración del core.
  const { data: shippingProfiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  });
  const shippingProfile = shippingProfiles[0];

  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: "Entregas Paraguay",
    type: "shipping",
    service_zones: [
      {
        name: "Paraguay",
        geo_zones: [{ country_code: COUNTRY, type: "country" }],
      },
    ],
  });

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
  });

  const storeRules = [
    { attribute: "enabled_in_store", value: "true", operator: "eq" as const },
    { attribute: "is_return", value: "false", operator: "eq" as const },
  ];

  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Envío a domicilio",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Envío",
          description: "Envío a domicilio.",
          code: "shipping",
        },
        prices: [
          { currency_code: CURRENCY, amount: SHIPPING_PRICE },
          { region_id: region.id, amount: SHIPPING_PRICE },
        ],
        rules: storeRules,
      },
      {
        name: "Retiro en el local",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Retiro",
          description: "Retiro en el local, sin costo.",
          code: "pickup",
        },
        prices: [
          { currency_code: CURRENCY, amount: 0 },
          { region_id: region.id, amount: 0 },
        ],
        rules: storeRules,
      },
    ],
  });

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocation.id, add: [defaultSalesChannel.id] },
  });

  logger.info("Finished seeding initial data.");
}
