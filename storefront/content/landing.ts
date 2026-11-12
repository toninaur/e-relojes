// Textos e imágenes fijas de la página de inicio. Los productos (destacados,
// combos de perfumes, categorías) salen de Medusa; esto es solo lo editorial.
export const landing = {
  hero: {
    title: 'Relojes de las marcas que conocés, con envíos a todo el país',
    text: 'Tissot, Seiko, Citizen, Casio, Invicta y muchas más. Además, perfumes, joyas y accesorios. Comprá online, visitanos en Asunción o escribinos por WhatsApp.',
    image: '/images/seiko-gmt.jpg',
    imageAlt: 'Reloj Seiko 5 Sports GMT con bisel azul y negro',
  },
  facts: [
    { title: 'Cientos de modelos', text: 'Caballeros, damas y Casio' },
    { title: 'Envíos a todo el país', text: 'Por encomienda' },
    { title: 'Local en Asunción', text: 'Barrio Mburicao' },
    { title: '4,7 en Google', text: 'Con 92 reseñas' },
  ],
  brands: {
    title: 'Algunas de las marcas que trabajamos',
    list: ['Tissot', 'Seiko', 'Citizen', 'Casio', 'Emporio Armani', 'Tommy Hilfiger', 'Michael Kors', 'Fossil', 'Invicta', 'Swarovski'],
  },
  newArrivals: {
    title: 'Nuevos ingresos',
    text: 'Lo último que llegó al local. Se actualiza solo cada vez que publicamos un producto.',
    link: 'Ver todos los nuevos',
  },
  featured: {
    title: 'Relojes destacados',
    text: 'Una selección de nuestro catálogo. Agregalos al carrito o consultanos por WhatsApp.',
    note: 'Los precios están sujetos a variaciones y el stock de cada modelo es limitado.',
  },
  categories: {
    title: 'Explorá el catálogo',
    text: 'Todos los modelos y precios, ordenados por categoría.',
    // Descripción por nombre de categoría de Medusa. Las que no estén acá
    // aparecen igual, sin descripción.
    descriptions: {
      Caballeros: 'Tissot, Seiko, Citizen, Armani, Tommy Hilfiger, Invicta y opciones económicas.',
      Damas: 'Relojes, joyas Swarovski, lentes de sol y pulseras.',
      Casio: 'Edifice, G-Shock y los clásicos de Casio.',
      Perfumes: 'Árabes y de diseñador, en frasco o en decants.',
      Accesorios: 'Joyas, lentes, termos y organizadores.',
    } as Record<string, string>,
  },
  perfumes: {
    title: 'Perfumes y decants',
    text: 'Perfumes árabes como Afnan, Armaf y Al Haramain, y de diseñador como Paco Rabanne, Jean Paul Gaultier, Armani y Valentino.',
    decantTitle: '¿Qué es un decant?',
    decantText:
      'Es una porción del perfume original en un frasco chico de 3, 5 o 10 ml. Ideal para probar una fragancia antes de comprar el frasco completo, o para llevar en la cartera o el bolso.',
    photos: [
      { src: '/images/perfume-9pm.jpg', alt: 'Perfume Afnan 9PM con su decant de 10 ml' },
      { src: '/images/perfume-million.jpg', alt: 'Perfume Paco Rabanne 1 Million Elixir' },
    ],
    combosTitle: 'Combos de 5 decants de 10 ml',
    category: 'Perfumes',
  },
  more: {
    title: 'Más que relojes',
    text: 'Todo para regalar o regalarte, en un solo lugar.',
    items: [
      { title: 'Joyas Swarovski', text: 'Collares, aros y broches con cristales Swarovski.', image: '/images/swarovski-signum.jpg', alt: 'Collar Swarovski con colgante de cisne' },
      { title: 'Lentes de sol', text: 'Ray-Ban, Guess, Calvin Klein y más.', image: '/images/rayban-clubmaster.jpg', alt: 'Lentes de sol Ray-Ban Clubmaster' },
      { title: 'Termos', text: 'Consultá modelos y colores disponibles.', icon: 'thermos' as const },
      { title: 'Organizadores y accesorios', text: 'Pulseras, organizadores y otros accesorios.', icon: 'organizer' as const },
    ],
  },
  howToBuy: {
    title: 'Cómo comprar',
    text: 'Elegí la forma que te quede más cómoda.',
    steps: [
      {
        title: 'Comprá online',
        points: ['Elegí tus productos en el catálogo y agregalos al carrito.', 'Envío a domicilio o retiro en el local.', 'Pagá por transferencia o en efectivo al recibir.'],
        cta: { label: 'Ver catálogo', href: '/catalogo', style: 'dark' as const },
      },
      {
        title: 'Pedí por WhatsApp',
        points: ['Delivery con costo según la zona.', 'Envíos por encomienda a todo el país.', 'Te asesoramos para elegir.'],
        cta: { label: 'Escribinos', href: 'whatsapp', style: 'outline' as const },
      },
      {
        title: 'Visitá el local',
        points: ['Radio Operadores del Chaco casi Celsa Speratti 968, Asunción.', 'Lunes a viernes de 9:00 a 18:00, sábados de 9:00 a 14:00.'],
        cta: { label: 'Ver ubicación', href: '/#ubicacion', style: 'outline' as const },
      },
    ],
    gift: {
      title: 'Listo para regalar',
      text: '¿Es un regalo? Avisanos en el pedido o por WhatsApp y lo preparamos para la ocasión.',
      image: '/images/bolsa.jpg',
      alt: 'Bolsa de regalo negra con el logo de e-relojes y moño azul',
    },
  },
  reviews: [
    { text: 'Son bastantes rápidos en la atención al cliente, son eficientes a la hora de mostrar el producto, los productos tienen excelente calidad, recomendado.', author: 'Belén Sosa' },
    { text: 'Bastante rápidos en el momento de contestar a los mensajes, la atención a la hora de recoger el producto en la tienda muy buena, y el producto y su presentación genial.', author: 'Lucas Menesse' },
    { text: 'La atención fué lo que más me gustó, la variedad de relojes es interesante y los precios bastante buenos… Los relojes son originales.', author: 'René Murillo' },
  ],
  location: {
    title: 'Visitanos',
    text: 'Vení a ver los relojes en persona antes de comprar.',
  },
}
