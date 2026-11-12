// Datos del negocio, en un solo lugar. Para un cliente nuevo: editar este
// archivo, los textos de content/landing.ts, los colores de app/globals.css y
// las imágenes de public/brand y public/images. Ningún componente debería
// tener datos del cliente escritos a mano.
export const brand = {
  name: 'e-relojes',
  legalName: 'e-relojes Paraguay',
  description:
    'Relojes Tissot, Seiko, Citizen, Casio, Invicta y más, perfumes y decants, joyas y accesorios. Local en Asunción y envíos a todo el país.',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:8000',
  // Sitio de demostración: aviso arriba de todo y fuera de Google.
  demo: process.env.NEXT_PUBLIC_DEMO_MODE === '1',
  logo: '/brand/logo.png',
  whatsapp: {
    number: '595992295298',
    display: '0992 295 298',
    greeting: 'Hola, e-relojes.',
  },
  // Catálogos en PDF que el local comparte por Drive.
  catalogsUrl: 'https://drive.google.com/drive/folders/1TznXmLfO0PEeuW9-vA1lI9IiPtmZvw0F',
  social: [
    { label: 'Instagram', handle: '@e.relojes_paraguay', url: 'https://www.instagram.com/e.relojes_paraguay/' },
    { label: 'TikTok', handle: '@e.relojes_paraguay', url: 'https://www.tiktok.com/@e.relojes_paraguay' },
  ],
  location: {
    address: 'Radio Operadores del Chaco casi Celsa Speratti 968, barrio Mburicao, Asunción',
    hours: ['Lunes a viernes, 9:00 a 18:00', 'Sábados, 9:00 a 14:00'],
    mapsUrl:
      'https://www.google.com/maps/place/e-relojes+Paraguay/@-25.3029362,-57.5994267,18.08z/data=!4m6!3m5!1s0x945da888291a5e8d:0x49cdb17e548288ac!8m2!3d-25.3031824!4d-57.5984128!16s%2Fg%2F11gfj4_mtz',
    mapEmbedUrl: 'https://www.google.com/maps?q=-25.3031824,-57.5984128&z=17&output=embed',
    doorPhoto: '/images/porton.jpg',
    doorHint: 'Buscá el portón gris con el cartel de e-relojes y el número 968.',
  },
  // Datos para pagar por transferencia: se muestran al confirmar el pedido.
  // DEMO: completar con la cuenta real del cliente.
  payment: {
    transferInstructions: [
      'Banco: (a completar)',
      'Titular: e-relojes Paraguay',
      'Cuenta: (a completar)',
      'RUC / CI: (a completar)',
      'Alias: (a completar)',
    ].join('\n'),
  },
  reviews: {
    score: '4,7',
    count: 92,
    source: 'Google',
    url: 'https://www.google.com/maps/place/e-relojes+Paraguay/@-25.3029362,-57.5994267,18.08z/data=!4m6!3m5!1s0x945da888291a5e8d:0x49cdb17e548288ac!8m2!3d-25.3031824!4d-57.5984128!16s%2Fg%2F11gfj4_mtz',
  },
}

export function absoluteUrl(path: string): string {
  return `${brand.siteUrl}${path}`
}

export function whatsappUrl(message?: string): string {
  const base = `https://wa.me/${brand.whatsapp.number}`
  return message ? `${base}?text=${encodeURIComponent(message)}` : base
}
