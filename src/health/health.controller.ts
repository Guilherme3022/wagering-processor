import { Controller, Get, HttpCode, HttpException } from "@nestjs/common";
import { type AppConfig } from "../shared/infra/config/app-config";
import { InjectConfig } from "../shared/infra/config/config.module";
import { Database } from "../shared/infra/persistence/database";
import { SqsClient } from "../messaging/infra/sqs/sqs-client";

interface ReadyResult {
  readonly status: "ok";
  readonly checks: Record<string, "ok">;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Health sem auth (spec §10). `live` não toca dependências; `ready` checa o banco. */
@Controller("health")
export class HealthController {
  constructor(
    private readonly database: Database,
    private readonly sqs: SqsClient,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  @HttpCode(200)
  async ready(): Promise<ReadyResult> {
    await this.check("postgres", this.database.em.getConnection().execute("SELECT 1"));
    await this.check(
      "sqs",
      Promise.all([
        this.sqs.queueIsReachable(this.config.sqs.inputQueue),
        this.sqs.queueIsReachable(this.config.sqs.deadLetterQueue),
        this.sqs.queueIsReachable(this.config.sqs.eventsQueue),
      ]),
    );
    return { status: "ok", checks: { postgres: "ok", sqs: "ok" } };
  }

  private async check(name: string, probe: Promise<unknown>): Promise<void> {
    try {
      await withTimeout(probe, 1000, name);
    } catch {
      throw new HttpException({ status: "unavailable", check: name }, 503);
    }
  }
}
