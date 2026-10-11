# Distributed Wagering Processor

Serviço financeiro distribuído que processa transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`,
`ROLLBACK`) de múltiplos provedores, por HTTP e por SQS, mantendo o saldo das wallets e um ledger
auditável corretos sob entrega **at-least-once**, mensagens **fora de ordem** e **várias instâncias**
processando em paralelo.

**Invariantes globais** (nunca violadas): não duplicar créditos, não duplicar débitos, não perder
eventos confirmados, nunca deixar saldo negativo. Dinheiro é sempre exato (`bigint` em centavos,
nunca ponto flutuante) e toda garantia tem constraint ou trigger **no schema do banco**.

Enunciado em [docs/CHALLENGE.md](docs/CHALLENGE.md) · decisões e trade-offs em
[ARCHITECTURE.md](ARCHITECTURE.md) · especificação detalhada em [docs/TECH_SPEC.md](docs/TECH_SPEC.md).

## Stack

| Item | Escolha |
|---|---|
| Runtime / package manager / testes | Bun 1.x |
| Linguagem | TypeScript estrito |
| Framework | NestJS |
| Banco | PostgreSQL 16 |
| Mensageria | AWS SQS via MiniStack (LocalStack compatível; ver ADR-013) |
| ORM | MikroORM (`EntityManager.transactional()`, `FOR UPDATE`) |
| Migrations | versionadas e reversíveis (`up`/`down`) |

## Requisitos

- [Bun](https://bun.sh) 1.x
- Docker + Docker Compose

## Como rodar

```bash
docker compose up -d          # PostgreSQL + emulador de SQS + criação das 3 filas (com DLQ/redrive)
bun install
cp .env.example .env           # os defaults já batem com o docker-compose
bun run migration:up           # aplica o schema (tabelas, constraints, triggers)
bun run start:dev              # API em http://localhost:3000
```

Reversibilidade do schema: `bun run migration:down` reverte a última migration; `migration:up`
reaplica.

### Comandos

```bash
docker compose up -d           # infra de desenvolvimento
bun run migration:up           # aplica migrations
bun run migration:down         # reverte a última migration
bun run start:dev              # 1 instância (API + consumer + workers)
bun run start:cluster          # 3 instâncias em :3000, :3001, :3002
bun run test:unit              # testes de unidade (sem banco)
bun run test:integration       # integração (PostgreSQL + SQS reais)
bun run test:concurrency       # concorrência e multi-instância
bun test                       # tudo
bun run test:load              # teste de carga (diferencial)
bun run lint && bun run typecheck
```

## Testes

A infra de teste sobe num compose separado (portas 55432 e 54566), isolada da de desenvolvimento:

```bash
docker compose -f docker-compose.test.yml up -d
bun test
```

Integração e concorrência usam **PostgreSQL e SQS de verdade** (nunca mock); cada arquivo cria um
banco descartável e aplica as migrations reais. Ao final de todo teste de integração/concorrência,
`assertWalletConsistent` confere a invariante do enunciado: `wallet.balance == saldo reconstruído
pelo ledger`, com a cadeia de versões contínua e nada negativo. Cobertura: `Money` e agregados
(unidade); migrations/constraints, atomicidade, inbox/redelivery, retry/DLQ, publishers
concorrentes e reinício (integração); 50 apostas iguais em paralelo, hot wallet, ≥ 3 processos,
crash entre commit e ack, referências fora de ordem e indisponibilidade de Postgres/SQS
(concorrência/caos).

## Como funciona

**Caminho de uma aposta.** A borda valida o payload e exige `Idempotency-Key`. O use case calcula um
hash canônico dos campos de negócio e abre **uma** transação SQL: trava a wallet
(`SELECT ... FOR UPDATE`), checa idempotência (chave já existente com o mesmo hash → devolve o
resultado gravado, *replay*; com hash diferente → 409), aplica a regra do kind no agregado, e grava
transação + saldo (UPDATE condicionado por versão) + lançamento no ledger + eventos na outbox —
tudo junto. Só depois do commit o HTTP responde ou o SQS confirma a mensagem. Como o lock vem antes
de tudo, 50 requisições idênticas em paralelo serializam: uma debita, as outras replicam.

**Idempotência é persistente** (nunca em memória): `UNIQUE (idempotency_key)` e
`UNIQUE (provider_id, external_transaction_id)` no banco, com o resultado terminal gravado na linha.

**Outbox** é a tabela onde os eventos são gravados junto com o saldo; um worker os publica depois no
SQS (lease + `SKIP LOCKED`, em todas as instâncias). Nenhum evento sai antes do commit, nenhum
confirmado se perde; a entrega é at-least-once e o consumidor deduplica por `eventId`.

**Referências fora de ordem.** Um `REFUND`/`ROLLBACK` que chega antes da aposta que compensa é
gravado como `PENDING_REFERENCE` (HTTP 202); um worker reprocessa quando a referência aparece (prazo
de 24h, backoff). Uma referência só é compensada uma vez, por `REFUND` **ou** `ROLLBACK` (índice
único parcial).

## API

Autenticação: ver [ARCHITECTURE.md ADR-011](ARCHITECTURE.md) (ponto de extensão, não implementada).

### Criar wallet — `POST /wallets`

```json
// request
{ "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1", "initialBalance": { "amount": "1000.00", "currency": "BRL" } }
// response 201 (saldo > 0 gera OPENING + lançamento CREDIT na mesma transação SQL)
{ "id": "0192f291-27dd-7d3f-8071-5f8685deef37", "playerId": "0192f28f-...", "balance": { "amount": "1000.00", "currency": "BRL" }, "version": 1 }
```

`playerId` + `currency` duplicado → `409 WALLET_ALREADY_EXISTS`.

### Consultas

```http
GET /wallets/:walletId
GET /wallets/:walletId/ledger?cursor=&limit=50      # cursor opaco e estável por seq, limit 1–200
GET /wagering/transactions/:transactionId
GET /providers/:providerId/wagering/transactions/:externalTransactionId
```

### Submeter transação — `POST /wagering/transactions`

```http
Idempotency-Key: provider-a:transaction-123
```

```json
// request
{
  "providerId": "provider-a", "externalTransactionId": "transaction-123",
  "playerId": "0192f28f-...", "walletId": "0192f291-...",
  "roundId": "round-987", "gameId": "fortune-chimp",
  "kind": "BET", "money": { "amount": "25.00", "currency": "BRL" }
}
// response
{ "transactionId": "0192f298-...", "status": "PROCESSED", "balance": { "amount": "975.00", "currency": "BRL" }, "failureCode": null, "idempotentReplay": false }
```

Status HTTP (consistentes em todos os endpoints): `201` nova processada · `200` replay · `202`
`PENDING_REFERENCE` · `400` payload inválido · `409` conflito de idempotência/duplicidade · `422`
rejeição de negócio (com `failureCode`) · `503` infraestrutura indisponível. Erros usam
`application/problem+json` com `code` estável e `retryable`.

### Reconciliação — `POST /wallets/:walletId/reconciliation`

```json
{
  "walletId": "0192f291-...",
  "storedBalance":     { "amount": "975.00", "currency": "BRL" },
  "calculatedBalance": { "amount": "975.00", "currency": "BRL" },
  "difference":        { "amount": "0.00",   "currency": "BRL" },
  "consistent": true, "checkedEntries": 42, "chainValid": true
}
```

Divergência não é corrigida: é logada (`warn`), contabilizada (`reconciliation_mismatches_total`) e
sinalizada (`consistent: false`).

### Health — `GET /health/live`, `GET /health/ready` (sem auth)

`ready` checa PostgreSQL e as três filas com timeout de 1 s.

## Rodando várias instâncias

```bash
bun run start:cluster   # 3 instâncias em :3000, :3001, :3002
```

Todas são idênticas (API + consumer + workers). Não há líder: a coordenação usa row locks,
`SKIP LOCKED` e leases no PostgreSQL, então a correção independe de quantas instâncias existem.

## Observabilidade

- **Logs** JSON (pino) com contexto (`correlationId`, `messageId`, `transactionId`, `walletId`,
  `providerId`) via `AsyncLocalStorage`; redaction esconde dinheiro, saldos, corpos e credenciais.
- **Métricas** Prometheus em `GET /metrics`: transações por status, duplicatas, retries, DLQ,
  conflitos de lock, outbox lag/pendentes, pendências de referência, duração de processamento e
  divergências de reconciliação.
- **Health** separado para liveness e readiness.

## Teste de carga (diferencial)

`bun run test:load` sobe 3 instâncias, aplica carga em **modelo aberto** (sem *coordinated
omission*) e, ao fim, **verifica a correção** (reconciliação de todas as wallets, zero duplicados,
outbox drenada) — execução inconsistente é inválida. Metodologia, resultados e limitações em
[docs/LOAD_TEST.md](docs/LOAD_TEST.md).

## Configuração

Todas as variáveis estão em [.env.example](.env.example) e são validadas no boot (a app não sobe
com config inválida). Detalhe de cada uma na [tech spec §11](docs/TECH_SPEC.md).

## Decisões e limitações

Registradas em [ARCHITECTURE.md](ARCHITECTURE.md): mapeamento do `Money`, estratégia transacional e
de lock, idempotência e hash, máquina de estados, taxonomia de `failureCode`, inbox/outbox, worker
de referências, autenticação como ponto de extensão e limitações conhecidas.
