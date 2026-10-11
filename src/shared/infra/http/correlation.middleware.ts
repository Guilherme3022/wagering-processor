import { Injectable, type NestMiddleware } from "@nestjs/common";
import { type Request, type Response, type NextFunction } from "express";
import { CorrelationService } from "../correlation";

const HEADER = "x-correlation-id";

/** Garante um `correlationId` por requisição (do header ou gerado) e o devolve na resposta. */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  constructor(private readonly correlation: CorrelationService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers[HEADER];
    const correlationId = (Array.isArray(header) ? header[0] : header) ?? crypto.randomUUID();
    res.setHeader("X-Correlation-Id", correlationId);
    this.correlation.run({ correlationId }, () => next());
  }
}
