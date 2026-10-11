import { mkdirSync, writeFileSync } from "node:fs";
import { delay } from "../../src/shared/infra/delay";
import { eventually } from "../support/async";
import { enqueueBet, type Infra, type Instance, provisionInfra, spawnInstance } from "../support/cluster";
import { betBody, openWallet, submit } from "../support/wager";

type Scenario = "distributed" | "hot-wallet" | "duplicates" | "sqs";

interface Options {
  scenario: Scenario;
  rate: number; // requisições por segundo (modelo aberto)
  durationSec: number;
  warmupSec: number;
  wallets: number;
  ports: number[];
}

interface Sample {
  scheduledAt: number;
  latencyMs: number;
  status: number;
  errorClass: string;
}

function parseOptions(): Options {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) {
      args.set(match[1]!, match[2]!);
    }
  }
  return {
    scenario: (args.get("scenario") as Scenario) ?? "distributed",
    rate: Number(args.get("rate") ?? "200"),
    durationSec: Number(args.get("duration") ?? "10"),
    warmupSec: Number(args.get("warmup") ?? "3"),
    wallets: Number(args.get("wallets") ?? "200"),
    ports: [3200, 3201, 3202],
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index]!;
}

function classify(status: number): string {
  if (status === 0) return "timeout";
  if (status === 503) return "503"; // antes do >=500 genérico, senão nunca é alcançado
  if (status >= 500) return "5xx";
  if (status === 409) return "409";
  if (status === 422) return "422";
  if (status >= 200 && status < 300) return "2xx";
  return "other";
}

async function main(): Promise<void> {
  const options = parseOptions();
  process.stdout.write(`load test: ${JSON.stringify(options)}\n`);

  const infra = await provisionInfra();
  const instances = options.ports.map((port) => spawnInstance(infra, port));
  await Promise.all(instances.map((i) => i.waitReady()));

  try {
    const wallets = await seedWallets(instances, options);
    const { samples, lockConflicts, outboxLagMax } =
      options.scenario === "sqs"
        ? await driveSqs(infra, instances, wallets, options)
        : await drive(instances, wallets, options);
    const correctness = await verify(infra, instances, wallets);
    const report = summarize(options, samples, lockConflicts, outboxLagMax, correctness);

    mkdirSync("test/load/results", { recursive: true });
    const file = `test/load/results/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${options.scenario}.json`;
    writeFileSync(file, JSON.stringify(report, null, 2));
    process.stdout.write(`\n${JSON.stringify(report.summary, null, 2)}\nsaved ${file}\n`);
    if (!correctness.consistent) {
      process.stderr.write("CORREÇÃO FALHOU: execução inválida\n");
      process.exitCode = 1;
    }
  } finally {
    for (const instance of instances) {
      instance.kill("SIGKILL");
    }
    await Promise.all(instances.map((i) => i.waitExit()));
    await infra.close();
  }
}

async function seedWallets(
  instances: Instance[],
  options: Options,
): Promise<{ id: string; playerId: string }[]> {
  const count = options.scenario === "hot-wallet" ? 1 : options.wallets;
  const wallets: { id: string; playerId: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    wallets.push(await openWallet(instances[i % instances.length]!, "100000000.00"));
  }
  return wallets;
}

