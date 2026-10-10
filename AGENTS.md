# AGENTS.md — Distributed Wagering Processor

Este arquivo orienta agentes de código (Claude Code, Codex, Cursor etc.) que vão projetar e implementar o desafio descrito em `docs/CHALLENGE.md` (o enunciado original da Jungle Gaming). Leia este arquivo **inteiro** antes de escrever código, e releia a seção "Regras de trabalho" no início de cada sessão.

> O enunciado é a fonte da verdade sobre **o que** construir; `docs/TECH_SPEC.md` é a especificação detalhada (schema, contratos, fluxos) que você implementa; este arquivo define **como** trabalhar e o que nunca pode acontecer. Precedência em caso de conflito: **enunciado → tech spec → AGENTS.md**. Aponte qualquer contradição ao humano e registre na §15 da tech spec.
>
> Antes de cada marco, leia a seção correspondente da tech spec. DDL, códigos de falha, status HTTP e nomes de eventos/métricas vêm de lá — não invente variantes.
>
> **Comece cada sessão pela skill `wagering-processor`** (`.claude/skills/wagering-processor/SKILL.md`): ela define a rotina de início, o ciclo de cada task, os portões de fim de marco e quando parar para perguntar.

---

## 0. Organização dos documentos do repositório

| Arquivo | Conteúdo | Quem mantém |
|---|---|---|
| `docs/CHALLENGE.md` | Enunciado original (mover o README recebido para cá, sem alterar) | ninguém edita |
| `docs/TECH_SPEC.md` | Especificação técnica: DDL, triggers, contratos de API/SQS/eventos, fluxos, failure codes, configuração, plano de testes, ADRs | humano aprova; agente propõe mudanças e registra divergências na §15 dela |
| `README.md` | Porta de entrada do projeto: o que é, como rodar, como testar, como funciona em uma página | agente, com a skill `project-docs`, a cada marco |
| `ARCHITECTURE.md` | Por que cada decisão foi tomada e o que ela custa (já existe com os ADRs 001–012; exigido pelo enunciado) | agente, com a skill `project-docs`, **no mesmo commit** da decisão |
| `TASKS.md` | Plano de implementação em tasks numeradas (M0–M11), do repositório vazio à entrega | agente marca o progresso; tasks novas podem ser adicionadas, nunca removidas sem o humano |
| `.claude/skills/wagering-processor/SKILL.md` | Ponto de entrada do trabalho: rotina de sessão, ciclo por task, portões de marco, quando perguntar | humano |
| `.claude/skills/ddd-modeling/SKILL.md` | DDD tático aplicado: linguagem ubíqua, contextos, agregados, casos de uso, repositórios | humano |
| `.claude/skills/event-driven/SKILL.md` | Comandos de entrada, eventos de saída, inbox/outbox, garantias e evolução de contrato | humano |
| `.claude/skills/clean-code/SKILL.md` | Convenções de nomes, funções, tipos, erros, comentários, organização e testes | humano |
| `.claude/skills/project-docs/SKILL.md` | Como escrever e quando atualizar README e ARCHITECTURE | humano |
| `.claude/skills/commit-in-parts/SKILL.md` | Como dividir o trabalho em commits e escrever as mensagens | humano |
| `AGENTS.md` | Este arquivo | humano (agente só propõe mudanças) |

### Documentação: use a skill `project-docs`

Toda escrita em `README.md` e `ARCHITECTURE.md` segue a skill `.claude/skills/project-docs/SKILL.md`. Agentes que não carregam skills automaticamente devem **ler esse arquivo** antes de editar qualquer um dos dois. Em resumo:

- escreva para um avaliador com pouco tempo: português claro, frases curtas, voz ativa, exemplo concreto em vez de abstração;
- o README é a porta de entrada: tudo é alcançável a partir dele, mas o detalhe fica na tech spec (link, nunca cópia);
- sem marketing, sem emojis, sem eufemismo sobre limitações;
- atualize no mesmo commit da mudança e rode cada comando do README antes de declarar um marco pronto.

### Tasks: siga o `TASKS.md`

Trabalhe as tasks na ordem do `TASKS.md`, uma de cada vez, marcando `[~]` ao começar e `[x]` no commit que a conclui. Antes de cada task, leia a seção da tech spec que ela cita. Uma task só está pronta quando o critério "Pronto quando" é verdadeiro e o typecheck e os testes passam.

### Commits: use a skill `commit-in-parts`

Todo commit segue a skill `.claude/skills/commit-in-parts/SKILL.md` (leia o arquivo se o seu agente não carrega skills sozinho). Em resumo:

- uma intenção por commit; se o assunto precisa de "e", são dois commits;
- todo commit compila e passa nos testes, para o histórico funcionar com `git bisect`;
- teste e documentação vão no mesmo commit do código que eles cobrem;
- mensagem Conventional Commits em português: `tipo(escopo): assunto` no imperativo, corpo explicando o porquê, rodapé `Refs: T<task>[, ADR-<n>]`;
- nunca `git add .` sem revisar o diff, nunca `--no-verify`, nunca reescrever o que já foi enviado.

---

## 1. Ordem de prioridade

Quando houver conflito de tempo ou de desenho, siga esta ordem (reflete os pesos da avaliação e as falhas eliminatórias):

1. **Correção financeira** — nada de dinheiro criado ou destruído, nada de saldo negativo.
2. **Concorrência** — correto com ≥ 3 instâncias, sem lost update.
3. **Idempotência persistente** — replay exato, conflito de payload detectado.
4. **Mensageria e recuperação** — inbox, outbox, retry, DLQ, crash recovery, shutdown.
5. **Modelagem** — invariantes nas classes de domínio, boundaries claros.
6. **Testes reais** — PostgreSQL e LocalStack de verdade, paralelismo de verdade.
7. **Observabilidade** — logs JSON, métricas, health.
8. **Documentação**.
9. **Teste de carga** — único diferencial planejado, depois de tudo acima.
10. **Autenticação** — vale 0 pontos; só o ponto de extensão e o desenho documentado (ver §12).

Simplicidade é critério de avaliação. Prefira a solução mais simples que **prova** a garantia, não a mais sofisticada.

