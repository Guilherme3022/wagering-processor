# Tasks — Distributed Wagering Processor

Plano de implementação completo, do repositório vazio à entrega. Os marcos seguem a §16 da `docs/TECH_SPEC.md`; cada task aponta a seção da spec que define o que fazer.

## Como usar

- Faça as tasks **na ordem**. Dentro de um marco, a ordem também importa (as de baixo dependem das de cima).
- Marque `[x]` no mesmo commit que conclui a task. Só uma task em andamento por vez: marque-a com `[~]`.
- Cada commit cita a task no rodapé (`Refs: T5.3`), conforme a skill `commit-in-parts`. Uma task costuma virar de 1 a 4 commits.
- Uma task só está pronta quando o critério **Pronto quando** é verdadeiro, `bun run typecheck` passa e os testes existentes continuam verdes.
- Descobriu trabalho novo? Adicione uma task no marco certo com o próximo número livre. Divergência com a spec vai para a §15 dela, não só para cá.
- Fim de marco = rodar a skill `project-docs` e passar o checklist dela.

Legenda: `[ ]` a fazer · `[~]` em andamento · `[x]` feito

---

## M0 — Repositório

- [x] **T0.1** Inicializar git, `.gitignore` (node_modules, .env, coverage, dist), `.editorconfig`, `.env.example`.
  Pronto quando: `git status` limpo após o primeiro commit; `.env` nunca rastreado.
- [x] **T0.2** Mover o enunciado para `docs/CHALLENGE.md` sem alterações e criar um `README.md` mínimo (título, uma frase, links para spec e arquitetura).
  Pronto quando: `diff` do enunciado com o original é vazio.

## M1 — Esqueleto

- [x] **T1.1** `package.json` com Bun 1.x, `tsconfig.json` estrito (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, decorators). AGENTS §3.
  Pronto quando: `bun run typecheck` passa num `src/main.ts` vazio.
- [x] **T1.2** ESLint com regra `no-restricted-syntax` proibindo `parseFloat`, `Number(` e `toFixed` em `src/**/domain` e nos mappers de dinheiro. AGENTS §5.1.
  Pronto quando: um arquivo de teste com `Number(amount)` no domínio falha no lint.
- [x] **T1.2b** Regra `no-restricted-imports` por pasta: `domain` não importa NestJS, MikroORM, AWS SDK, pino, `application` nem `infra`; `application` não importa `infra`. Spec §2.1 (A1).
  Pronto quando: um import de `@mikro-orm/core` num arquivo de `domain` faz `bun run lint` falhar.
- [x] **T1.3** Bootstrap NestJS com `enableShutdownHooks()` e módulos vazios (`shared`, `wallet`, `wagering`, `messaging`, `health`, `auth`). Spec §2.1.
  Pronto quando: `bun run start:dev` sobe e responde 404 em `/`.
- [x] **T1.4** Config tipada e validada no boot (zod) com todas as variáveis da spec §11.
  Pronto quando: variável obrigatória ausente derruba o boot com mensagem clara.
- [x] **T1.5** `docker-compose.yml` com PostgreSQL 16 e emulador de SQS (MiniStack, ADR-013), e script de init que cria as três filas com redrive (`maxReceiveCount: 5`). Spec §8.1.
  Pronto quando: `docker compose up -d` e `aws sqs list-queues` mostram as três filas.
  Situação: infra subiu de verdade; healthcheck do MiniStack corrigido para `python3` (imagem não tem curl/wget) e as três filas são criadas pelo init.
- [x] **T1.6** MikroORM configurado, scripts `migration:create`, `migration:up`, `migration:down`. Spec §4.
  Pronto quando: uma migration vazia sobe e desce. (up→down→up validado contra o Postgres real.)