async function drive(
  instances: Instance[],
  wallets: { id: string; playerId: string }[],
  options: Options,
): Promise<{ samples: Sample[]; lockConflicts: number; outboxLagMax: number }> {
  const total = options.rate * options.durationSec;
  const intervalMs = 1000 / options.rate;
  const warmupMs = options.warmupSec * 1000;
  const start = performance.now();
  const pending: Promise<void>[] = [];
  const samples: Sample[] = [];
  let outboxLagMax = 0;

  const lagTimer = setInterval(() => {
    void sampleOutboxLag(instances[0]!).then((lag) => {
      outboxLagMax = Math.max(outboxLagMax, lag);
    });
  }, 1000);
  const lockBefore = await sampleLockConflicts(instances[0]!);

  for (let i = 0; i < total; i += 1) {
    // Horário AGENDADO (absoluto). A latência é medida a partir daqui, não do disparo efetivo:
    // se o loop atrasa, o atraso entra na latência (evita coordinated omission).
    const scheduledAt = start + i * intervalMs;
    const wait = scheduledAt - performance.now();
    if (wait > 0) {
      await delay(wait);
    }
    const instance = instances[i % instances.length]!;
    // Em `duplicates`, 20% são reenvios EXATOS da operação imediatamente anterior (op-(i-1), que
    // nunca é ela mesma um reenvio, pois i é múltiplo de 5 e i-1 não) → replay de verdade.
    const reuse = options.scenario === "duplicates" && i % 5 === 0 && i > 0;
    const target = reuse ? i - 1 : i;
    const wallet = wallets[target % wallets.length]!;
    const external = `op-${target}`;
    // Descarte de aquecimento pelo horário AGENDADO (não pelo de conclusão).
    const measured = i * intervalMs >= warmupMs;
    const promise = fireHttp(instance, wallet, external, scheduledAt).then((sample) => {
      if (measured) {
        samples.push(sample);
      }
    });
    pending.push(promise);
  }

  await Promise.all(pending);
  clearInterval(lagTimer);
  const lockConflicts = (await sampleLockConflicts(instances[0]!)) - lockBefore;
  return { samples, lockConflicts, outboxLagMax };
}

/** Cenário SQS: enfileira no modelo aberto e mede ponta a ponta (enqueue → persistido). */
async function driveSqs(
  infra: Infra,
  instances: Instance[],
  wallets: { id: string; playerId: string }[],
  options: Options,
): Promise<{ samples: Sample[]; lockConflicts: number; outboxLagMax: number }> {
  const total = options.rate * options.durationSec;
  const intervalMs = 1000 / options.rate;
  const warmupMs = options.warmupSec * 1000;
  const start = performance.now();
  const startWall = Date.now();
  const enqueuedAt = new Map<string, number>();
  const lockBefore = await sampleLockConflicts(instances[0]!);
  let outboxLagMax = 0;
  const lagTimer = setInterval(() => {
    void sampleOutboxLag(instances[0]!).then((lag) => {
      outboxLagMax = Math.max(outboxLagMax, lag);
    });
  }, 1000);

  // Modelo aberto: enfileira no agendamento fixo sem esperar cada envio terminar.
  const sends: Promise<void>[] = [];
  for (let i = 0; i < total; i += 1) {
    const scheduledAt = start + i * intervalMs;
    const wait = scheduledAt - performance.now();
    if (wait > 0) {
      await delay(wait);
    }
    const external = `sqs-${i}`;
    const wallet = wallets[i % wallets.length]!;
    // Horário agendado em relógio de parede (comparável com processed_at); não o instante do send.
    enqueuedAt.set(external, startWall + i * intervalMs);
    sends.push(enqueueBet(infra, { walletId: wallet.id, playerId: wallet.playerId, amount: "1.00", external }));
  }
  await Promise.all(sends);

  // Espera drenar e mede ponta a ponta a partir de processed_at.
  await eventually(
    async () => {
      const processed = await scalar(infra, "SELECT count(*)::int AS c FROM wager_transactions WHERE external_transaction_id LIKE 'sqs-%' AND status='PROCESSED'");
      if (processed < total) {
        throw new Error(`processed ${processed}/${total}`);
      }
    },
    { timeoutMs: 120000, intervalMs: 500 },
  );

  const rows = await infra.db.orm.em.getConnection().execute<{ external_transaction_id: string; pat: string }[]>(
    "SELECT external_transaction_id, extract(epoch from processed_at)*1000 AS pat FROM wager_transactions WHERE external_transaction_id LIKE 'sqs-%' AND status='PROCESSED'",
  );
  clearInterval(lagTimer);
  const samples: Sample[] = [];
  for (const row of rows) {
    const enq = enqueuedAt.get(row.external_transaction_id);
    // Descarte de aquecimento pelo horário agendado.
    if (enq !== undefined && enq - startWall >= warmupMs) {
      samples.push({ scheduledAt: enq, latencyMs: Number(row.pat) - enq, status: 200, errorClass: "2xx" });
    }
  }
  const lockConflicts = (await sampleLockConflicts(instances[0]!)) - lockBefore;
  return { samples, lockConflicts, outboxLagMax };
}

