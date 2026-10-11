import { Injectable } from "@nestjs/common";
import { pino, type Logger } from "pino";
import { type AppConfig } from "./config/app-config";
import { InjectConfig } from "./config/config.module";
import { CorrelationService } from "./correlation";

/**
 * Logger JSON (pino) com redaction (spec §10). Todo log carrega os campos de correlação do
 * `AsyncLocalStorage`. Valores monetários, saldos e corpos completos nunca são logados.
 */
/** Caminhos censurados nos logs (spec §10): dinheiro, saldos, corpos e credenciais. */
export const REDACT_PATHS = [
  "*.amount",
  "*.money",
  "money",
  "balance",
  "*.balance",
  "*.balanceAfter",
  "*.balanceBefore",
  "req.body",
  "request.body",
  "message.body",
  "payload",
  "headers.authorization",
  'headers["x-api-key"]',
];

@Injectable()
export class LoggerService {
  private readonly logger: Logger;

  constructor(
    @InjectConfig() config: AppConfig,
    private readonly correlation: CorrelationService,
  ) {
    this.logger = pino({
      level: config.logLevel,
      base: { instanceId: config.instanceId },
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    });
  }

  info(message: string, fields: Record<string, unknown> = {}): void {
    this.logger.info(this.merge(fields), message);
  }

  warn(message: string, fields: Record<string, unknown> = {}): void {
    this.logger.warn(this.merge(fields), message);
  }

  error(message: string, fields: Record<string, unknown> = {}): void {
    this.logger.error(this.merge(fields), message);
  }

  private merge(fields: Record<string, unknown>): Record<string, unknown> {
    return { ...this.correlation.get(), ...fields };
  }
}
