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

- [ ] **T0.1** Inicializar git, `.gitignore` (node_modules, .env, coverage, dist), `.editorconfig`, `.env.example`.
  Pronto quando: `git status` limpo após o primeiro commit; `.env` nunca rastreado.
- [ ] **T0.2** Mover o enunciado para `docs/CHALLENGE.md` sem alterações e criar um `README.md` mínimo (título, uma frase, links para spec e arquitetura).
  Pronto quando: `diff` do enunciado com o original é vazio.

## M1 — Esqueleto

- [ ] **T1.1** `package.json` com Bun 1.x, `tsconfig.json` estrito (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, decorators). AGENTS §3.
  Pronto quando: `bun run typecheck` passa num `src/main.ts` vazio.
- [ ] **T1.2** ESLint com regra `no-restricted-syntax` proibindo `parseFloat`, `Number(` e `toFixed` em `src/**/domain` e nos mappers de dinheiro. AGENTS §5.1.
  Pronto quando: um arquivo de teste com `Number(amount)` no domínio falha no lint.
- [ ] **T1.2b** Regra `no-restricted-imports` por pasta: `domain` não importa NestJS, MikroORM, AWS SDK, pino, `application` nem `infra`; `application` não importa `infra`. Spec §2.1 (A1).
  Pronto quando: um import de `@mikro-orm/core` num arquivo de `domain` faz `bun run lint` falhar.
- [ ] **T1.3** Bootstrap NestJS com `enableShutdownHooks()` e módulos vazios (`shared`, `wallet`, `wagering`, `messaging`, `health`, `auth`). Spec §2.1.
  Pronto quando: `bun run start:dev` sobe e responde 404 em `/`.
- [ ] **T1.4** Config tipada e validada no boot (zod) com todas as variáveis da spec §11.
  Pronto quando: variável obrigatória ausente derruba o boot com mensagem clara.
- [ ] **T1.5** `docker-compose.yml` com PostgreSQL 16 e LocalStack, e script de init que cria as três filas com redrive (`maxReceiveCount: 5`). Spec §8.1.
  Pronto quando: `docker compose up -d` e `aws sqs list-queues` (via LocalStack) mostram as três filas.
- [ ] **T1.6** MikroORM configurado, scripts `migration:create`, `migration:up`, `migration:down`. Spec §4.
  Pronto quando: uma migration vazia sobe e desce.
- [ ] **T1.7** Logger pino JSON, correlação com `AsyncLocalStorage`, `X-Correlation-Id` aceito e devolvido, `redact` configurado. Spec §10.
  Pronto quando: um request gera um log JSON com `correlationId` e sem corpo.
- [ ] **T1.8** Registro `prom-client` e `GET /metrics`. Spec §10.
  Pronto quando: `/metrics` responde com as métricas padrão do processo.
- [ ] **T1.9** `GET /health/live` e `GET /health/ready` (PostgreSQL + três filas, timeout 1s). Spec §10.
  Pronto quando: `ready` dá 503 com o Postgres parado e 200 com tudo de pé.
- [ ] **T1.10** Shared domain: `DomainError`, enum `FailureCode` (spec §9), portas `Clock` e `IdGenerator` (UUIDv7) com implementações reais.
  Pronto quando: unit tests de `IdGenerator` (ordenação) e `Clock` passam.
- [ ] **T1.11** `AuthGuard` no-op global (exceto health e metrics) e `ProviderIdentityPort`. ADR-011.
  Pronto quando: guard aplicado e documentado no código como ponto de extensão.
- [ ] **T1.12** Infra de testes: `docker-compose.test.yml`, helpers em `test/support` (schema isolado por arquivo, filas com sufixo único, `eventually`, `FakeClock`, cliente HTTP da app real). Spec §12.
  Pronto quando: um teste de integração "hello" sobe a app contra Postgres e LocalStack reais.
- [ ] **T1.13** Scripts `test:unit`, `test:integration`, `test:concurrency`, `lint`, `typecheck`.
- [ ] **T1.14** Docs: README com "Requisitos" e "Rodando" (skill `project-docs`).

## M2 — Money

- [ ] **T2.1** `Money` com `bigint` em centavos, construtor privado, `from`, `zero`, parse pela regex da ADR-003, limite de magnitude. Spec §3.1.
- [ ] **T2.2** Aritmética e comparações (`add`, `subtract`, `negate`, `isZero`, `isPositive`, `isNegative`, `isLessThan`, `equals`) com `CurrencyMismatchError`.
- [ ] **T2.3** `toJSON` e `toString` sempre com duas casas.
- [ ] **T2.4** U1: testes table-driven com todas as entradas válidas e inválidas da AGENTS §5.1, aritmética, moeda, serialização. Spec §12.
  Pronto quando: nenhum `number` aparece no arquivo de teste nem no código.
