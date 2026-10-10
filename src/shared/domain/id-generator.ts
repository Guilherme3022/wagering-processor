/** Gera identificadores únicos e ordenáveis no tempo (UUIDv7, ADR-012). */
export interface IdGenerator {
  next(): string;
}
