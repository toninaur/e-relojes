// Código de seguimiento del pedido web (PW-1042-K7): el número del pedido y
// dos caracteres de control. Es el que el conector pone en la proforma de
// Aronium, así la cajera la encuentra con el comprobante de WhatsApp.
// Tiene que dar lo mismo que trackingCode() en
// backend/src/lib/aronium-web-sales.ts.

const CHECK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function trackingCode(displayId: number): string {
  const n = CHECK_ALPHABET.length
  let h = 2166136261
  for (const ch of String(displayId)) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }
  return `PW-${displayId}-${CHECK_ALPHABET[h % n]}${CHECK_ALPHABET[Math.floor(h / n) % n]}`
}
