import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261117182427 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "aronium_web_sale" drop constraint if exists "aronium_web_sale_order_id_unique";`);
    this.addSql(`create table if not exists "aronium_web_sale" ("id" text not null, "order_id" text not null, "display_id" integer not null, "status" text check ("status" in ('pending', 'registered', 'failed', 'cancel_pending', 'cancelled')) not null default 'pending', "paid" boolean not null default false, "payment_registered" boolean not null default false, "payload" jsonb not null, "aronium_number" text null, "aronium_refund_number" text null, "attempts" integer not null default 0, "last_error" text null, "warning" text null, "registered_at" timestamptz null, "cancelled_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "aronium_web_sale_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_aronium_web_sale_order_id_unique" ON "aronium_web_sale" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_aronium_web_sale_deleted_at" ON "aronium_web_sale" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "aronium_change" drop constraint if exists "aronium_change_field_check";`);

    this.addSql(`alter table if exists "aronium_agent" add column if not exists "token_hash" text null, add column if not exists "token_created_at" timestamptz null, add column if not exists "refresh_codes" jsonb null;`);

    this.addSql(`alter table if exists "aronium_change" add constraint "aronium_change_field_check" check("field" in ('price', 'stock', 'created', 'removed', 'image', 'content'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "aronium_web_sale" cascade;`);

    this.addSql(`alter table if exists "aronium_change" drop constraint if exists "aronium_change_field_check";`);

    this.addSql(`alter table if exists "aronium_agent" drop column if exists "token_hash", drop column if exists "token_created_at", drop column if exists "refresh_codes";`);

    this.addSql(`alter table if exists "aronium_change" add constraint "aronium_change_field_check" check("field" in ('price', 'stock', 'created', 'removed', 'image'));`);
  }

}
