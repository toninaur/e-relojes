import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261120155033 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "contimarket_product" drop constraint if exists "contimarket_product_code_unique";`);
    this.addSql(`create table if not exists "contimarket_product" ("id" text not null, "code" text not null, "product_id" text null, "title" text null, "hash" text null, "status" text check ("status" in ('ok', 'error')) not null default 'ok', "last_error" text null, "stock" integer not null default 0, "price" integer not null default 0, "sent_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "contimarket_product_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_contimarket_product_code_unique" ON "contimarket_product" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_contimarket_product_deleted_at" ON "contimarket_product" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "contimarket_run" ("id" text not null, "status" text check ("status" in ('ok', 'error')) not null default 'ok', "full" boolean not null default false, "reason" text null, "sent" integer not null default 0, "rejected" integer not null default 0, "error" text null, "duration_ms" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "contimarket_run_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_contimarket_run_deleted_at" ON "contimarket_run" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "contimarket_settings" ("id" text not null, "enabled" boolean not null default false, "paused" boolean not null default false, "products" text check ("products" in ('all', 'tagged')) not null default 'all', "price_rule" text check ("price_rule" in ('same', 'offer', 'percent')) not null default 'same', "price_percent" integer not null default 0, "min_stock" integer not null default 1, "dimensions" jsonb null, "full_requested" boolean not null default false, "last_run_at" timestamptz null, "last_full_at" timestamptz null, "last_error" text null, "last_error_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "contimarket_settings_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_contimarket_settings_deleted_at" ON "contimarket_settings" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "contimarket_product" cascade;`);

    this.addSql(`drop table if exists "contimarket_run" cascade;`);

    this.addSql(`drop table if exists "contimarket_settings" cascade;`);
  }

}
