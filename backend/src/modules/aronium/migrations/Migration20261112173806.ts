import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261112173806 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "aronium_agent" ("id" text not null, "last_seen_at" timestamptz null, "version" text null, "host" text null, "products_total" integer not null default 0, "last_error" text null, "last_error_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "aronium_agent_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_aronium_agent_deleted_at" ON "aronium_agent" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "aronium_run" ("id" text not null, "status" text check ("status" in ('ok', 'error')) not null default 'ok', "items_received" integer not null default 0, "prices_updated" integer not null default 0, "stock_updated" integer not null default 0, "created" integer not null default 0, "images_added" integer not null default 0, "error" text null, "duration_ms" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "aronium_run_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_aronium_run_deleted_at" ON "aronium_run" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "aronium_change" ("id" text not null, "code" text not null, "product_id" text null, "product_title" text null, "field" text check ("field" in ('price', 'stock', 'created', 'image')) not null, "old_value" text null, "new_value" text null, "run_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "aronium_change_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_aronium_change_run_id" ON "aronium_change" ("run_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_aronium_change_deleted_at" ON "aronium_change" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "aronium_change" add constraint "aronium_change_run_id_foreign" foreign key ("run_id") references "aronium_run" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "aronium_change" drop constraint if exists "aronium_change_run_id_foreign";`);

    this.addSql(`drop table if exists "aronium_agent" cascade;`);

    this.addSql(`drop table if exists "aronium_run" cascade;`);

    this.addSql(`drop table if exists "aronium_change" cascade;`);
  }

}
