import { type Clock } from "../../src/shared/domain/clock";

/** Relógio controlável para testes de prazo e backoff (ADR-004). Nunca mexe no relógio do SO. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date("2026-01-01T00:00:00.000Z")) {
    this.current = start;
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(at: Date): void {
    this.current = new Date(at.getTime());
  }
}
