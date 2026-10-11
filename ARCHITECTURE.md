# Arquitetura

Este documento explica **por que** o sistema é como é. Para **como rodar**, veja o `README.md`. Para o detalhe técnico completo (schema, contratos, fluxos), veja `docs/TECH_SPEC.md`.

## Em uma frase

Cada operação de aposta trava a linha da wallet no PostgreSQL, aplica a regra, grava a transação, o lançamento no ledger e o evento na outbox na mesma transação SQL, e só depois confirma o recebimento — então nada é duplicado, nada fica pela metade e qualquer número de instâncias pode rodar ao mesmo tempo.

## Princípios

1. **O banco é o juiz.** Toda garantia importante (unicidade, saldo não negativo, ledger imutável) existe como constraint ou trigger, não só em código.
2. **Uma transação SQL por operação.** Saldo, ledger, inbox e outbox são confirmados juntos ou não são confirmados.
3. **Correção antes de vazão.** Quando as duas competem, escolhemos a correção e documentamos o custo.
4. **Mensageria é otimização.** O SQS FIFO ajuda, mas o sistema continua correto se ele duplicar ou reordenar mensagens.

## Decisões

Cada decisão segue o formato: o problema, o que escolhemos, o que descartamos e o que isso custa.

### ADR-001 — Uma transação só pode ser compensada uma vez

**Problema.** A regra 4 do enunciado proíbe reverter a mesma transação duas vezes "pelo mesmo tipo". Lida ao pé da letra, uma `BET` de 50,00 aceitaria um `REFUND` e um `ROLLBACK`, devolvendo 100,00 ao jogador — o que viola o invariante de não duplicar créditos.

**Decisão.** `REFUND` e `ROLLBACK` são mutuamente exclusivos sobre a mesma referência. A segunda compensação é rejeitada com `REFERENCE_ALREADY_REVERSED`. Um `ROLLBACK` de um `REFUND` continua permitido. O banco garante isso com um índice único parcial em `reference_transaction_id`.

**Descartado.** A leitura literal (crédito em dobro) e um estado de compensação que "reabre" quando a compensação é desfeita (mais estado e mais testes para um caso raro).

**Custo.** Depois de `BET → REFUND → ROLLBACK do REFUND`, a `BET` não pode ser compensada de novo.

### ADR-002 — Wallet inexistente vira rejeição gravada

**Problema.** Sem wallet não há linha para travar nem chave estrangeira para gravar a transação.

**Decisão.** A transação é gravada como `REJECTED` com `WALLET_NOT_FOUND` e a API responde `422`. A coluna `wallet_id` pode ficar nula apenas nesse caso; o valor enviado fica em `requested_wallet_id`.

**Descartado.** Rejeitar sem gravar. Seria mais simples, mas a rejeição não ficaria auditável e, se a wallet fosse criada depois, a mesma chave de idempotência passaria a ser processada — contradizendo a resposta que o provedor já recebeu.

**Custo.** Uma coluna anulável com uma regra específica no schema.

### ADR-003 — Valores com exatamente duas casas decimais

**Problema.** O contrato diz que o valor é recebido com escala fixa de duas casas, mas não diz o que fazer com `"25"`.

**Decisão.** Só aceitamos `"25.00"`. `"25"`, `"25.5"`, números JSON e qualquer outra forma são rejeitados como payload inválido.

**Descartado.** Aceitar e normalizar. Abriria a dúvida de se `"25"` e `"25.00"` são o mesmo payload para a idempotência.

**Custo.** Provedores precisam enviar o formato exato.

### ADR-004 — Referências ausentes esperam até 24 horas

**Problema.** Um `REFUND` pode chegar antes da `BET` que ele reverte.

**Decisão.** A transação fica em `PENDING_REFERENCE`. Um worker tenta de novo com espera crescente (até 5 minutos entre tentativas) por até 24 horas, contadas do recebimento. Ao vencer o prazo, faz uma última tentativa e só então rejeita com `REFERENCE_NOT_FOUND`. Quando a referência chega, as pendentes que dependem dela são reprocessadas na hora.

**Descartado.** Limite por número de tentativas: se o worker ficar fora do ar, o limite perde o sentido. Prazo de 1 hora: rejeitaria referências que ficaram presas na DLQ durante um incidente.

**Custo.** O provedor pode esperar até 24 horas por uma resposta final no pior caso. Nada fica travado nesse tempo.

### ADR-005 — Lock pessimista por wallet

**Problema.** Duas apostas na mesma wallet ao mesmo tempo não podem gastar o mesmo saldo.

