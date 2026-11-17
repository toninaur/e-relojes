import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261117211048 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "aronium_web_sale" drop constraint if exists "aronium_web_sale_status_check";`);

    this.addSql(`alter table if exists "aronium_agent" add column if not exists "sync_paused" boolean not null default false, add column if not exists "web_sales_paused" boolean not null default false, add column if not exists "desired_interval" integer null, add column if not exists "full_requested" boolean not null default false, add column if not exists "write_enabled" boolean null, add column if not exists "write_blocked_reason" text null;`);

    this.addSql(`alter table if exists "aronium_web_sale" add constraint "aronium_web_sale_status_check" check("status" in ('pending', 'registered', 'failed', 'cancel_pending', 'cancelled', 'skipped'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "aronium_web_sale" drop constraint if exists "aronium_web_sale_status_check";`);

    this.addSql(`alter table if exists "aronium_agent" drop column if exists "sync_paused", drop column if exists "web_sales_paused", drop column if exists "desired_interval", drop column if exists "full_requested", drop column if exists "write_enabled", drop column if exists "write_blocked_reason";`);

    this.addSql(`alter table if exists "aronium_web_sale" add constraint "aronium_web_sale_status_check" check("status" in ('pending', 'registered', 'failed', 'cancel_pending', 'cancelled'));`);
  }

}
