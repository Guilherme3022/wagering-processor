import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { type AppConfig, InvalidConfigError } from "./shared/infra/config/app-config";
import { APP_CONFIG } from "./shared/infra/config/config.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  // SIGTERM fecha consumidor, workers e ORM de forma ordenada (spec §6.6).
  app.enableShutdownHooks();
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port);
}

bootstrap().catch((error: unknown) => {
  // Antes do logger existir, stderr é o único canal; config inválida deve ser legível de primeira.
  process.stderr.write(`${error instanceof InvalidConfigError ? error.message : String(error)}\n`);
  process.exit(1);
});