- [ ] **T2.5** Custom type MikroORM `NUMERIC(20,2)` ↔ `bigint` via string, sem parser numérico no driver.
  Pronto quando: teste de integração grava e lê `999999999999999999.99` sem perda.

## M3 — Schema

- [ ] **T3.1** Migration `wallets` com todas as constraints da spec §4.1.
- [ ] **T3.2** Migration `wager_transactions` com constraints, índice de compensação única (ADR-001) e índices parciais.
- [ ] **T3.3** Migration `wallet_ledger_entries` com `seq`, unicidades e `CHECK` aritmético.
- [ ] **T3.4** Migrations `inbox_messages` e `outbox_messages`.
- [ ] **T3.5** Triggers do ledger: imutabilidade (`UPDATE`, `DELETE`, `TRUNCATE`) e cadeia de versões. Spec §4.2.
- [ ] **T3.6** Triggers da wallet: guarda de colunas/versão e constraint trigger deferida de consistência com o ledger.
- [ ] **T3.7** Triggers de `wager_transactions` (estado terminal, colunas de identidade, sem `DELETE`) e de `outbox_messages`.
- [ ] **T3.8** Estratégia de limpeza entre testes compatível com o bloqueio de `TRUNCATE` (schema descartável por arquivo).
- [ ] **T3.9** I1: `up → down → up` e um teste por constraint/trigger, via SQL direto. Spec §12.
  Pronto quando: cada constraint e trigger da spec §4 tem um teste que prova que ele dispara.

## M4 — Domínio central, wallet e ledger

- [ ] **T4.1** `WalletLedgerEntry` imutável com validação aritmética + U5. Spec §3.3.
- [ ] **T4.2** `Wallet` com `open`, `debit`, `credit`, `reverse` retornando o lançamento + U2. Spec §3.2.
- [ ] **T4.3** `WagerTransaction` com máquina de estados, transições, consultas e guarda de terminais + U3 (parte de estados). Spec §3.4.
- [ ] **T4.4** `IntegrationEvent` abstrata e as quatro subclasses com `from(...)` + testes de snapshot do `toJSON`. Spec §8.3.
- [ ] **T4.5** `OutboxMessage` e repositório de gravação (sem publisher ainda). Spec §6.5.
- [ ] **T4.6** Entidades de persistência e mappers (`rehydrate`) para wallet, ledger, transação e outbox. ADR-007.
- [ ] **T4.7** Filtro global de erros: `application/problem+json`, mapeamento de status da spec §7.1, `retryable`.
  Pronto quando: cada classe de erro tem um teste de mapeamento.
- [ ] **T4.8** `OpenWallet` + `POST /wallets`: wallet, `OPENING`, lançamento e outbox na mesma transação; 409 em duplicidade. Spec §6.3.
- [ ] **T4.9** `GET /wallets/:walletId`.
- [ ] **T4.10** `GET /wallets/:walletId/ledger` com cursor opaco por `seq`, limite 1–200, 400 em cursor inválido. Spec §7.2.
- [ ] **T4.11** `ReconcileWallet` + `POST /wallets/:walletId/reconciliation` em `REPEATABLE READ`, log, métrica, sem correção.
- [ ] **T4.12** Helper `assertWalletConsistent` em `test/support`. Spec §12.
- [ ] **T4.13** I8: reconciliação consistente e divergente (divergência forçada pelo role de teste).
- [ ] **T4.14** Docs: README "API" com os endpoints de wallet.

## M5 — BET, WIN e LOSS por HTTP

