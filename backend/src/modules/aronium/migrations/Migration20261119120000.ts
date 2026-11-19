import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// Bitácora: eventos "published" (producto que se publicó solo al tener foto,
// categoría y stock) y "hidden" (se ocultó al quedarse sin stock).
export class Migration20261119120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "aronium_change" drop constraint if exists "aronium_change_field_check";`);

    this.addSql(`alter table if exists "aronium_change" add constraint "aronium_change_field_check" check("field" in ('price', 'stock', 'created', 'removed', 'image', 'content', 'published', 'hidden'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "aronium_change" drop constraint if exists "aronium_change_field_check";`);

    this.addSql(`delete from "aronium_change" where "field" in ('published', 'hidden');`);

    this.addSql(`alter table if exists "aronium_change" add constraint "aronium_change_field_check" check("field" in ('price', 'stock', 'created', 'removed', 'image', 'content'));`);
  }

}
