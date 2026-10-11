import { loadConfig } from "./src/shared/infra/config/app-config";
import { buildOrmConfig } from "./src/shared/infra/persistence/orm";

// Ponto de entrada da CLI e do runner de migrations (scripts/migrate.ts).
export default buildOrmConfig(loadConfig(process.env));
