import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// Rediseño proforma (18/11/2026): el pedido web entra a Aronium como proforma
// y pasa a venta cuando la cajera la marca "Pagado". Las filas "registered"
// del diseño anterior ya son ventas en Aronium: pasan a "invoiced".
export class Migration20261118190000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "aronium_web_sale" drop constraint if exists "aronium_web_sale_status_check";`);

    this.addSql(`alter table if exists "aronium_web_sale" add column if not exists "tracking_code" text null, add column if not exists "aronium_quote_number" text null, add column if not exists "invoiced_at" timestamptz null;`);

    this.addSql(`update "aronium_web_sale" set "status" = 'invoiced', "invoiced_at" = coalesce("registered_at", "updated_at") where "status" = 'registered';`);

    this.addSql(`alter table if exists "aronium_web_sale" add constraint "aronium_web_sale_status_check" check("status" in ('pending', 'quoted', 'invoiced', 'failed', 'cancel_pending', 'cancelled', 'skipped'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "aronium_web_sale" drop constraint if exists "aronium_web_sale_status_check";`);

    this.addSql(`update "aronium_web_sale" set "status" = 'registered' where "status" in ('quoted', 'invoiced');`);

    this.addSql(`alter table if exists "aronium_web_sale" drop column if exists "tracking_code", drop column if exists "aronium_quote_number", drop column if exists "invoiced_at";`);

    this.addSql(`alter table if exists "aronium_web_sale" add constraint "aronium_web_sale_status_check" check("status" in ('pending', 'registered', 'failed', 'cancel_pending', 'cancelled', 'skipped'));`);
  }

}