async function fireHttp(
  instance: Instance,
  wallet: { id: string; playerId: string },
  external: string,
  scheduledAt: number,
): Promise<Sample> {
  try {
    const response = await submit(
      instance,
      betBody({ playerId: wallet.playerId, walletId: wallet.id, externalTransactionId: external, money: { amount: "1.00", currency: "BRL" } }),
    );
    return { scheduledAt, latencyMs: performance.now() - scheduledAt, status: response.status, errorClass: classify(response.status) };
  } catch {
    return { scheduledAt, latencyMs: performance.now() - scheduledAt, status: 0, errorClass: "timeout" };
  }
}

async function sampleOutboxLag(instance: Instance): Promise<number> {
  return readGauge(instance, "outbox_lag_seconds");
}

async function sampleLockConflicts(instance: Instance): Promise<number> {
  return readGauge(instance, "lock_conflicts_total");
}

async function readGauge(instance: Instance, name: string): Promise<number> {
  try {
    const body = await (await instance.request("/metrics")).text();
    const line = body.split("\n").find((l) => l.startsWith(name) && !l.startsWith("#"));
    return line === undefined ? 0 : Number(line.split(" ")[1] ?? "0");
  } catch {
    return 0;
  }
}

async function verify(
  infra: Infra,
  instances: Instance[],
  wallets: { id: string; playerId: string }[],
): Promise<{ consistent: boolean; duplicates: number; outboxPending: number }> {
  let consistent = true;
  for (const wallet of wallets) {
    const response = await instances[0]!.request(`/wallets/${wallet.id}/reconciliation`, { method: "POST" });
    const result = (await response.json()) as { consistent: boolean };
    consistent = consistent && result.consistent;
  }
  const duplicates = await scalar(
    infra,
    `SELECT count(*)::int AS c FROM (SELECT provider_id, external_transaction_id FROM wager_transactions GROUP BY 1,2 HAVING count(*) > 1) d`,
  );
  const outboxPending = await eventually(
    async () => {
      const pending = await scalar(infra, "SELECT count(*)::int AS c FROM outbox_messages WHERE published_at IS NULL");
      if (pending !== 0) {
        throw new Error("outbox not drained");
      }
      return pending;
    },
    { timeoutMs: 90000, intervalMs: 500 },
  ).catch(() => -1);
  return { consistent: consistent && duplicates === 0 && outboxPending === 0, duplicates, outboxPending };
}

async function scalar(infra: Infra, sql: string): Promise<number> {
  const rows = await infra.db.orm.em.getConnection().execute<{ c: number }[]>(sql);
  return rows[0]?.c ?? 0;
}

function summarize(
  options: Options,
  samples: Sample[],
  lockConflicts: number,
  outboxLagMax: number,
  correctness: { consistent: boolean; duplicates: number; outboxPending: number },
): Record<string, unknown> {
  const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
  const byClass: Record<string, number> = {};
  for (const sample of samples) {
    byClass[sample.errorClass] = (byClass[sample.errorClass] ?? 0) + 1;
  }
  const accepted = (byClass["2xx"] ?? 0) + (byClass["422"] ?? 0);
  // Vazão sobre a JANELA MEDIDA (sem o aquecimento), não a duração total.
  const measuredSeconds = Math.max(1, options.durationSec - options.warmupSec);
  return {
    options,
    environment: {
      cpus: navigator.hardwareConcurrency,
      bun: Bun.version,
      sameMachine: true,
    },
    summary: {
      samples: samples.length,
      acceptedThroughputPerSec: Number((accepted / measuredSeconds).toFixed(1)),
      latencyMs: {
        p50: Number(percentile(latencies, 50).toFixed(2)),
        p95: Number(percentile(latencies, 95).toFixed(2)),
        p99: Number(percentile(latencies, 99).toFixed(2)),
        max: Number((latencies[latencies.length - 1] ?? 0).toFixed(2)),
      },
      byClass,
      lockConflicts,
      outboxLagSecondsMax: outboxLagMax,
      correctness,
    },
  };
}

await main();
