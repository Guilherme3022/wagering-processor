import { MikroORM } from "@mikro-orm/postgresql";
import config from "../mikro-orm.config";

/**
 * Runner de migrations sobre o Migrator do MikroORM (rodado pelo Bun, sem ts-node).
 * Uso: `bun run scripts/migrate.ts <up|down|create|list|fresh>`.
 */
async function main(): Promise<void> {
  const command = process.argv[2] ?? "up";
  const orm = await MikroORM.init(config);
  const migrator = orm.getMigrator();
  try {
    switch (command) {
      case "up":
        await migrator.up();
        break;
      case "down":
        await migrator.down();
        break;
      case "create":
        await migrator.createMigration(undefined, true);
        break;
      case "list": {
        const pending = await migrator.getPendingMigrations();
        const executed = await migrator.getExecutedMigrations();
        process.stdout.write(
          `executed: ${executed.map((m) => m.name).join(", ") || "(none)"}\n` +
            `pending: ${pending.map((m) => m.name).join(", ") || "(none)"}\n`,
        );
        break;
      }
      case "fresh":
        await migrator.down({ to: 0 });
        await migrator.up();
        break;
      default:
        throw new Error(`unknown migrate command: ${command}`);
    }
  } finally {
    await orm.close(true);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