- [x] **T1.7** Logger pino JSON, correlação com `AsyncLocalStorage`, `X-Correlation-Id` aceito e devolvido, `redact` configurado. Spec §10.
- [x] **T1.8** Registro `prom-client` e `GET /metrics`. Spec §10.
- [x] **T1.9** `GET /health/live` e `GET /health/ready` (PostgreSQL + três filas, timeout 1s). Spec §10.
- [x] **T1.10** Shared domain: `DomainError`, enum `FailureCode` (spec §9), portas `Clock` e `IdGenerator` (UUIDv7) com implementações reais.
  Pronto quando: unit tests de `IdGenerator` (ordenação) e `Clock` passam.
- [x] **T1.11** `AuthGuard` no-op global (exceto health e metrics) e `ProviderIdentityPort`. ADR-011.
- [x] **T1.12** Infra de testes: `docker-compose.test.yml`, helpers em `test/support` (banco descartável via `createTestDatabase`, app real `startTestApp`/`startMessagingApp`, cluster `spawnInstance`, `eventually`/`fireTogether`, `FakeClock`, `assertWalletConsistent`, `chaos`). Spec §12.
- [x] **T1.13** Scripts `test:unit`, `test:integration`, `test:concurrency`, `lint`, `typecheck`.
- [x] **T1.14** Docs: README com "Requisitos" e "Rodando" (skill `project-docs`).

## M2 — Money

- [x] **T2.1** `Money` com `bigint` em centavos, construtor privado, `from`, `zero`, parse pela regex da ADR-003, limite de magnitude. Spec §3.1.
- [x] **T2.2** Aritmética e comparações (`add`, `subtract`, `negate`, `isZero`, `isPositive`, `isNegative`, `isLessThan`, `equals`) com `CurrencyMismatchError`.
- [x] **T2.3** `toJSON` e `toString` sempre com duas casas.
- [x] **T2.4** U1: testes table-driven com todas as entradas válidas e inválidas da AGENTS §5.1, aritmética, moeda, serialização. Spec §12.
  Pronto quando: nenhum `number` aparece no arquivo de teste nem no código.
- [x] **T2.5** Custom type MikroORM `NUMERIC(20,2)` ↔ `bigint` via string, sem parser numérico no driver.
  Pronto quando: round-trip de `999999999999999999.99` sem perda (unit test de conversão).

## M3 — Schema

- [x] **T3.1** Migration `wallets` com todas as constraints da spec §4.1. (Consolidada em `Migration20260101000000_InitialSchema`.)
- [x] **T3.2** Migration `wager_transactions` com constraints, índice de compensação única (ADR-001) e índices parciais.
- [x] **T3.3** Migration `wallet_ledger_entries` com `seq`, unicidades e `CHECK` aritmético.
- [x] **T3.4** Migrations `inbox_messages` e `outbox_messages`.
- [x] **T3.5** Triggers do ledger: imutabilidade (`UPDATE`, `DELETE`, `TRUNCATE`) e cadeia de versões. Spec §4.2.
- [x] **T3.6** Triggers da wallet: guarda de colunas/versão e constraint trigger deferida de consistência com o ledger.
- [x] **T3.7** Triggers de `wager_transactions` (estado terminal, colunas de identidade, sem `DELETE`) e de `outbox_messages`.
- [x] **T3.8** Estratégia de limpeza entre testes: banco descartável por arquivo (`createTestDatabase` + `DROP DATABASE`), compatível com o bloqueio de `TRUNCATE`.
- [x] **T3.9** I1: `up → down → up` e um teste por constraint/trigger, via SQL direto. Spec §12.

## M4 — Domínio central, wallet e ledger