---

## 2. Falhas eliminatórias — checklist que nunca pode falhar

Antes de cada commit relevante, confirme que **nenhum** item abaixo é verdadeiro:

- [ ] Existe `number`, `float`, `double`, `parseFloat`, `Number(...)` ou `toFixed` aplicado a valor monetário em qualquer camada (domínio, DTO, ORM, testes de asserção).
- [ ] Idempotência depende de `Map`, cache, Redis-sem-banco ou qualquer estado em memória.
- [ ] A correção depende da ordenação/deduplicação do SQS FIFO.
- [ ] Algum evento é enviado ao SQS dentro da transação financeira ou antes do commit.
- [ ] Algum código faz `UPDATE` ou `DELETE` em `wallet_ledger_entries`.
- [ ] Existe lock global (advisory lock fixo, mutex de processo, tabela de lock única).
- [ ] Saldo é atualizado com `read → calculate → update` sem lock de linha ou condição atômica.
- [ ] Alguma garantia de unicidade/imutabilidade/não-negatividade existe **só** no código TypeScript, sem constraint/trigger no banco.
- [ ] Algum teste de integração/concorrência substitui PostgreSQL ou SQS por mock.
- [ ] Algum cenário só passa com uma instância.

Se você não conseguir garantir um item, **pare e avise o humano** em vez de contornar.

---

## 3. Stack e versões

| Item | Escolha | Observações |
|---|---|---|
| Runtime / PM / testes | Bun 1.x | `bun test`; nada de Jest/Vitest |
| Linguagem | TypeScript `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | `experimentalDecorators` e `emitDecoratorMetadata` ligados (NestJS) |
| Framework | NestJS | adaptador Express padrão; `app.enableShutdownHooks()` |
| ORM | **MikroORM** (preferencial do enunciado) com `@mikro-orm/postgresql` | `em.transactional()`, `LockMode.PESSIMISTIC_WRITE` |
| Banco | PostgreSQL 16 | |
| Mensageria | SQS via LocalStack | `@aws-sdk/client-sqs` v3 |
| IDs | UUIDv7 (`Bun.randomUUIDv7()`) | ordenáveis no tempo; bons para índice e cursor |
| Logs | `pino` (via `nestjs-pino`) | JSON, redaction configurada |
| Métricas | `prom-client`, exposto em `GET /metrics` | |
| Validação de entrada | `zod` ou `class-validator` na borda HTTP/SQS | nunca no domínio |

Não adicione Prisma, TypeORM junto com MikroORM, nem bibliotecas de "decimal" com `number` por baixo. **Não há frontend neste desafio**: TanStack aparece na apresentação da empresa, mas não faz parte da stack obrigatória nem da avaliação; não crie UI. Toda dependência nova precisa de uma linha de justificativa em `ARCHITECTURE.md`.

### Comandos que devem existir (e estar no `README.md`)

```bash
docker compose up -d                 # postgres + localstack (+ criação das filas)
bun install
bun run migration:up                 # aplica migrations
bun run migration:down               # reverte a última (prova reversibilidade)
bun run start:dev                    # 1 instância API + workers
bun run start:cluster                # sobe 3 instâncias (portas distintas) para testes manuais
bun run test:unit
bun run test:integration             # exige docker compose de teste
bun run test:concurrency
bun test                             # tudo
bun run test:load                    # opcional (diferencial)
bun run lint && bun run typecheck
```

---

## 4. Arquitetura

Hexagonal / DDD leve, organizada por módulo. O **domínio não importa nada** de NestJS, MikroORM, AWS SDK ou pino, nem de `application`/`infra`; `application` não importa `infra`. Isso é garantido por `no-restricted-imports` no ESLint (task T1.2b), não por disciplina: se o lint reclamar, mude o desenho, nunca a regra.

```
src/
  shared/
    domain/            Money, DomainError, FailureCode, Clock, IdGenerator (portas)
    events/            IntegrationEvent (abstrata), EventContext
    infra/             logger, metrics, correlation (AsyncLocalStorage), config
  wallet/
    domain/            Wallet, WalletLedgerEntry, LedgerDirection
    application/       OpenWallet, GetWallet, ListLedger, ReconcileWallet (use cases)
    infra/             persistence (entities MikroORM + mappers), http controllers
  wagering/
    domain/            WagerTransaction, kinds, status, regras de referência, payload hash
    application/       SubmitWagerTransaction (USE CASE ÚNICO p/ HTTP e SQS),
                       ReprocessPendingReferences, GetTransaction
    infra/             persistence, http controller, sqs consumer
  messaging/
    domain/            InboxMessage, OutboxMessage
    application/       OutboxPublisher
    infra/             repositórios, SQS publisher, workers (polling loops)
  health/
  auth/                AuthGuard no-op + ProviderIdentityPort (ver §12)
migrations/
test/
  unit/  integration/  concurrency/  load/  support/
