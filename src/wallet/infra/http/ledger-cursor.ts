import { z } from "zod";
import { ValidationError } from "../../../shared/infra/http/app-error";

const cursorSchema = z.object({ v: z.literal(1), seq: z.string().regex(/^\d+$/) });

/** Cursor opaco do ledger: base64url de `{"v":1,"seq":"<n>"}` (spec §7.2, §6 do AGENTS). */
export function encodeCursor(seq: bigint): string {
  return Buffer.from(JSON.stringify({ v: 1, seq: seq.toString() }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): bigint {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = cursorSchema.parse(JSON.parse(decoded));
    return BigInt(parsed.seq);
  } catch {
    throw new ValidationError("malformed cursor");
  }
}