**Decisão.** Cada operação faz `SELECT ... FOR UPDATE` na wallet antes de ler ou decidir qualquer coisa, com `lock_timeout` de 2 segundos. O update de saldo ainda confere a versão, e um `CHECK` impede saldo negativo.

**Descartado.** Lock otimista com retry: numa wallet muito disputada, gera uma tempestade de retentativas. Lock global: proibido pelo enunciado e desnecessário.

**Custo.** Operações da mesma wallet são processadas uma de cada vez. Wallets diferentes seguem em paralelo.

### ADR-006 — Dinheiro em centavos inteiros

**Decisão.** `Money` guarda o valor como `bigint` em centavos. No banco, `NUMERIC(20,2)`, lido pelo driver como texto — nunca como número de ponto flutuante.

**Descartado.** Bibliotecas de decimal: funcionam, mas acrescentam dependência sem ganho para escala fixa de duas casas.

### ADR-007 — MikroORM com persistência SQL-first e mappers

**Contexto.** O enunciado pede MikroORM (preferencial) e a justificativa do mapeamento de `Money` e da estratégia transacional (§4, §14).

**Decisão.** Usamos o MikroORM para o pool de conexões, `em.transactional()` (BEGIN/COMMIT) e migrations versionadas; **as operações financeiras usam SQL explícito** pelo `EntityManager` (`getConnection().execute(..., em.getTransactionContext())`), encapsulado em `SqlSession`/`SqlUnitOfWork`. Não há entidades `EntitySchema` (`entities: []`); cada linha lida vira agregado de domínio por um **mapper** com a factory `rehydrate`, e o domínio não conhece o ORM.

**Por quê SQL em vez de Unit of Work + `LockMode`.** A correção depende de construções que o SQL expressa de forma direta e auditável, e que o identity map/flush do ORM tornaria implícitas ou disputaria: `SELECT ... FOR UPDATE` (ADR-005), `UPDATE ... WHERE version = $v` condicionado, `INSERT ... ON CONFLICT DO NOTHING`, `FOR UPDATE SKIP LOCKED` (outbox e worker de referência) e `SET LOCAL lock_timeout`. Manter o unit of work junto arriscaria *flushes* fora de ordem e leituras do identity map em vez do banco. O lock pessimista é feito com `FOR UPDATE` (equivalente ao `LockMode.PESSIMISTIC_WRITE`), só que explicitamente no SQL da transação.

**Money.** Coluna `NUMERIC(20,2)` lida como string pelo driver `pg` e convertida para `bigint` (centavos) por um custom type do MikroORM (`MoneyAmountType`) — nunca por ponto flutuante (ADR-006). Nos mappers o par (amount, currency) reidrata em `Money`.

**Custo.** Um mapper por agregado e SQL escrito à mão (parametrizado) em vez de query builder. Em troca, o caminho financeiro fica explícito e testável contra o Postgres real. Registrado como refinamento na §15 da tech spec.

### ADR-008 — Hash do payload

**Decisão.** SHA-256 de um JSON canônico (chaves ordenadas) com só os campos de negócio, prefixado com `v1:` para permitir trocar o algoritmo no futuro. Header e metadados de transporte não entram.

### ADR-009 — Outbox com lease

**Decisão.** Cada instância reserva um lote de eventos com `FOR UPDATE SKIP LOCKED` e um prazo de posse de 30 segundos, publica fora da transação e marca como publicado. Se a instância morrer, o prazo expira e outra publica. Eventos nunca são descartados.

**Custo.** Um evento pode ser publicado mais de uma vez. Todos levam `eventId` estável para o consumidor deduplicar.

### ADR-010 — Três tipos de erro no consumidor SQS

**Decisão.** Erro de negócio confirma a mensagem (ack). Erro transitório (PostgreSQL **ou** transporte do SQS: throttling, timeout, conexão) devolve a mensagem com espera crescente. Erro permanente vai direto para a DLQ. O `ack` (DeleteMessage) é uma etapa separada do processamento: se falhar depois do commit, a mensagem só reaparece e a inbox deduplica — nunca vira DLQ. Toda operação de transporte é protegida para uma falha de rede não derrubar o loop de consumo.

**Redrive explícito.** Ao atingir `maxReceiveCount` recebimentos de um erro transitório, o consumidor **move a mensagem para a DLQ explicitamente**, em vez de confiar no redrive automático do broker — o emulador MiniStack não o implementa de forma confiável (ADR-013). Com o SQS real, os dois caminhos coexistem sem efeito duplicado (a mensagem é deletada da fila de entrada ao ser movida).

### ADR-011 — Autenticação por IdP externo, opcional via flag