```

### Regras de modelagem (enunciado §6.0)

- Construtor `private`; factories estáticas `create`/`open`/`from` (validam) e `rehydrate` (não valida transições, só reconstrói).
- Estado mutável é `private _campo` com getter; mudanças só por métodos de transição nomeados.
- **Entidades de persistência são separadas das de domínio.** Use `EntitySchema`/entidades MikroORM em `infra/persistence` e mappers `toDomain` (via `rehydrate`) / `toPersistence`. Motivo: o domínio tem construtor privado e não pode depender de decorators do ORM; registre isso no `ARCHITECTURE.md`.
- Erros de domínio são classes (`InsufficientFundsError`, `CurrencyMismatchError`, `InvalidTransactionStateError`...) com `failureCode` estável. Nunca `throw new Error("string")` no domínio.
- Transição a partir de estado terminal lança `InvalidTransactionStateError` (erro de programação → 500, alerta), não é rejeição de negócio.

---

## 5. Decisões já tomadas (implemente assim, salvo motivo forte documentado)

### Registro de decisões fechadas com o humano

Estas não são reabertas pelo agente; qualquer dúvida sobre elas vai ao humano. Cada uma vira um ADR em `ARCHITECTURE.md` e uma seção na tech spec.

| ADR | Decisão | Onde |
|---|---|---|
| ADR-001 | Compensação única: REFUND e ROLLBACK mutuamente exclusivos sobre a mesma referência | §5.4 |
| ADR-002 | Wallet inexistente é rejeição persistida (`REJECTED` / `WALLET_NOT_FOUND`, HTTP 422) | §5.3 |
| ADR-003 | `amount` com exatamente 2 casas decimais na entrada, sem normalização | §5.1 |
| ADR-004 | `PENDING_REFERENCE` com prazo de 24h, backoff até 5 min e tentativa final após o prazo | §5.6 |

### 5.1 Money

- Representação interna: **`bigint` em unidades menores** (centavos), escala fixa 2. Sem dependência externa, exato, imutável. O esqueleto do enunciado cita `Decimal`; a adaptação é permitida ("nomes e assinaturas podem ser adaptados") — documente.
- **DECISÃO FECHADA — escala estrita na entrada (ADR-003):** `amount` deve ter **exatamente 2 casas decimais**, regex `^(0|[1-9]\d*)\.\d{2}$`. Rejeita com `INVALID_PAYLOAD`: `"25"`, `"25.5"`, `"25.001"`, `NaN`, `Infinity`, `1e3`, `""`, `" 1.00"`, `-1.00`, `+1.00`, `01.00`, `.50`, e qualquer valor que não seja string (inclusive `number` JSON).
  - Motivo: o contrato diz que o valor é "recebido e serializado [...] sempre com escala fixa de 2 casas". Seguir o texto elimina normalização na borda e garante que o `payloadHash` usa exatamente a string recebida — `"25"` e `"25.00"` nunca são ambíguos.
  - O limite superior de magnitude segue `NUMERIC(20,2)`; valores acima são `INVALID_PAYLOAD` (validar antes de chegar ao banco).
- Não há arredondamento: mais de 2 casas é **rejeitado**, nunca arredondado.
- Moeda: `^[A-Z]{3}$`; operações entre moedas distintas lançam `CurrencyMismatchError`.
- Valores negativos só existem como resultado interno (`negate`, `subtract`); contratos de entrada exigem `> 0` para transações e `>= 0` para saldo inicial.
- Serialização: sempre `{ amount: "25.00", currency: "BRL" }`.
- Banco: `NUMERIC(20,2)` + coluna `CHAR(3)` de moeda. O driver `pg` retorna `NUMERIC` como **string** — mantenha assim (não registre parser para float). Custom type MikroORM converte string ↔ `bigint`.
- Teste de propriedade: nenhum caminho de código faz `Number(amount)`. Adicione regra de lint (`no-restricted-syntax`) proibindo `parseFloat`/`Number(` em `src/**/domain` e mappers de dinheiro.

### 5.2 Estratégia de concorrência

**Pessimistic lock por wallet + update condicionado + constraints como última linha de defesa.**

- Toda operação financeira roda em `em.transactional()` com `SELECT ... FROM wallets WHERE id = $1 FOR UPDATE`.
- O `UPDATE` de saldo é condicionado: `UPDATE wallets SET balance = $new, version = version + 1, updated_at = now() WHERE id = $id AND version = $expectedVersion` — afetar 0 linhas é bug (lança erro, não segue).
- `CHECK (balance_amount >= 0)` no banco garante a não-negatividade mesmo se o código errar.
- `SET LOCAL lock_timeout = '2s'` (configurável). Timeout de lock → erro **transitório** (HTTP 503 / SQS retry com backoff) + métrica `lock_conflicts_total`.
- Uma transação toca **uma única wallet**, logo não há ordem de locks a negociar nem deadlock entre wallets. Se um dia tocar duas, ordenar por `id`.
- Justificativa (para `ARCHITECTURE.md`): hot wallet com optimistic locking gera tempestade de retries; com `FOR UPDATE` as operações da mesma wallet serializam no banco, wallets distintas seguem em paralelo, e a correção independe de quantas instâncias existem.
- Isolamento: `READ COMMITTED` é suficiente porque toda leitura que decide algo acontece **depois** do lock da wallet. Documente isso.

### 5.3 Idempotência

- Chave: header `Idempotency-Key` (HTTP) ou `data.idempotencyKey` (SQS). Obrigatória. Default recomendado `{providerId}:{externalTransactionId}`.
- `payloadHash`: SHA-256 hex de JSON canônico (chaves ordenadas recursivamente, sem espaços, UTF-8) contendo **apenas campos de negócio já normalizados**: `providerId, externalTransactionId, playerId, walletId, roundId, gameId, kind, money{amount,currency}, referenceExternalTransactionId` (ausente → `null`). Prefixe a versão do algoritmo: `v1:<hex>`. Documente o algoritmo com um exemplo de entrada → hash em `ARCHITECTURE.md` e teste esse vetor.
- Constraints: `UNIQUE (idempotency_key)` **e** `UNIQUE (provider_id, external_transaction_id)`.
- Fluxo dentro da transação, **após** obter o lock da wallet:
  1. buscar transação por `idempotency_key`;
  2. existe e hash igual → **replay**: devolver o resultado gravado, `idempotentReplay: true`, sem tocar em saldo;
  3. existe e hash diferente → `IDEMPOTENCY_KEY_CONFLICT` (409), nada é gravado;
  4. não existe mas `(provider_id, external_transaction_id)` existe com outra key → conflito também (409, código distinto);
  5. não existe → processar.
- Como o lock da wallet vem antes da busca, as 50 requisições paralelas idênticas serializam; a `UNIQUE` cobre qualquer caminho que escape (ex.: wallet inexistente). Violação de unique (`23505`) em idempotency → reler e tratar como replay/conflito, nunca 500.
- **Replay exato** (regra 7): grave na própria `wager_transactions` o snapshot do resultado: `result_balance_amount/currency` (saldo observado naquele momento, inclusive para `REJECTED` e `LOSS`) e `failure_code`. A resposta de replay é montada só a partir da linha persistida.
- **DECISÃO FECHADA — wallet inexistente é rejeição persistida (ADR-002):** a transação é gravada `REJECTED` com `WALLET_NOT_FOUND`, `WagerTransactionRejected` vai para a outbox, HTTP responde `422` e o SQS faz ack.
  - Motivo: rejeição auditável como qualquer outra, e replay estável — se a wallet for criada depois, a mesma idempotency key continua devolvendo a rejeição original em vez de passar a processar (o provedor já recebeu uma resposta terminal; mudar de ideia criaria divergência entre os dois lados).
  - Schema: `requested_wallet_id UUID NOT NULL` guarda o que veio no payload (entra no hash); `wallet_id UUID NULL REFERENCES wallets(id)` é a wallet resolvida, e
    `CHECK (wallet_id IS NOT NULL OR (status = 'REJECTED' AND failure_code = 'WALLET_NOT_FOUND'))`.
  - Concorrência: sem wallet não há linha para travar; a serialização de duplicatas vem de `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` seguido de releitura (replay se o hash bate, conflito se não). Nada de saldo é tocado nesse caminho, então não há risco financeiro.
  - Wallet existente mas de outro player → `WALLET_PLAYER_MISMATCH`, também persistida como `REJECTED` (aqui há wallet, então o caminho normal com lock se aplica).

### 5.4 Regras de referência (REFUND / ROLLBACK)

- Resolução por `(provider_id, reference_external_transaction_id)` → precisa casar provider, player, wallet, moeda e rodada; senão `REFERENCE_MISMATCH`.
- `REFUND` só aponta `BET`; `ROLLBACK` aponta `BET`, `WIN` ou `REFUND`; senão `INVALID_REFERENCE_KIND`.
- Referência precisa estar `PROCESSED`. Se estiver `PENDING`/`PENDING_REFERENCE`, a transação dependente também vai para `PENDING_REFERENCE`. Se estiver `REJECTED`/`FAILED` → `REFERENCE_NOT_PROCESSED` (rejeitada).
- Valor igual ao da referência; senão `AMOUNT_MISMATCH`.
- Direção do `ROLLBACK` = inverso do lançamento da referência (rollback de `BET` credita; de `WIN` ou `REFUND` debita).
- Reversão que deixaria saldo negativo → `REJECTED` com `REVERSAL_INSUFFICIENT_FUNDS` (distinto de `INSUFFICIENT_FUNDS` da aposta).
- **DECISÃO FECHADA — compensação única (ADR-001):** toda transação pode ser compensada **no máximo uma vez**, por `REFUND` **ou** por `ROLLBACK` — os dois são mutuamente exclusivos sobre a mesma referência. A segunda compensação é `REJECTED` com `REFERENCE_ALREADY_REVERSED`.
  - Motivo: a leitura literal da regra 4 ("não pode ser revertida duas vezes **pelo mesmo tipo**") permitiria `REFUND` + `ROLLBACK` na mesma `BET`, devolvendo o valor em dobro e violando o invariante global "não duplicar créditos". Entre as duas regras do enunciado, prevalece o invariante financeiro.
  - `ROLLBACK` de um `REFUND` continua permitido (aponta para o `REFUND`, não para a `BET`) e desfaz o reembolso.
  - Limitação aceita: após `BET → REFUND → ROLLBACK(REFUND)` a `BET` volta a valer, mas **não** pode ser compensada de novo. Caso raro, documentado em `ARCHITECTURE.md`; a alternativa (estado de compensação que reabre) foi descartada por complexidade sem ganho proporcional.
  - Garantia no schema: índice único parcial
    `UNIQUE (reference_transaction_id) WHERE status = 'PROCESSED' AND kind IN ('REFUND','ROLLBACK')`.
    O mesmo índice cobre "um `WIN`/`REFUND` só sofre `ROLLBACK` uma vez", já que só `ROLLBACK` pode referenciá-los.
  - Na aplicação: checar sob o lock da wallet e devolver `REFERENCE_ALREADY_REVERSED`; violação do índice (`23505`) nesse caminho é bug (o lock deveria ter evitado) → logar como erro e tratar como a mesma rejeição.
  - Duas compensações em `PENDING_REFERENCE` para a mesma referência: quando a referência chega, a primeira a obter o lock é processada e a outra é rejeitada com `REFERENCE_ALREADY_REVERSED`. A ordem entre elas não é garantida, e isso é aceito.
  - Testes obrigatórios: REFUND+ROLLBACK na mesma BET (sequencial e concorrente) → um crédito só; ROLLBACK de REFUND → débito; segundo ROLLBACK do mesmo REFUND → rejeitado; insert direto via SQL violando o índice → erro.
- `WIN` e `LOSS` podem ter referência opcional à `BET`; se informada, valide as mesmas regras de pertencimento. Documente se `LOSS`/`WIN` sem referência são aceitos (recomendado: sim).

### 5.5 Máquina de estados de `WagerTransaction`

```
(create) ─► PENDING ─┬─► PROCESSED           (terminal)
                     ├─► REJECTED            (terminal)
                     ├─► FAILED              (terminal)
                     └─► PENDING_REFERENCE ─┬─► PROCESSED / REJECTED / FAILED
                                            └─► PENDING_REFERENCE (nova tentativa)
```

- Na prática uma transação recebida e processada na mesma transação SQL nasce `PENDING` em memória e é persistida já no estado final; documente que `PENDING` persistido só existe se a arquitetura enfileirar trabalho.
- Reforce no banco: trigger `BEFORE UPDATE` em `wager_transactions` que rejeita mudança se `OLD.status IN ('PROCESSED','REJECTED','FAILED')`, e que impede alterar colunas de identidade (`idempotency_key`, `payload_hash`, `money`, `kind`...).

### 5.6 `PENDING_REFERENCE` worker

- **DECISÃO FECHADA — prazo de 24h, backoff com teto de 5 min (ADR-004):**
  - Limite por **prazo**, não por contagem: `reference_deadline_at = received_at + 24h` (configurável via env, default 24h).
  - Backoff: `1s × 2^tentativas` com jitter de ±20%, teto de **5 min**; ~300 tentativas no pior caso, cada uma é um lookup indexado barato.
  - Ao vencer o prazo, o worker faz **uma última tentativa** de resolução antes de rejeitar — assim, uma indisponibilidade do worker que atravesse o prazo nunca rejeita uma transação cuja referência já chegou.
  - Esgotado: `REJECTED` com `REFERENCE_NOT_FOUND` + `WagerTransactionRejected`.
  - Reprocessamento imediato: ao processar qualquer transação, reagendar para `now()` as `PENDING_REFERENCE` que apontam para `(provider_id, external_transaction_id)` dela — na prática a espera típica é de milissegundos, e o backoff é só a rede de segurança.
  - Motivo: nada fica travado enquanto uma transação espera (sem lock, sem saldo reservado), então um prazo longo é barato; 24h cobre referências presas em DLQ e reenviadas manualmente após um incidente. Contagem de tentativas foi descartada porque é sensível à disponibilidade do próprio worker.
  - Testes usam `Clock` injetável para avançar o tempo — nunca esperar 24h nem mexer no relógio do sistema.
- Colunas: `reference_attempts INT`, `next_reference_attempt_at TIMESTAMPTZ`, `reference_deadline_at TIMESTAMPTZ`.
- Worker em todas as instâncias: claim com `SELECT id FROM wager_transactions WHERE status='PENDING_REFERENCE' AND next_reference_attempt_at <= now() ORDER BY next_reference_attempt_at LIMIT n FOR UPDATE SKIP LOCKED`, e reprocessa cada uma **chamando o mesmo serviço de domínio** (lock da wallet, regras, ledger, outbox).
- Backoff, prazo e reprocessamento imediato: ver ADR-004 acima.

### 5.7 Inbox (consumidor SQS)

- Tabela `inbox_messages`, PK `(consumer_name, message_id)`, com `payload_hash`.
- Mesma transação SQL: `INSERT ... ON CONFLICT DO NOTHING` na inbox → se não inseriu, mensagem já processada → **ack** sem efeito (métrica `duplicates_detected_total{source="inbox"}`).
- Mesmo `messageId` com hash diferente → log de alerta + DLQ (permanente).
- `messageId` diferente com mesma `idempotencyKey` é resolvido pela idempotência da transação (§5.3), não pela inbox.

### 5.8 Outbox

- Gravação: `OutboxMessage.enqueue(event)` na **mesma** transação do saldo/ledger/inbox. Payload = `event.toJSON()`.
- Publisher em todas as instâncias, padrão **lease**:
  1. transação curta: `UPDATE outbox_messages SET locked_until = now() + interval '30s', locked_by = $instance WHERE id IN (SELECT id FROM outbox_messages WHERE published_at IS NULL AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now()) ORDER BY occurred_at LIMIT n FOR UPDATE SKIP LOCKED) RETURNING *`;
  2. publica no SQS **fora** de qualquer transação;
  3. sucesso → `published_at = now()`; falha → `scheduleRetry` (attempts++, backoff) e libera o lease.
- Instância morta com lease → lease expira e outra instância publica (cenário obrigatório §11).
- Destino: fila `wagering-events.fifo` (o enunciado não nomeia — documente). `MessageGroupId = aggregateId`, `MessageDeduplicationId = eventId`. Consumidores deduplicam por `eventId`; documente que a entrega é at-least-once.
- Métrica `outbox_lag_seconds` = `now() - min(occurred_at) WHERE published_at IS NULL`.

### 5.9 Consumidor SQS

- Long polling (`WaitTimeSeconds=20`), `VisibilityTimeout` > tempo máximo de processamento.
- Valida o envelope e `type === "WagerTransactionRequested"`; chama `SubmitWagerTransaction` (o **mesmo** use case do HTTP).
- Classificação de erros (implementar como tipos, não por mensagem de texto):

| Classe | Exemplos | Ação |
|---|---|---|
| Negócio | `INSUFFICIENT_FUNDS`, `REFERENCE_MISMATCH`, conflito de idempotência, resultado `PENDING_REFERENCE` | commit (quando aplicável) → **delete/ack** |
| Transitória | conexão com PG, `lock_timeout`, serialização, throttling SQS | **não** deleta; `ChangeMessageVisibility` com backoff exponencial |
| Permanente | JSON inválido, schema inválido, `kind = OPENING`, `messageId` reutilizado com outro payload | envia à DLQ explicitamente e ack (ou deixa o redrive levar) |

- Limite de tentativas: `RedrivePolicy.maxReceiveCount` (ex.: 5) na fila principal → `wager-transactions-dlq.fifo`; use `ApproximateReceiveCount` para decidir o backoff. Métrica `dlq_messages_total`.
- Ack **somente após commit**. Nunca deletar mensagem dentro do `transactional()`.
- `SIGTERM`: parar de buscar novas mensagens, aguardar as em andamento (com timeout), `ChangeMessageVisibility(0)` nas recebidas e não iniciadas, parar workers de outbox/pending, fechar ORM. Use `onApplicationShutdown`.
- Hook de injeção de falha **apenas em teste** (ex.: env `FAULT_INJECTION=exit_after_commit_before_ack`) para o cenário "worker morto depois do commit e antes do ack". Nunca ativo em produção; documente.

### 5.10 Mapeamento HTTP (consistente em todos os endpoints)

| Situação | Status | Corpo |
|---|---|---|
| Transação nova processada | `201` | `{transactionId, status:"PROCESSED", balance, idempotentReplay:false}` |
| Replay de transação processada | `200` | mesmo corpo, `idempotentReplay:true` |
| Aceita, aguardando referência | `202` | `status:"PENDING_REFERENCE"` |
| Payload/header inválido | `400` | `application/problem+json`, `code:"INVALID_PAYLOAD"` + erros de campo |
| Conflito de idempotência / duplicidade de wallet | `409` | `code:"IDEMPOTENCY_KEY_CONFLICT"` / `"WALLET_ALREADY_EXISTS"` |
| Rejeição por regra de negócio | `422` | `{transactionId, status:"REJECTED", failureCode, balance, idempotentReplay}` |
| Recurso não encontrado (somente endpoints `GET`) | `404` | problem+json — wallet inexistente em `POST /wagering/transactions` é `422 WALLET_NOT_FOUND` (ADR-002) |
| Falha transitória de infraestrutura | `503` + `Retry-After` | problem+json, `retryable:true` |
| Bug / estado inválido | `500` | sem detalhes internos |

Todo erro usa `application/problem+json` com `code` estável e `retryable` booleano. Replay de rejeição devolve o mesmo `422` com `idempotentReplay:true`.

### 5.11 Taxonomia de `failureCode` (ponto de partida — documentar em `ARCHITECTURE.md`)

| Código | Terminal? | Provedor deve |
|---|---|---|
| `INVALID_PAYLOAD` | sim | corrigir payload |
| `IDEMPOTENCY_KEY_CONFLICT` | sim | não reenviar com a mesma key |
| `DUPLICATE_EXTERNAL_TRANSACTION` | sim | investigar |
| `WALLET_NOT_FOUND` | sim | corrigir |
| `WALLET_PLAYER_MISMATCH` | sim | corrigir |
| `CURRENCY_MISMATCH` | sim | corrigir |
| `INSUFFICIENT_FUNDS` | sim | desistir |
| `REVERSAL_INSUFFICIENT_FUNDS` | sim | escalar (operacional) |
| `REFERENCE_REQUIRED` | sim | corrigir |
| `REFERENCE_NOT_FOUND` | sim (após TTL) | investigar |
| `REFERENCE_MISMATCH` | sim | corrigir |
| `INVALID_REFERENCE_KIND` | sim | corrigir |
| `REFERENCE_NOT_PROCESSED` | sim | desistir |
| `REFERENCE_ALREADY_REVERSED` | sim | desistir (já compensada por REFUND ou ROLLBACK — ADR-001) |
| `AMOUNT_MISMATCH` | sim | corrigir |
| `INFRA_UNAVAILABLE` | não | reenviar com backoff |
| `PROCESSING_FAILED` (`FAILED`) | sim | escalar |

---

## 6. Schema do banco (garantias no schema — restrição inviolável 9)

Migrations versionadas **com `up` e `down`**; constraints e triggers em SQL explícito dentro das migrations do MikroORM. Teste: `up → down → up` em CI.

### `wallets`
- `id UUID PK`, `player_id UUID`, `currency CHAR(3)`, `balance_amount NUMERIC(20,2)`, `version INT`, timestamps.
- `UNIQUE (player_id, currency)`; `CHECK (balance_amount >= 0)`; `CHECK (version >= 1)`; `CHECK (currency ~ '^[A-Z]{3}$')`.

### `wager_transactions`
- Colunas do domínio + `result_balance_amount`, `failure_code`, `reference_transaction_id UUID NULL FK`, campos do worker de referência, `correlation_id`.
- `requested_wallet_id UUID NOT NULL` + `wallet_id UUID NULL FK` com `CHECK (wallet_id IS NOT NULL OR (status = 'REJECTED' AND failure_code = 'WALLET_NOT_FOUND'))` (ADR-002).
- `CHECK (status <> 'PENDING_REFERENCE' OR (reference_deadline_at IS NOT NULL AND next_reference_attempt_at IS NOT NULL))` (ADR-004).
- `UNIQUE (idempotency_key)`; `UNIQUE (provider_id, external_transaction_id)`.
- `CHECK (amount > 0)`; `CHECK` de enums de `kind` e `status`.
- `CHECK (kind NOT IN ('REFUND','ROLLBACK') OR reference_external_transaction_id IS NOT NULL)`.
- `CHECK (status <> 'REJECTED' OR failure_code IS NOT NULL)`; `CHECK (status <> 'PROCESSED' OR processed_at IS NOT NULL)`.
- Índice único parcial de compensação única (ADR-001, §5.4): `UNIQUE (reference_transaction_id) WHERE status = 'PROCESSED' AND kind IN ('REFUND','ROLLBACK')`.
- Índice parcial para o worker: `(next_reference_attempt_at) WHERE status = 'PENDING_REFERENCE'`.
- Trigger de imutabilidade de estado terminal (§5.5).
- Índice de consulta por `(provider_id, reference_external_transaction_id)`.

### `wallet_ledger_entries` (append-only)
- `id UUID PK`, `seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE` (cursor estável), `wallet_id FK`, `transaction_id FK`, `direction`, `amount`, `currency`, `balance_before`, `balance_after`, `wallet_version INT`, `created_at`.
- `UNIQUE (transaction_id, wallet_id)` — no máximo um lançamento por wallet por transação.
- `UNIQUE (wallet_id, wallet_version)` — cadeia sem buracos nem duplicatas.
- `CHECK (amount > 0)`; `CHECK (balance_after >= 0)`;
  `CHECK ((direction='CREDIT' AND balance_after = balance_before + amount) OR (direction='DEBIT' AND balance_after = balance_before - amount))`.
- Trigger `BEFORE UPDATE OR DELETE` → `RAISE EXCEPTION` (imutabilidade). Bloquear `TRUNCATE` também. Opcional: `REVOKE UPDATE, DELETE` do role da aplicação.
- **Diferencial recomendado:** constraint trigger `DEFERRABLE INITIALLY DEFERRED` em `wallets` (insert/update) que exige, no commit, um lançamento com `wallet_id = NEW.id AND wallet_version = NEW.version AND balance_after = NEW.balance_amount` (exceto wallet aberta com saldo zero, versão 1). Isso faz do banco o guardião de "toda alteração de saldo tem lançamento".
- Semântica de `version`: wallet aberta com saldo > 0 → `version 1` = lançamento `OPENING`; aberta com zero → `version 1` sem lançamento; cada lançamento posterior incrementa a versão. `LOSS` e `REJECTED` não incrementam.

### `inbox_messages`
- `PRIMARY KEY (consumer_name, message_id)`, `payload_hash`, `received_at`, `processed_at`.

### `outbox_messages`
- `id UUID PK` (= `eventId`), `aggregate_id`, `event_type`, `payload JSONB`, `occurred_at`, `attempts`, `next_attempt_at`, `locked_until`, `locked_by`, `published_at`, `last_error`.
- Índice parcial `(next_attempt_at) WHERE published_at IS NULL`.
- Trigger impedindo alterar `payload`/`event_type` depois de gravado.

### Paginação do ledger
Cursor opaco = base64url de `{"seq": <n>}` (versionado). `ORDER BY seq` + `WHERE seq > $cursor`. `limit` entre 1 e 200, default 50. Retornar `nextCursor` nulo quando acabar.

---

## 7. Fluxo canônico de `SubmitWagerTransaction`

```
validar entrada (borda) → normalizar Money → calcular payloadHash
BEGIN
  [SQS] INSERT inbox ON CONFLICT DO NOTHING → se duplicado: COMMIT; ack; fim
  SET LOCAL lock_timeout
  SELECT wallet FOR UPDATE            (não existe → caminho ADR-002: INSERT REJECTED ON CONFLICT, outbox, fim)
  checar idempotência (§5.3)           (replay / conflito → retorna sem efeito)
  WagerTransaction.create(...)         (valida kind, referência obrigatória, OPENING proibido)
  resolver referência (§5.4)           (ausente → PENDING_REFERENCE + evento)
  aplicar regra do kind no agregado Wallet → retorna WalletLedgerEntry | nada
  persistir transação (+ snapshot de resultado), wallet (update condicionado), ledger
  enfileirar eventos na outbox:
     Processed | Rejected | PendingReference ; + WalletBalanceChanged se houve lançamento
  [SQS] marcar inbox processada
