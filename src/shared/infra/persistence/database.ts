import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { EntityManager, IsolationLevel, type MikroORM } from "@mikro-orm/postgresql";
import { withDeadline } from "../delay";
import { SqlSession } from "./sql-session";

/**
 * Dona do `MikroORM` (pool de conexões). Expõe `transaction()` como única porta para operações
 * financeiras: abre `em.transactional()` e entrega uma `SqlSession` ligada à transação. Fecha o
 * ORM no shutdown do Nest (spec §6.6).
 */
@Injectable()
export class Database implements OnApplicationShutdown {
  constructor(
    private readonly orm: MikroORM,
    private readonly closeTimeoutMs = 25_000,
  ) {}

  async transaction<T>(
    work: (session: SqlSession) => Promise<T>,
    options: { isolationLevel?: IsolationLevel } = {},
  ): Promise<T> {
    return this.orm.em.transactional(
      (em) => work(new SqlSession(em)),
      options.isolationLevel === undefined ? undefined : { isolationLevel: options.isolationLevel },
    );
  }

  /** Acesso direto ao EM para health check e leituras simples fora de transação financeira. */
  get em(): EntityManager {
    return this.orm.em;
  }

  async onApplicationShutdown(): Promise<void> {
    // `close(true)` espera as conexões ocupadas; limitamos para uma consulta travada não prender
    // a saída além do grace (o processo encerra em seguida e a conexão é abandonada).
    await withDeadline(this.orm.close(true), this.closeTimeoutMs);
  }
}
