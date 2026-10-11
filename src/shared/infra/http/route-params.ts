import { z } from "zod";
import { ValidationError } from "./app-error";

const uuid = z.string().uuid();

/** Valida um parâmetro de rota como UUID; caso contrário, 400 `INVALID_PAYLOAD` (não 500). */
export function uuidParam(value: string, field: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`${field} must be a valid UUID`, [{ path: field, message: "invalid uuid" }]);
  }
  return parsed.data;
}
