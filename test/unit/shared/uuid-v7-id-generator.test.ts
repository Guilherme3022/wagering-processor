import { describe, expect, test } from "bun:test";
import { UuidV7IdGenerator } from "../../../src/shared/infra/uuid-v7-id-generator";

describe("UuidV7IdGenerator", () => {
  const generator = new UuidV7IdGenerator();

  test("generates RFC 9562 version 7 identifiers", () => {
    const id = generator.next();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("ids generated in sequence sort in generation order", () => {
    const ids = Array.from({ length: 1000 }, () => generator.next());

    expect([...ids].sort()).toEqual(ids);
  });

  test("ids are unique", () => {
    const ids = Array.from({ length: 1000 }, () => generator.next());

    expect(new Set(ids).size).toBe(ids.length);
  });
});
