import { Injectable } from "@nestjs/common";
import { IsolationLevel as OrmIsolationLevel } from "@mikro-orm/postgresql";
import {
  type IsolationLevel,
  type PersistencePorts,
  type UnitOfWork,
} from "../../application/persistence";
import { InjectConfig } from "../config/config.module";
import { type AppConfig } from "../config/app-config";
import { Database } from "./database";
import { type SqlSession } from "./sql-session";
import {
  SqlInboxStore,
  SqlLedgerStore,
  SqlOutboxStore,
  SqlWagerTransactionStore,
  SqlWalletStore,
} from "./stores";

/**
 * Implementa a `UnitOfWork` sobre `Database.transaction`. Abre a transação, aplica
 * `SET LOCAL lock_timeout` e o nível de isolamento pedido, e entrega os stores ligados à mesma
 * `SqlSession`. Fora daqui não há como escrever no banco de uma operação financeira.
 */
@Injectable()
export class SqlUnitOfWork implements UnitOfWork {
  constructor(
    private readonly database: Database,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async transaction<T>(
    work: (ports: PersistencePorts) => Promise<T>,
    options: { isolationLevel?: IsolationLevel; lockTimeoutMs?: number } = {},
  ): Promise<T> {
    const isolationLevel = mapIsolation(options.isolationLevel);
    return this.database.transaction(
      async (session) => {
        const lockTimeout = options.lockTimeoutMs ?? this.config.database.lockTimeoutMs;
        await session.raw(`SET LOCAL lock_timeout = '${lockTimeout}ms'`);
        return work(this.buildPorts(session));
      },
      isolationLevel === undefined ? {} : { isolationLevel },
    );
  }

  private buildPorts(session: SqlSession): PersistencePorts {
    return {
      wallets: new SqlWalletStore(session),
      ledger: new SqlLedgerStore(session),
      transactions: new SqlWagerTransactionStore(session),
      outbox: new SqlOutboxStore(session),
      inbox: new SqlInboxStore(session),
    };
  }
}

function mapIsolation(level: IsolationLevel | undefined): OrmIsolationLevel | undefined {
  if (level === "repeatable read") {
    return OrmIsolationLevel.REPEATABLE_READ;
  }
  if (level === "read committed") {
    return OrmIsolationLevel.READ_COMMITTED;
  }
  return undefined;
}
