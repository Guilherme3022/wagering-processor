/**
 * Mesmo `messageId` reentregue com payload diferente (spec §6.6): mensagem envenenada. Não é
 * negócio nem transitório — o consumidor manda para a DLQ. Não ocorre no caminho HTTP.
 */
export class InboxPayloadConflictError extends Error {
  constructor(readonly messageId: string) {
    super(`inbox message ${messageId} replayed with a different payload`);
    this.name = "InboxPayloadConflictError";
  }
}
