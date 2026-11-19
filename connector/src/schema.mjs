import { DatabaseSync } from 'node:sqlite'

// Control de versión de la base de Aronium antes de escribir proformas y ventas (regla 8:
// "ante la duda, no escribe"). Aronium no documenta su base y una
// actualización puede cambiarla. El agente compara con la estructura que
// conoce (Aronium Lite 1.52, 78 migraciones, noviembre de 2026):
// - Tienen que existir todas las columnas que el agente lee o escribe.
// - En las tablas donde inserta, una columna nueva obligatoria y sin valor
//   por defecto bloquea: Aronium estaría esperando un dato que el agente no
//   conoce.
// Si algo no cierra, el agente sigue sincronizando stock y precios (solo
// lectura) y el panel muestra por qué no registra ventas.

const KNOWN = {
  Document: ['Id', 'Number', 'UserId', 'CustomerId', 'OrderNumber', 'Date', 'StockDate', 'Total', 'IsClockedOut', 'DocumentTypeId', 'WarehouseId', 'ReferenceDocumentNumber', 'DateCreated', 'DateUpdated', 'InternalNote', 'Note', 'DueDate', 'Discount', 'DiscountType', 'PaidStatus', 'DiscountApplyRule', 'ServiceType'],
  DocumentItem: ['Id', 'DocumentId', 'ProductId', 'Quantity', 'ExpectedQuantity', 'PriceBeforeTax', 'Price', 'Discount', 'DiscountType', 'ProductCost', 'PriceBeforeTaxAfterDiscount', 'PriceAfterDiscount', 'Total', 'TotalAfterDocumentDiscount', 'DiscountApplyRule'],
  DocumentItemTax: ['DocumentItemId', 'TaxId', 'Amount'],
  DocumentType: ['Id', 'Name', 'Code', 'DocumentCategoryId', 'WarehouseId', 'StockDirection'],
  Payment: ['Id', 'DocumentId', 'PaymentTypeId', 'Amount', 'Date', 'UserId', 'ZReportId', 'DateCreated', 'RoundingAdjustment'],
  PaymentType: ['Id', 'Name', 'IsEnabled', 'MarkAsPaid'],
  Stock: ['Id', 'ProductId', 'WarehouseId', 'Quantity'],
  Counter: ['Name', 'Value'],
  Customer: ['Id', 'Code', 'Name', 'TaxNumber', 'Address', 'PostalCode', 'City', 'CountryId', 'DateCreated', 'DateUpdated', 'Email', 'PhoneNumber', 'IsEnabled', 'IsCustomer', 'IsSupplier'],
  Country: ['Id', 'Name', 'Code'],
  Product: ['Id', 'Name', 'Code', 'Price', 'IsTaxInclusivePrice', 'IsService', 'Cost'],
  ProductTax: ['ProductId', 'TaxId'],
  Tax: ['Id', 'Name', 'Rate', 'IsFixed', 'IsEnabled'],
  User: ['Id', 'FirstName', 'LastName', 'Username', 'IsEnabled'],
}

// Tablas donde el agente inserta filas.
const INSERTS = ['Document', 'DocumentItem', 'DocumentItemTax', 'Payment', 'Stock', 'Counter', 'Customer']

/** @returns {{ ok: true } | { ok: false, reason: string }} */
export function checkSchema(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 })
  try {
    const problems = []
    for (const [table, columns] of Object.entries(KNOWN)) {
      const info = db.prepare(`PRAGMA table_info("${table}")`).all()
      if (!info.length) {
        problems.push(`falta la tabla ${table}`)
        continue
      }
      const names = new Set(info.map((c) => c.name))
      const missing = columns.filter((c) => !names.has(c))
      if (missing.length) problems.push(`${table} sin ${missing.join(', ')}`)
      if (INSERTS.includes(table)) {
        const required = info.filter((c) => c.notnull && c.dflt_value === null && !c.pk && !columns.includes(c.name) && !(KNOWN_EXTRA[table] ?? []).includes(c.name))
        if (required.length) problems.push(`${table} pide datos nuevos (${required.map((c) => c.name).join(', ')})`)
      }
    }
    if (problems.length) {
      return {
        ok: false,
        reason: `Esta versión de Aronium cambió su base (${problems.join('; ')}). El conector sigue copiando stock y precios, pero no registra pedidos web hasta actualizarlo.`,
      }
    }
    return { ok: true }
  } finally {
    db.close()
  }
}

// Columnas obligatorias de la versión conocida que el agente completa sin
// nombrarlas en KNOWN (tienen el mismo valor siempre).
const KNOWN_EXTRA = {
  Customer: ['IsTaxExempt', 'DueDatePeriod'],
}
