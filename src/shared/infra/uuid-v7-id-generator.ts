import { type IdGenerator } from "../domain/id-generator";

export class UuidV7IdGenerator implements IdGenerator {
  next(): string {
    return Bun.randomUUIDv7();
  }
}
