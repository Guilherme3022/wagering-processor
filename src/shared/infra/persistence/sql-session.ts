import { type EntityManager } from "@mikro-orm/postgresql";

/**
 * Executa SQL cru participando da transação do `EntityManager` recebido (o `ctx` do MikroORM).
 * Todas as leituras e escritas de uma operação financeira passam por aqui, dentro de
 * `em.transactional()`, para que BEGIN/COMMIT e os locks sejam os mesmos do fluxo.
 */
export class SqlSession {
  constructor(private readonly em: EntityManager) {}

  /** SELECT (ou qualquer statement com `RETURNING`) devolvendo linhas tipadas. */
  select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.em.getConnection().execute<T[]>(sql, params, "all", this.em.getTransactionContext());
  }

  /** INSERT/UPDATE/DELETE devolvendo o número de linhas afetadas. */
  async command(sql: string, params: unknown[] = []): Promise<number> {
    const result = await this.em
      .getConnection()
      .execute<{ affectedRows?: number }>(sql, params, "run", this.em.getTransactionContext());
    return result.affectedRows ?? 0;
  }

  /** Statement livre sem retorno (ex.: `SET LOCAL lock_timeout`). */
  async raw(sql: string, params: unknown[] = []): Promise<void> {
    await this.em.getConnection().execute(sql, params, "run", this.em.getTransactionContext());
  }
}