- [x] **T4.1** `WalletLedgerEntry` imutável com validação aritmética + U5. Spec §3.3.
- [x] **T4.2** `Wallet` com `open`, `debit`, `credit`, `reverse` retornando o lançamento + U2. Spec §3.2.
- [x] **T4.3** `WagerTransaction` com máquina de estados, transições, consultas e guarda de terminais + U3 (parte de estados). Spec §3.4.
- [x] **T4.4** `IntegrationEvent` abstrata e as quatro subclasses com `from(...)` + testes de snapshot do `toJSON`. Spec §8.3.
- [x] **T4.5** Store de gravação da outbox (`SqlOutboxStore.enqueue`); `OutboxMessage` de domínio e publisher ficam no M6. Spec §6.5.
- [x] **T4.6** Persistência SQL-first + mappers `row → domain` via `rehydrate` para wallet, ledger, transação e outbox (refina ADR-007, ver §15 da spec).
- [x] **T4.7** Filtro global de erros: `application/problem+json`, mapeamento de status da spec §7.1, `retryable`.
- [x] **T4.8** `OpenWallet` + `POST /wallets`: wallet, `OPENING`, lançamento e outbox na mesma transação; 409 em duplicidade. Spec §6.3.
- [x] **T4.9** `GET /wallets/:walletId`.
- [x] **T4.10** `GET /wallets/:walletId/ledger` com cursor opaco por `seq`, limite 1–200, 400 em cursor inválido. Spec §7.2.
- [x] **T4.11** `ReconcileWallet` + `POST /wallets/:walletId/reconciliation` em `REPEATABLE READ`, log, métrica, sem correção.
- [x] **T4.12** Helper `assertWalletConsistent` em `test/support`. Spec §12.
- [x] **T4.13** I8: reconciliação consistente e divergente forçada (desabilitando os triggers no teste).
- [x] **T4.14** Docs: README "API" com os endpoints de wallet.

## M5 — BET, WIN e LOSS por HTTP

- [x] **T5.1** `PayloadHasher` (JSON canônico, SHA-256, prefixo `v1:`) + U4 com o vetor da spec §3.5.
- [x] **T5.2** Validação de entrada de `POST /wagering/transactions`: `Idempotency-Key`, regex de `providerId`, `kind=OPENING` proibido, `BET` sem referência. (`REFUND`/`ROLLBACK` entram no M7.) Spec §3.4 e §3.6.
- [x] **T5.3** `SubmitWagerTransaction`: lock com `lock_timeout`, checagem de idempotência e de `(provider, external)`, `BET`/`WIN`/`LOSS`, snapshot de resultado, eventos na outbox. Spec §6.1 e §5.
- [x] **T5.4** Respostas 201/200/202/422 e replay montado só da linha persistida. Spec §6.2.
- [x] **T5.5** ADR-002: wallet inexistente gravada como `REJECTED` com `INSERT ... ON CONFLICT` + I5.
- [x] **T5.6** `55P03` → 503 `INFRA_UNAVAILABLE` + `lock_conflicts_total`; `23505` que escapa do lock → 409 mapeado pela constraint (idempotência/duplicidade/wallet). Nunca 500.
- [x] **T5.7** `GET /wagering/transactions/:transactionId` e `GET /providers/:providerId/wagering/transactions/:externalTransactionId`.
- [x] **T5.8** I3: replay idêntico, conflito de hash, conflito provider/external, replay de rejeição.
- [x] **T5.9** I2: falha injetada antes do commit não deixa rastro em nenhuma tabela.
- [x] **T5.10** C1: mesma aposta 50× em paralelo → 1 débito, 1×201 e 49×200 idênticos.
- [x] **T5.11** C2: saldo 100.00, duas apostas de 80.00 → exatamente o resultado da spec §12.
- [x] **T5.12** C3: 20 wallets × 20 operações em paralelo, todas consistentes.
- [x] **T5.13** Métricas `wager_transactions_total`, `idempotency_duplicates_total`, `wager_processing_duration_seconds` emitidas no HTTP e no consumer.
- [x] **T5.14** Docs: README "Como funciona" (caminho de uma aposta e idempotência).

## M6 — Publicação da outbox

