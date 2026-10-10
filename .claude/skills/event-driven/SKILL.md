---
name: event-driven
description: Use ao criar ou mudar eventos de integração, outbox, inbox, consumidor ou publicador SQS. Define como mensagens entram e saem do sistema com entrega at-least-once, sem dual write e sem depender de ordem.
---

# Arquitetura orientada a eventos neste projeto

O sistema conversa com o mundo por mensagens que podem chegar duplicadas, fora de ordem ou nunca, e por eventos que publicamos para outros sistemas. A regra que guia tudo: **o banco decide, a mensageria transporta.**

## Entrada: comandos

A mensagem `WagerTransactionRequested` da fila `wager-transactions.fifo` é, na prática, um **comando** (um pedido para fazer algo), embora o nome esteja no passado por contrato do enunciado. Tratamento:

- o consumidor valida o envelope e chama o **mesmo** caso de uso do HTTP; não existe regra de negócio no consumidor;
- a inbox (`consumer_name`, `message_id`) é gravada **na mesma transação SQL** do efeito financeiro: se a transação confirma, a mensagem está marcada como processada; se não, nada aconteceu;
- o ack (`DeleteMessage`) acontece **depois** do commit, nunca dentro dele;
- a deduplicação de negócio é a idempotency key; a inbox só evita reprocessar a mesma mensagem.

## Saída: eventos de integração

Publicados em `wagering-events.fifo` **somente** pela outbox (spec §6.5).

- **Sem dual write.** Nunca gravar no banco e publicar no SQS no mesmo fluxo. O caso de uso só grava a linha na outbox; o publisher envia depois do commit.
- **Nome no passado e com significado de negócio:** `WagerTransactionProcessed`, `WalletBalanceChanged`. Um evento descreve um fato, não pede uma ação.
- **`eventType` e `version` no tipo**, uma subclasse por evento, factory `from(...)`. Nada de strings soltas no ponto de chamada.
- **`data` só com tipos JSON.** Dinheiro como `MoneyProps` (`{"amount":"25.00","currency":"BRL"}`), datas em ISO-8601. Nunca `Money`, `bigint` ou `Date`.
- **Conteúdo:** identificadores, valores e o estado resultante relevante (por exemplo `balanceAfter`), o suficiente para o consumidor não precisar nos consultar. Nada de dados sensíveis além do necessário.
- **Rastreabilidade:** todo evento carrega `correlationId` (da requisição ou mensagem de origem) e `causationId` (o que o causou). Não gere um `correlationId` novo no meio do fluxo.
- **Quando emitir:** a tabela da spec §8.3 é a fonte. Não emita evento para mudança sem valor para um consumidor.

## Garantias e o que elas significam

| Garantia | Como | Consequência para quem consome |
|---|---|---|
| Nenhum evento confirmado se perde | outbox na mesma transação + publisher sem limite de tentativas | pode atrasar, nunca some |
| Nenhum evento sai antes do commit | só o publisher envia, lendo linhas confirmadas | — |
| At-least-once | lease expira e outra instância republica | deduplique por `eventId` |
| Ordem por wallet é tentativa, não garantia | `MessageGroupId = aggregateId` | não dependa de ordem; use `walletVersion` |

## Evolução de contrato

- Adicionar campo opcional: mesma `version`.
- Remover, renomear ou mudar o significado de um campo: nova `version` (nova subclasse); o contrato antigo segue até não haver consumidores.
- Um teste de snapshot do `toJSON()` de cada evento trava o contrato. Mudar o snapshot é uma decisão, não um ajuste.

## Testes que provam esta arquitetura

- linha na outbox gravada na mesma transação do efeito (I2);
- nada publicado no SQS se a transação faz rollback;
- mensagem repetida → um efeito (I6); crash entre commit e ack → um efeito (C5);
- dois publishers → todo evento publicado, duplicatas com o mesmo `eventId` (C6);
- SQS fora do ar → outbox acumula e drena (I11).

## Anti-padrões

- Publicar no SQS dentro de `em.transactional()` ou antes dele.
- Consumidor com regra de negócio própria, diferente do HTTP.
- Ack antes do commit "para não segurar a mensagem".
- Confiar na deduplicação ou ordem do SQS FIFO para corrigir duplicidade.
- Evento como chamada remota disfarçada ("ProcessThis", "PleaseUpdate").
- Payload com objetos de domínio serializados diretamente.

## Checklist

- [ ] Nenhum caminho envia mensagem antes do commit.
- [ ] Toda entrada passa pela inbox e pelo mesmo caso de uso do HTTP.
- [ ] Todo evento novo tem subclasse, `version`, snapshot e linha na tabela da spec §8.3.
- [ ] `correlationId` e `causationId` propagados do início ao fim.
