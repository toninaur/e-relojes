import es from './es.json'

// Panel en español por defecto. Medusa elige el idioma por la cookie o el
// localStorage "lng" y, sin ninguno, usa inglés: si nadie eligió idioma
// todavía, se fija español. Cada usuario lo puede cambiar en Mi cuenta → Perfil.
try {
  const chosen = document.cookie.split('; ').some((c) => c.startsWith('lng=')) || localStorage.getItem('lng')
  if (!chosen) localStorage.setItem('lng', 'es')
} catch {
  // Sin acceso al almacenamiento del navegador: queda el idioma de Medusa.
}

// Textos del panel con las palabras del local (Marcas, Ofertas, Marcar como
// pagado, Envío…), por encima de la traducción oficial. Se generan con
// `node scripts/admin-es.mjs`.
export default {
  es: { translation: es },
}