COMMIT
[SQS] ack
```

O use case recebe um `SubmissionSource` (`http` | `sqs` com `messageId`/`consumerName`) — a regra de negócio é idêntica.

`POST /wallets` segue o mesmo padrão: wallet + transação `OPENING` + lançamento `CREDIT` + outbox na mesma transação SQL; violação de `UNIQUE (player_id, currency)` → 409.

Reconciliação: soma dos lançamentos (`CREDIT - DEBIT`) comparada ao saldo armazenado, **e** checagem de cadeia (`balance_before` de cada entrada = `balance_after` da anterior). Divergência → log `warn` estruturado, `reconciliation_mismatches_total++`, `consistent:false`. **Nunca corrigir.**

---

## 8. Eventos de integração

- `IntegrationEvent<T>` abstrata; uma subclasse por evento com `eventType` e `version` **no tipo** e factory `static from(...)`.
- `data` contém `MoneyProps` (strings), nunca `Money` nem `bigint` (JSON.stringify quebra com bigint).
- `correlationId` vem do request/mensagem (header `X-Correlation-Id` ou `messageId`); `causationId` = id da mensagem/transação que causou.
- Teste de snapshot do `toJSON()` de cada evento para travar o contrato.

| Evento | Quando |
|---|---|
| `WagerTransactionProcessed` | qualquer transação aplicada, inclusive `LOSS` |
| `WagerTransactionRejected` | rejeição de negócio (inclusive TTL de referência) |
| `WalletBalanceChanged` | somente quando há lançamento |
| `WagerTransactionPendingReference` | referência ausente |

---

## 9. Observabilidade

- Correlação via `AsyncLocalStorage`: todo log carrega `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId` quando conhecidos.
- **Redaction**: não logar payload completo, valores monetários de saldo, `playerId` em claro além do necessário, headers de auth. Configure `pino.redact`.
- Métricas mínimas (nomes sugeridos):
  - `wager_transactions_total{status,kind,source}`
  - `idempotency_duplicates_total{source}` (replay HTTP, inbox SQS)
  - `processing_retries_total{reason}`
  - `dlq_messages_total`
  - `lock_conflicts_total`
  - `outbox_lag_seconds` (gauge) e `outbox_pending_messages` (gauge)
  - `wager_processing_duration_seconds` (histogram)
  - `reconciliation_mismatches_total`
- `GET /health/live` sem dependências; `GET /health/ready` faz `SELECT 1` e `GetQueueUrl`/`GetQueueAttributes` com timeout curto. Ambos sem auth.

---

## 10. Estratégia de testes

Regras gerais:
- Unit tests não tocam banco nem rede. Integração e concorrência usam **PostgreSQL e LocalStack reais** (via `docker-compose.test.yml`), schema criado pelas **migrations reais**.
- Isolamento: banco limpo por arquivo de teste (schema por worker ou `TRUNCATE` controlado via role de teste — lembre que o ledger bloqueia `TRUNCATE` para o role da app), filas com sufixo único por teste.
- **Sem `sleep` fixo.** Use barreiras (`Promise.all` disparado em conjunto) e `eventually(fn, {timeout})` com polling.
- Helper obrigatório `assertWalletConsistent(walletId)`: saldo armazenado == soma do ledger, cadeia contínua, versões sem buracos. **Chame ao final de todo teste de integração e concorrência.**
- Paralelismo real: múltiplas conexões/pool (não uma conexão compartilhada), requests HTTP concorrentes contra a app real, e `Bun.spawn` para processos separados.

Matriz obrigatória (enunciado §13) — cada item vira ao menos um teste nomeado de forma explícita:

| # | Cenário | Como provar |
|---|---|---|
| U | Money: escala, entradas inválidas (tabela), sem arredondamento, moeda | `test/unit/money.test.ts` table-driven |
| U | Wallet invariantes, BET/WIN/LOSS/REFUND/ROLLBACK, conflito de moeda, hash divergente | unit por agregado |
| I | Migrations up/down/up; cada constraint dispara (insert inválido direto via SQL → erro esperado) | `test/integration/schema.test.ts` |
| I | Atomicidade: falha forçada após ledger e antes do commit → nada persistido (wallet, ledger, inbox, outbox) | |
| I | Inbox e redelivery: mesma mensagem 2× → 1 efeito | |
| I | Retry e DLQ: erro transitório → reprocessa; permanente/excesso → DLQ | |
| C1 | Mesma aposta 50× em paralelo → 1 débito, 49 replays idênticos | |
| C2 | Saldo 100.00, duas apostas de 80.00 simultâneas → 1 PROCESSED, 1 REJECTED `INSUFFICIENT_FUNDS`, saldo 20.00, 1 débito | |
| C3 | N wallets em paralelo, sem interferência, tempo total compatível com paralelismo | |
| C4 | ≥ 3 processos (`Bun.spawn`) consumindo a mesma fila e servindo HTTP para as mesmas wallets | |
| C5 | Worker morto após commit e antes do ack → redelivery não duplica | fault injection + kill |
| C6 | Dois publishers sobre a mesma outbox → todo evento publicado, duplicatas apenas por lease expirado e com mesmo `eventId` | |
| C7 | `REFUND`/`ROLLBACK` antes da referência → `PENDING_REFERENCE` → processado quando a referência chega; e expiração → `REFERENCE_NOT_FOUND` | relógio injetável (`Clock`) |
| C8 | Reinício do serviço com mensagens em voo → consistência final | |
| C9 | Hot wallet: 300 operações misturadas numa wallet, entre 3 instâncias | invariantes + nenhum duplicado |
| I10 | Postgres indisponível durante carga → 503, retry por visibilidade, recuperação sem duplicar | `docker pause`/`unpause` |
| I11 | SQS indisponível → API segue, outbox acumula e drena depois | `docker pause`/`unpause` |
| A1 | Regra de dependência entre camadas | lint |

O enunciado afirma que "PostgreSQL e SQS podem ficar temporariamente indisponíveis". I10 e I11 são a prova disso — não os trate como opcionais.

### Diferencial: teste de carga

É o **único** diferencial a implementar (marco M11, depois do M10). Partidas dobradas, OpenTelemetry, dashboard e Keycloak foram descartados pelo humano. A metodologia está na spec §12.2 e não é negociável nos pontos que dão credibilidade ao resultado:

- modelo aberto (taxa constante), latência medida a partir do horário agendado — nunca um laço que espera a resposta anterior;
- aquecimento descartado, várias repetições, mediana e dispersão;
- reconciliação de todas as wallets ao fim de cada execução; execução inconsistente não entra no relatório e vira bug;
- relatório com gargalo identificado **com evidência** e limitações do ambiente ditas sem rodeio.

---

## 11. Plano de implementação (fatias verticais, nessa ordem)

O detalhamento em tasks está no `TASKS.md`; esta lista é só o resumo dos marcos. Cada marco termina com testes verdes, `typecheck` limpo e `README.md`/`ARCHITECTURE.md` atualizados pela skill `project-docs` (checklist dela incluído).

1. **Esqueleto**: Bun + Nest + MikroORM + docker compose (PG, LocalStack, criação das filas e DLQ com redrive) + health + logger + config. `docs/CHALLENGE.md` movido.
2. **Money** completo com testes unitários exaustivos.
3. **Schema**: todas as tabelas, constraints e triggers + testes de schema.
4. **Wallet + OPENING + ledger**: `POST /wallets`, `GET /wallets/:id`, ledger paginado, reconciliação.
5. **BET/WIN/LOSS via HTTP** com idempotência e lock; testes C1, C2, C3.
6. **Outbox + publisher** com lease; teste C6.
7. **REFUND/ROLLBACK + PENDING_REFERENCE worker**; teste C7.
8. **Consumidor SQS + inbox + classificação de erros + DLQ + SIGTERM**; testes I, C4, C5, C8.
9. **Métricas e redaction** revisadas.
10. **Docs finais**: passe completo da skill `project-docs` sobre README e ARCHITECTURE; preencher "O que faríamos com mais tempo".
11. Diferencial: teste de carga (spec §12.2). Nenhum outro diferencial.

---

## 12. Autenticação

Valor zero na avaliação e **não será implementada** (decisão do humano). O que entra:
- `AuthGuard` no-op aplicado globalmente, exceto health; `ProviderIdentityPort` que hoje retorna a identidade a partir do payload.
- Documentar em `ARCHITECTURE.md` o desenho alvo: Keycloak via Docker Compose, client-credentials por provedor, validação de JWT (JWKS) no guard, `azp`/claim de provider comparado ao `providerId` do payload (mismatch → 403).
- Mensagens da fila são canal interno confiável, mas o `providerId` da mensagem continua sujeito às validações de domínio.
- Nunca implementar tabela própria de usuários/senhas.

---

## 13. Regras de trabalho para o agente

- **Planeje antes de codar** cada marco: liste arquivos, migrations e testes que vai criar; só então implemente.
- **Teste primeiro** para invariantes financeiras e de concorrência: escreva o teste que falharia sem a garantia.
- **Nunca enfraqueça uma constraint, um teste ou um check para fazer algo passar.** Se um teste de concorrência falha de forma intermitente, isso é um bug real até prova em contrário — investigue, não adicione retry no teste.
- Nunca use `any`, `as unknown as`, `@ts-ignore` ou `!` não justificado em código de domínio/financeiro.
- Rode `bun run typecheck && bun test` antes de declarar um marco pronto; cole o resumo da saída no relato.
- Toda decisão não trivial ou interpretação de regra ambígua vira entrada em `ARCHITECTURE.md` (problema → decisão → descartado → custo, como manda a skill `project-docs`) **no mesmo commit**.
- Ao encontrar ambiguidade no enunciado: escolha a interpretação mais conservadora financeiramente (que nunca cria dinheiro), implemente, documente e sinalize ao humano.
- Commits pela skill `commit-in-parts`, citando a task do `TASKS.md`; um marco por branch/PR se o humano pedir.
- Não gere código morto, abstrações sem segundo uso, nem camadas "para o futuro". Simplicidade conta pontos.

---

## 14. Definição de pronto (entrega)

- [ ] `docker compose up -d && bun install && bun run migration:up && bun test` funciona do zero numa máquina limpa.
- [ ] Todos os cenários da §10 existem como testes nomeados e passam 10 execuções seguidas sem flakiness.
- [ ] `assertWalletConsistent` roda ao fim de todos os testes de integração/concorrência.
- [ ] Checklist eliminatório da §2 revisado item a item.
- [ ] `README.md` na estrutura da skill `project-docs`: requisitos, como rodar, testes, como funciona, API, configuração, 3 instâncias, observabilidade, decisões e limitações. Checklist da skill passado.
- [ ] `ARCHITECTURE.md`: ORM e mapeamento do Money, estratégia transacional e de lock, idempotência e algoritmo de hash, máquina de estados, taxonomia de `failureCode`, mapeamento HTTP, inbox/outbox, worker de referências (limites justificados), interpretações de regras ambíguas, autenticação, limitações conhecidas e o que faria com mais tempo.
