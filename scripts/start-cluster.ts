import { type Subprocess } from "bun";

/**
 * Sobe 3 instâncias da app em portas distintas, compartilhando banco e filas, para testes
 * manuais de concorrência e multi-instância (AGENTS §3). Ctrl+C derruba todas.
 */
const PORTS = [3000, 3001, 3002];

const children: Subprocess[] = PORTS.map((port) =>
  Bun.spawn(["bun", "run", "src/main.ts"], {
    env: { ...process.env, PORT: String(port), INSTANCE_ID: `instance-${port}` },
    stdout: "inherit",
    stderr: "inherit",
  }),
);

process.stdout.write(`Cluster no ar: ${PORTS.map((p) => `http://localhost:${p}`).join(", ")}\n`);

function shutdown(): void {
  for (const child of children) {
    child.kill("SIGTERM");
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await Promise.all(children.map((child) => child.exited));
