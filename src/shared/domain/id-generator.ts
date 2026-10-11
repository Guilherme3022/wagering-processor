/** Gera identificadores únicos e ordenáveis no tempo (UUIDv7, ADR-012). */
export interface IdGenerator {
  next(): string;
}

/** Token de injeção da porta `IdGenerator`. */
export const ID_GENERATOR = Symbol("ID_GENERATOR");
