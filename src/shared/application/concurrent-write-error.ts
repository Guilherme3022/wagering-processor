/**
 * Uma escrita concorrente violou uma constraint de idempotência/duplicidade (o `23505` que escapa
 * quando duas transações sem lock compartilhado inserem a mesma chave ao mesmo tempo). O use case
 * trata reabrindo uma transação de resolução (replay/conflito) e gravando a inbox (spec §6.1).
 */
export class ConcurrentWriteError extends Error {
  constructor(readonly constraint: string) {
    super(`concurrent write violated ${constraint}`);
    this.name = "ConcurrentWriteError";
  }
}
