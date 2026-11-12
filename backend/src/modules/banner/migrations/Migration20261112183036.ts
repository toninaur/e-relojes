import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261112183036 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "banner" ("id" text not null, "title" text not null, "text" text null, "image_url" text not null, "image_alt" text null, "image_fit" text check ("image_fit" in ('contain', 'cover')) not null default 'contain', "button_label" text null, "button_url" text null, "rank" integer not null default 0, "is_active" boolean not null default true, "starts_at" timestamptz null, "ends_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "banner_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_banner_deleted_at" ON "banner" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "banner" cascade;`);
  }

}
