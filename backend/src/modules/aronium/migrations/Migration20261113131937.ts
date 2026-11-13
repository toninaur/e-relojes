import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261113131937 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "aronium_change" drop constraint if exists "aronium_change_field_check";`);

    this.addSql(`alter table if exists "aronium_agent" add column if not exists "interval_minutes" integer not null default 5, add column if not exists "known_codes" jsonb null;`);

    this.addSql(`alter table if exists "aronium_run" add column if not exists "removed" integer not null default 0;`);

    this.addSql(`alter table if exists "aronium_change" add constraint "aronium_change_field_check" check("field" in ('price', 'stock', 'created', 'removed', 'image'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "aronium_change" drop constraint if exists "aronium_change_field_check";`);

    this.addSql(`alter table if exists "aronium_agent" drop column if exists "interval_minutes", drop column if exists "known_codes";`);

    this.addSql(`alter table if exists "aronium_run" drop column if exists "removed";`);

    this.addSql(`alter table if exists "aronium_change" add constraint "aronium_change_field_check" check("field" in ('price', 'stock', 'created', 'image'));`);
  }

}