- [ ] **T5.1** `PayloadHasher` (JSON canônico, SHA-256, prefixo `v1:`) + U4 com o vetor da spec §3.5.
- [ ] **T5.2** Validação de entrada de `POST /wagering/transactions`: `Idempotency-Key`, regex de `providerId`, `kind=OPENING` proibido, `BET` sem referência, `REFUND`/`ROLLBACK` com referência. Spec §3.4 e §3.6.
- [ ] **T5.3** `SubmitWagerTransaction`: lock com `lock_timeout`, checagem de idempotência e de `(provider, external)`, `BET`/`WIN`/`LOSS`, snapshot de resultado, eventos na outbox. Spec §6.1 e §5.
- [ ] **T5.4** Respostas 201/200/202/422 e replay montado só da linha persistida. Spec §6.2.
- [ ] **T5.5** ADR-002: wallet inexistente gravada como `REJECTED` com `INSERT ... ON CONFLICT` + I5.
- [ ] **T5.6** Tratamento de `23505` (releitura como replay ou conflito) e de `55P03` (503 + `lock_conflicts_total`).
- [ ] **T5.7** `GET /wagering/transactions/:transactionId` e `GET /providers/:providerId/wagering/transactions/:externalTransactionId`.
- [ ] **T5.8** I3: replay idêntico, conflito de hash, conflito provider/external, replay de rejeição.
- [ ] **T5.9** I2: falha injetada antes do commit não deixa rastro em nenhuma tabela.
- [ ] **T5.10** C1: mesma aposta 50× em paralelo → 1 débito, 1×201 e 49×200 idênticos.
- [ ] **T5.11** C2: saldo 100.00, duas apostas de 80.00 → exatamente o resultado da spec §12.
- [ ] **T5.12** C3: 20 wallets × 20 operações em paralelo, todas consistentes.
- [ ] **T5.13** Métricas `wager_transactions_total`, `idempotency_duplicates_total`, `wager_processing_duration_seconds`.
- [ ] **T5.14** Docs: README "Como funciona" (caminho de uma aposta e idempotência).

## M6 — Publicação da outbox

- [ ] **T6.1** Adaptador SQS de publicação (`SendMessageBatch`, `MessageGroupId`, `MessageDeduplicationId = eventId`).
- [ ] **T6.2** `PublishOutbox`: claim com lease e `SKIP LOCKED`, publicação fora da transação, marcação condicionada ao `locked_by`, retry com backoff. Spec §6.5.
- [ ] **T6.3** Loop do worker com início/parada no ciclo de vida do Nest e liberação de leases no shutdown.
- [ ] **T6.4** Coletor periódico de `outbox_lag_seconds`, `outbox_pending_messages` e `outbox_publish_failures_total`.
- [ ] **T6.5** C6: dois ou mais publishers, um morto com lease → todo evento publicado, duplicatas só com o mesmo `eventId`.
- [ ] **T6.6** Docs: README "Como funciona" (outbox, explicada em meia frase na primeira menção).

## M7 — REFUND, ROLLBACK e referências fora de ordem

- [ ] **T7.1** `ReferencePolicy` com a ordem de validação da spec §3.4 + U3 completo.
- [ ] **T7.2** `REFUND` e `ROLLBACK` no use case: direção invertida, `AMOUNT_MISMATCH`, `REVERSAL_INSUFFICIENT_FUNDS`, compensação única (ADR-001) e `23505` do índice tratado como bug logado.
- [ ] **T7.3** Caminho `PENDING_REFERENCE`: prazo, próximo horário, evento emitido uma única vez. ADR-004.
- [ ] **T7.4** Reagendamento imediato das pendentes quando a referência é processada. Spec §6.4.
- [ ] **T7.5** Worker `ReprocessPendingReference`: claim com `SKIP LOCKED`, lock da wallet antes da transação, backoff com jitter, tentativa final, `REFERENCE_NOT_FOUND`.
- [ ] **T7.6** Gauge `pending_reference_transactions`.
- [ ] **T7.7** I4: todas as regras de referência, incluindo os quatro testes obrigatórios da ADR-001.
- [ ] **T7.8** C7: REFUND/ROLLBACK antes da BET, prazo vencido com `FakeClock`, REFUND + ROLLBACK concorrentes na mesma BET.
- [ ] **T7.9** Docs: README "Como funciona" (referências fora de ordem).

## M8 — Consumidor SQS

