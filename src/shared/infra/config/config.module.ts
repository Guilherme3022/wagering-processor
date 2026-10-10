import { Global, Inject, Module } from "@nestjs/common";
import { type AppConfig, loadConfig } from "./app-config";

export const APP_CONFIG = Symbol("APP_CONFIG");

/** Atalho para injetar a configuração validada: `constructor(@InjectConfig() config: AppConfig)`. */
export const InjectConfig = (): ParameterDecorator => Inject(APP_CONFIG);

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
