import { configureStoreSearch, defineMiddlewares } from '@medusajs/framework/http'

// The product index declares filterable `status` and `sales_channel_ids`, so
// the route narrows it to published products in the key's sales channels.
export default defineMiddlewares({
  routes: [
    {
      method: ['POST'],
      matcher: '/store/search',
      middlewares: [
        configureStoreSearch({
          allowed_indexes: {
            product: true,
          },
        }),
      ],
    },
    {
      // El conector de Aronium puede mandar fotos (base64) en el lote.
      method: ['POST'],
      matcher: '/admin/aronium/sync',
      bodyParser: { sizeLimit: '25mb' },
    },
  ],
})