- [ ] **T8.1** Validação do envelope `WagerTransactionRequested` reaproveitando o schema do HTTP. Spec §8.2.
- [ ] **T8.2** `InboxMessage` e gravação na mesma transação; duplicata confirma sem efeito; `messageId` repetido com outro hash vai para a DLQ. Spec §6.6.
- [ ] **T8.3** Loop de consumo com long polling e concorrência configurável, chamando o mesmo `SubmitWagerTransaction`.
- [ ] **T8.4** Classificação de erros (negócio, transitório, permanente) por tipo, DLQ explícita, `ChangeMessageVisibility` com backoff, métricas `processing_retries_total` e `dlq_messages_total`.
- [ ] **T8.5** Shutdown em `SIGTERM`: para o polling, aguarda in-flight, devolve visibilidade, para workers. Spec §6.6.
- [ ] **T8.6** Fault injection `exit_after_commit_before_ack`, ativa só com `NODE_ENV=test`.
- [ ] **T8.7** Script `start:cluster` subindo 3 instâncias em portas distintas.
- [ ] **T8.8** I6 (inbox e redelivery), I7 (retry e DLQ), I9 (shutdown).
- [ ] **T8.9** C4: três processos `Bun.spawn` com HTTP e consumer sobre as mesmas wallets.
- [ ] **T8.10** C5: processo morto entre commit e ack; outra instância recebe e não duplica.
- [ ] **T8.11** C8: matar todas as instâncias no meio da carga, subir de novo, provar consistência e outbox drenada.
- [ ] **T8.11a** Helpers de caos em `test/support/chaos.ts` (`docker pause`/`unpause` dos containers de teste, com `unpause` garantido no `afterAll`). Spec §12.1.
- [ ] **T8.11b** I10: Postgres pausado durante carga HTTP e SQS → 503 `INFRA_UNAVAILABLE`, mensagens voltam por visibilidade, consistência final após `unpause`.
- [ ] **T8.11c** I11: LocalStack pausado → API segue respondendo, `outbox_lag_seconds` cresce, outbox drena após `unpause`, `ready` vai a 503 e volta a 200.
- [ ] **T8.11d** C9: hot wallet com 300 operações misturadas entre 3 instâncias → saldo nunca negativo, sem duplicados, cadeia contínua.
- [ ] **T8.12** Docs: README "Rodando várias instâncias".

## M9 — Observabilidade

- [ ] **T9.1** Conferir que toda métrica da spec §10 existe com os labels certos.
- [ ] **T9.2** Conferir campos de contexto em todos os logs e testar que o `redact` esconde valores e corpos.
- [ ] **T9.3** Docs: README "Observabilidade".

## M10 — Documentação e entrega

- [ ] **T10.1** Passe completo da skill `project-docs` no README, na ordem de seções definida por ela.
- [ ] **T10.2** Passe no ARCHITECTURE.md: conferir os ADRs contra o código, adicionar decisões novas, preencher "O que faríamos com mais tempo".
- [ ] **T10.3** Registrar na §15 da tech spec toda divergência encontrada durante a implementação.
- [ ] **T10.4** Revisar item a item o checklist de falhas eliminatórias (AGENTS §2).
- [ ] **T10.5** Execução do zero numa máquina limpa: `docker compose down -v`, clone, comandos do README.
- [ ] **T10.6** Suíte completa 10 vezes seguidas sem falha. Spec §12.
- [ ] **T10.7** Definição de pronto (AGENTS §14) toda marcada.

## M11 — Diferencial: teste de carga (só depois do M10)

Metodologia completa na spec §12.2. Partidas dobradas, OpenTelemetry, dashboard e Keycloak foram descartados pelo humano; não implemente.

- [ ] **T11.1** Gerador em `test/load/run.ts`: modelo aberto (taxa de chegada constante), latência medida do horário agendado até a resposta, round-robin entre as 3 instâncias, parâmetros por CLI/env.
  Pronto quando: um teste curto do próprio gerador mostra que, com o servidor travado, a latência medida cresce (sem *coordinated omission*).
- [ ] **T11.2** Cálculo de percentis (p50, p95, p99, máx.) sobre todas as amostras, taxa de erro por classe e vazão aceita.
- [ ] **T11.3** Coletor do `/metrics` durante a execução: `lock_conflicts_total` (diferença) e `outbox_lag_seconds` amostrado a cada 1 s; tempo de drenagem após a carga.
- [ ] **T11.4** Cenários `distributed`, `hot-wallet`, `duplicates` e `sqs`, com seed de wallets, degraus de taxa, aquecimento de 30 s, medição de 120 s e 3 repetições.
- [ ] **T11.5** Verificação de correção ao fim de cada execução: reconciliação de 100% das wallets tocadas, nenhum duplicado, outbox drenada. Falha invalida a execução.
- [ ] **T11.6** Saída em JSON em `test/load/results/` e script versionado que gera o gráfico de latência por taxa.
- [ ] **T11.7** Script `test:load` no `package.json` e coleta automática do ambiente (CPU, RAM, SO, versões, pool, concorrência).
- [ ] **T11.8** Rodar os quatro cenários e escrever `docs/LOAD_TEST.md` (ambiente, metodologia, tabelas, gráfico, gargalo com evidência, limitações), seguindo a skill `project-docs`.
- [ ] **T11.9** Resumo em "Resultados medidos" no ARCHITECTURE.md e linha no README ("Testes") apontando para o relatório.
