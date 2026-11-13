import { defineWidgetConfig } from '@medusajs/admin-sdk'
import type { AdminOrder, DetailWidgetProps } from '@medusajs/framework/types'
import { Badge, Container, Heading, Text } from '@medusajs/ui'
import { useEffect, useState } from 'react'

// Panel → Pedidos → un pedido: cómo paga y cómo lo recibe el cliente. La
// tienda lo guarda en la metadata del pedido al confirmar la compra
// (storefront/app/carrito/page.tsx).

type Info = {
  metadata: Record<string, unknown> | null
  shipping_methods: { name: string }[] | null
}

const PAYMENT: Record<string, { label: string; hint: string }> = {
  bank_transfer: {
    label: 'Transferencia bancaria',
    hint: 'El cliente manda el comprobante por WhatsApp. Cuando confirmes que llegó la plata, marcá el pedido como pagado (sección Pago → "Marcar como pagado").',
  },
  cash_on_delivery: {
    label: 'Efectivo al recibir',
    hint: 'Se cobra al entregar o cuando lo retira. Después de cobrar, marcá el pedido como pagado (sección Pago → "Marcar como pagado").',
  },
}

const OrderPaymentDelivery = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const [info, setInfo] = useState<Info | null>(null)

  useEffect(() => {
    fetch(`/admin/orders/${order.id}?fields=metadata,*shipping_methods`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(({ order }) => setInfo(order))
      .catch(() => setInfo({ metadata: order.metadata ?? null, shipping_methods: null }))
  }, [order.id, order.metadata])

  const metadata = info?.metadata ?? order.metadata ?? {}
  const payment = PAYMENT[String(metadata.payment_method ?? '')]
  const delivery =
    (typeof metadata.delivery_option === 'string' && metadata.delivery_option) ||
    info?.shipping_methods?.[0]?.name ||
    (metadata.delivery_method === 'pickup' ? 'Retiro en el local' : metadata.delivery_method === 'shipping' ? 'Envío a domicilio' : null)

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Pago y entrega</Heading>
      </div>
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Cómo paga
        </Text>
        {payment ? (
          <>
            <div>
              <Badge color={metadata.payment_method === 'bank_transfer' ? 'blue' : 'green'}>{payment.label}</Badge>
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              {payment.hint}
            </Text>
          </>
        ) : (
          <Text>No indicado (pedido cargado desde el panel)</Text>
        )}
      </div>
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Cómo lo recibe
        </Text>
        <Text>{delivery ?? 'No indicado'}</Text>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: 'order.details.side.before',
})

export default OrderPaymentDelivery