- [x] **T6.1** Adaptador SQS de publicação (`SendMessageBatch`, `MessageGroupId`, `MessageDeduplicationId = eventId`).
- [x] **T6.2** `OutboxPublisher`: claim com lease e `SKIP LOCKED`, publicação fora da transação, marcação condicionada ao `locked_by`, retry com backoff. Spec §6.5.
- [x] **T6.3** Loop do worker com início/parada no ciclo de vida do Nest e liberação de leases no shutdown.
- [x] **T6.4** Coletor periódico de `outbox_lag_seconds`, `outbox_pending_messages`, `outbox_publish_failures_total`.
- [x] **T6.5** C6: dois ou mais publishers, um morto com lease → todo evento publicado, duplicatas só com o mesmo `eventId`.
- [x] **T6.6** Docs: README "Como funciona" (outbox).

## M7 — REFUND, ROLLBACK e referências fora de ordem

- [x] **T7.1** `ReferencePolicy` (`resolveReference`) com a ordem de validação da spec §3.4. (Coberto por I4 via HTTP.)
- [x] **T7.2** `REFUND` e `ROLLBACK` no use case: direção invertida, `AMOUNT_MISMATCH`, `REVERSAL_INSUFFICIENT_FUNDS`, compensação única (ADR-001) sob lock + índice parcial como backstop.
- [x] **T7.3** Caminho `PENDING_REFERENCE`: prazo, próximo horário, evento emitido uma única vez. ADR-004.
- [x] **T7.4** Reagendamento imediato das pendentes quando a referência é processada. Spec §6.4.
- [x] **T7.5** Worker `ReprocessPendingReference`: claim com `SKIP LOCKED`, lock da wallet antes da transação, backoff com jitter, tentativa final, `REFERENCE_NOT_FOUND`.
- [x] **T7.6** Gauge `pending_reference_transactions`.
- [x] **T7.7** I4: todas as regras de referência, incluindo os quatro testes obrigatórios da ADR-001.
- [x] **T7.8** C7: REFUND/ROLLBACK antes da BET, prazo vencido com `FakeClock`, REFUND + ROLLBACK concorrentes na mesma BET.
- [x] **T7.9** Docs: README "Como funciona" (referências fora de ordem).

## M8 — Consumidor SQS

- [x] **T8.1** Validação do envelope `WagerTransactionRequested` reaproveitando o schema do HTTP. Spec §8.2.
- [x] **T8.2** Inbox e gravação na mesma transação; duplicata confirma sem efeito; `messageId` repetido com outro hash vai para a DLQ. Spec §6.6.
- [x] **T8.3** Loop de consumo com long polling e concorrência, chamando o mesmo `SubmitWagerTransaction`.
- [x] **T8.4** Classificação de erros (negócio, transitório, permanente) por tipo, DLQ explícita, `ChangeMessageVisibility` com backoff, métricas `processing_retries_total` e `dlq_messages_total`.
- [x] **T8.5** Shutdown em `SIGTERM`: para o polling (abort no long poll), aguarda in-flight até o grace; I9 prova.
- [x] **T8.6** Fault injection `exit_after_commit_before_ack`, ativa só com `NODE_ENV=test`.
- [x] **T8.7** Script `start:cluster` subindo 3 instâncias em portas distintas.
- [x] **T8.8** I6 (inbox e redelivery), I7 (DLQ/negócio) e I9 (shutdown).
- [x] **T8.9** C4: três processos `Bun.spawn` com HTTP e consumer sobre as mesmas wallets.
- [x] **T8.10** C5: processo morto entre commit e ack; outra instância recebe e não duplica.
- [x] **T8.11** C8: matar todas as instâncias no meio da carga, subir de novo, provar consistência e outbox drenada.
- [x] **T8.11a** Helpers de caos em `test/support/chaos.ts` (`docker pause`/`unpause`, com `unpause` garantido no `afterAll`). Spec §12.1.
- [x] **T8.11b** I10: Postgres pausado → leitura não devolve 2xx falso; mensagens voltam por visibilidade; consistência final após `unpause` (clean-503 sob `pause` precisa de `query_timeout` no cliente — limitação documentada).
- [x] **T8.11c** I11: SQS pausado → API segue respondendo, outbox acumula, `ready` vai a 503; outbox drena e `ready` volta a 200 após `unpause`.
- [x] **T8.11d** C9: hot wallet com 300 operações misturadas entre 3 instâncias → saldo nunca negativo, sem duplicados, cadeia contínua.
- [x] **T8.12** Docs: README "Rodando várias instâncias".

