/**
 * Controla os containers da infra de teste via `docker pause`/`unpause` (spec §12.1). Único
 * ponto que depende do Docker CLI. O `unpause` deve ser garantido no `afterAll` de cada teste.
 */
export const PG_CONTAINER = process.env.TEST_PG_CONTAINER ?? "wagering-processor-postgres-test-1";
export const SQS_CONTAINER = process.env.TEST_SQS_CONTAINER ?? "wagering-processor-sqs-test-1";

async function docker(action: "pause" | "unpause", container: string): Promise<void> {
  const proc = Bun.spawn(["docker", action, container], { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    // `unpause` de container já ativo falha; tratamos como idempotente.
    if (!stderr.includes("not paused")) {
      throw new Error(`docker ${action} ${container} failed: ${stderr}`);
    }
  }
}

export const pauseContainer = (container: string): Promise<void> => docker("pause", container);
export const unpauseContainer = (container: string): Promise<void> => docker("unpause", container);