**Contexto.** Vale 0 ponto (§14) e o enunciado aceita documentar o desenho sem implementar. Começou como ponto de extensão (ADR original); reaberta a pedido do humano para entregar a versão funcional.

**Decisão.** `AuthGuard` global controlado por `AUTH_ENABLED`. Com `false` (padrão) é no-op e só anexa a identidade do payload — os testes e o fluxo normal não passam por token. Com `true`, exige um JWT Bearer validado contra o **JWKS do IdP** (Keycloak em `docker-compose.auth.yml`, client-credentials por provedor): verifica assinatura RS256, `iss`, `aud` (quando configurada) e expiração, e compara o claim `azp` do token com o `providerId` do payload — mismatch é `403`, token ausente/ inválido é `401`. Health e métricas ficam sempre abertos. Nunca há tabela de usuário própria; a confiança vem do IdP.

**Por quê assim.** O IdP externo é o que o enunciado pede (§2); a flag mantém o núcleo financeiro e a suíte desacoplados de um container de auth, e o guard testado contra um JWKS controlado (par de chaves local) prova a lógica sem depender do Keycloak subir. O claim `azp` identifica o client (provedor) que obteve o token no grant client-credentials.

**Custo.** Uma dependência (`jose`) e um compose opcional de Keycloak; a validação de JWT adiciona uma ida ao JWKS (cacheado). Mensagens da fila seguem como canal interno confiável, mas o `providerId` da mensagem continua sob as validações de domínio.

### ADR-012 — Identificadores UUIDv7

**Decisão.** UUIDv7 em todas as entidades: ordenáveis no tempo e bons para índice. A paginação do ledger usa uma sequência própria (`seq`), escondida num cursor opaco.

### ADR-013 — MiniStack como emulador de SQS padrão

**Problema.** Desde março de 2026, as versões recentes do LocalStack exigem conta e token de autenticação, inclusive em CI.

**Decisão.** O `docker-compose.yml` usa o MiniStack, que o enunciado também aceita e roda sem conta. As filas são criadas por um container `aws-cli` separado, que funciona com qualquer emulador. Trocar para o LocalStack é só definir `SQS_EMULATOR_IMAGE` e `LOCALSTACK_AUTH_TOKEN`.

**Descartado.** Fixar uma versão antiga do LocalStack: congela o projeto numa imagem sem atualizações.

**Custo.** O MiniStack precisa provar, no M8, que suporta `ApproximateReceiveCount` e o redrive para a DLQ como o SQS real. Se não suportar, voltamos ao LocalStack com token gratuito.

## Limitações conhecidas

- Uma `BET` compensada e depois "descompensada" não pode ser compensada de novo (ADR-001).
- Repetir `POST /wallets` devolve `409`; não há chave de idempotência para criação de wallet.
- O throughput de uma única wallet é limitado pela latência de uma transação SQL (ADR-005).
- `/metrics` não exige autenticação; assume rede interna.

## O que faríamos com mais tempo

- **503 limpo quando o Postgres congela.** Hoje, com `docker pause` no banco, uma requisição HTTP
  fica pendurada até o `unpause` (a conexão TCP congela; nem `statement_timeout`, que é do servidor,
  nem o lock ajudam). Um `query_timeout` **do lado do cliente** (pg) converteria isso num erro
  transitório → `503 INFRA_UNAVAILABLE` imediato. Não foi ligado por padrão para não arriscar abortar
  operações legítimas sob contenção; precisa de um valor acima do `lock_timeout` e de testes.
- **Confirmar `ApproximateReceiveCount` e redrive no MiniStack** contra o SQS real (ADR-013); se
  divergir, voltar ao LocalStack com token.
- **Protocolo de carga completo** (120 s × 3 repetições por degrau, nos quatro cenários) e um SQS
  real para medir a vazão de publicação sem o teto do emulador.
- **Partição do worker de referência** por faixa de hash para reduzir contenção de claim em escala.
- **OpenTelemetry/tracing** ponta a ponta (descartado pelo humano neste desafio).

## Resultados medidos

Execução curta e ilustrativa do cenário `distributed` (3 instâncias, 100 req/s, 8 s medidos, mesmo
host): p50 ~5 ms, p95 ~7 ms, p99 ~10 ms, **zero conflitos de lock**, correção 100% (reconciliação
consistente, nenhum duplicado, outbox drenada). O gargalo observado é a **publicação da outbox para
o emulador de SQS** (`outbox_lag_seconds` sobe a ~7 s na rajada e drena depois), não o banco nem o
lock. Detalhes, metodologia e limitações em [docs/LOAD_TEST.md](docs/LOAD_TEST.md).