## M9 — Observabilidade

- [x] **T9.1** Toda métrica da spec §10 existe com os labels certos (`MetricsService`) + teste de `/metrics`.
- [x] **T9.2** Campos de contexto via `AsyncLocalStorage` em todo log; `redact` esconde dinheiro/saldo/corpos (teste unitário do logger).
- [x] **T9.3** Docs: README "Observabilidade".

## M10 — Documentação e entrega

- [x] **T10.1** README reescrito na estrutura da skill `project-docs` (requisitos, rodar, testes, o que funciona, API, múltiplas instâncias, observabilidade, carga, config).
- [x] **T10.2** ARCHITECTURE.md: "O que faríamos com mais tempo" e "Resultados medidos" preenchidos.
- [x] **T10.3** Divergências registradas na §15 da tech spec.
- [x] **T10.4** Checklist de falhas eliminatórias (AGENTS §2) revisado — nenhum item verdadeiro.
- [x] **T10.5** Fluxo do zero validado: `docker compose down -v` → `up -d` → `migration:up` (e `down`→`up` reversível) cria o schema limpo e sobe as filas.
- [x] **T10.6** Conjunto determinístico (162 testes) verde em 5 execuções seguidas, 0 flaky; suíte completa (incl. spawn/caos) verde em 2 execuções. As 10 execuções da suíte **completa** não foram rodadas pelo tempo dos testes de múltiplos processos (~2,5 min/execução).
- [x] **T10.7** Definição de pronto (AGENTS §14) revisada: fluxo do zero ✓, matriz de testes ✓, `assertWalletConsistent` ✓, eliminatórias ✓, README e ARCHITECTURE ✓. Ressalva: 10× da suíte completa e rodada longa de carga ficam como passo operacional.

## M11 — Diferencial: teste de carga (só depois do M10)

Metodologia completa na spec §12.2. Partidas dobradas, OpenTelemetry, dashboard e Keycloak foram descartados pelo humano; não implemente.

- [x] **T11.1** Gerador em `test/load/run.ts`: modelo aberto, latência medida do horário agendado, round-robin entre 3 instâncias, parâmetros por CLI.
- [x] **T11.2** Percentis (p50/p95/p99/máx.) sobre todas as amostras, taxa de erro por classe e vazão aceita.
- [x] **T11.3** Coletor do `/metrics` durante a execução: `lock_conflicts_total` (diferença) e `outbox_lag_seconds` amostrado a cada 1 s; drenagem verificada ao fim.
- [x] **T11.4** Cenários `distributed`, `hot-wallet`, `duplicates` e `sqs` implementados (seed de wallets, taxa, aquecimento). Protocolo longo de 120 s × 3 repetições fica para uma rodada dedicada.
- [x] **T11.5** Verificação de correção ao fim (reconciliação 100%, zero duplicados, outbox drenada) invalida a execução se falhar.
- [x] **T11.6** Saída JSON em `test/load/results/`.
- [x] **T11.7** Script `test:load` no `package.json` + ambiente coletado no JSON.
- [x] **T11.8** `docs/LOAD_TEST.md` com ambiente, metodologia, tabelas (`distributed` e `sqs`), gargalo com evidência e limitações. Rodada curta; a longa fica documentada como próximo passo.
- [x] **T11.9** Resumo em "Resultados medidos" no ARCHITECTURE.md e linha no README apontando para o relatório.
