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

### ADR-007 — MikroORM com modelos de persistência separados

**Decisão.** MikroORM (preferência do enunciado, com `transactional()` e `LockMode` explícitos). As classes de domínio não conhecem o ORM: entidades de persistência ficam na infraestrutura e são convertidas pela factory `rehydrate`.

**Custo.** Um mapper por agregado.

### ADR-008 — Hash do payload

**Decisão.** SHA-256 de um JSON canônico (chaves ordenadas) com só os campos de negócio, prefixado com `v1:` para permitir trocar o algoritmo no futuro. Header e metadados de transporte não entram.

### ADR-009 — Outbox com lease

**Decisão.** Cada instância reserva um lote de eventos com `FOR UPDATE SKIP LOCKED` e um prazo de posse de 30 segundos, publica fora da transação e marca como publicado. Se a instância morrer, o prazo expira e outra publica. Eventos nunca são descartados.

**Custo.** Um evento pode ser publicado mais de uma vez. Todos levam `eventId` estável para o consumidor deduplicar.

### ADR-010 — Três tipos de erro no consumidor SQS

**Decisão.** Erro de negócio confirma a mensagem. Erro transitório devolve a mensagem com espera crescente. Erro permanente vai direto para a DLQ. Depois de 5 recebimentos, o redrive do SQS leva a mensagem para a DLQ.

### ADR-011 — Autenticação como ponto de extensão

**Decisão.** Não implementada (não vale pontos no desafio). Existe um `AuthGuard` que hoje deixa tudo passar e uma porta `ProviderIdentityPort`. O desenho alvo é Keycloak com credenciais por provedor, validação de JWT e comparação do provedor do token com o `providerId` do payload.

### ADR-012 — Identificadores UUIDv7

**Decisão.** UUIDv7 em todas as entidades: ordenáveis no tempo e bons para índice. A paginação do ledger usa uma sequência própria (`seq`), escondida num cursor opaco.

## Limitações conhecidas

- Uma `BET` compensada e depois "descompensada" não pode ser compensada de novo (ADR-001).
- Repetir `POST /wallets` devolve `409`; não há chave de idempotência para criação de wallet.
- O throughput de uma única wallet é limitado pela latência de uma transação SQL (ADR-005).
- `/metrics` não exige autenticação; assume rede interna.

## O que faríamos com mais tempo

_A completar ao fim da implementação._

## Resultados medidos

_A completar com os números do teste de carga, se ele for feito._
