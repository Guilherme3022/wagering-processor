import { Controller, Get, Header } from "@nestjs/common";
import { MetricsService } from "../metrics";

/** Exposição Prometheus (spec §10). Sem auth — documentado como rede interna. */
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4")
  render(): Promise<string> {
    return this.metrics.render();
  }
}
