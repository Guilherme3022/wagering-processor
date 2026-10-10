---
name: ddd-modeling
description: Use ao criar ou mudar código em src/**/domain ou src/**/application — agregados, value objects, serviços de domínio, casos de uso, repositórios e erros de domínio. Define como o DDD tático se aplica a este projeto e o que evitar.
---

# DDD neste projeto

DDD aqui é tático e enxuto: o objetivo é que as invariantes financeiras morem nas classes de domínio e sejam impossíveis de contornar, não acumular padrões. Se um padrão não protege uma regra, ele não entra.

## Linguagem ubíqua

O código usa estes termos em inglês; a documentação usa os termos em português. Não invente sinônimos.

| Código | Documentação | Significado |
|---|---|---|
| `Wallet` | wallet | saldo de um player numa moeda |
| `WalletLedgerEntry` | lançamento | registro imutável de uma mudança de saldo |
| `WagerTransaction` | transação | operação de aposta vinda de um provedor |
| `kind` | tipo | `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`, `OPENING` |
| `reference` | referência | a transação que um `REFUND`/`ROLLBACK`/`WIN`/`LOSS` aponta |
| `compensation` | compensação | `REFUND` ou `ROLLBACK` que desfaz uma referência (ADR-001) |
| `replay` | replay | resposta de uma requisição repetida, montada do que foi gravado |
| `idempotencyKey` | chave de idempotência | identidade de uma requisição |
| `payloadHash` | hash do payload | impressão digital do conteúdo de negócio |
| `failureCode` | código de falha | motivo estável de rejeição |

## Contextos

| Contexto | Responsável por | Não sabe sobre |
|---|---|---|
| `wallet` | saldo, versão, lançamentos, reconciliação | provedores, rodadas, SQS |
| `wagering` | transações, regras por tipo, referências, idempotência | como o saldo é persistido |
| `messaging` | inbox, outbox, envelope de eventos | regras de negócio |
| `shared` | `Money`, erros base, `Clock`, `IdGenerator` | qualquer contexto |

`wagering` usa `wallet` pelo agregado `Wallet` (dentro da mesma transação SQL). `wallet` nunca importa `wagering`.

## Blocos de construção

**Value objects** — imutáveis, comparados por valor, validam na criação. Use quando há regra: `Money`, `PayloadHash`, `IdempotencyKey`, `LedgerCursor`. Não embrulhe todo `string` (um `roundId` sem regra é só `string`).

**Entidades e agregados** — construtor `private`, factories estáticas que validam (`create`, `open`, `from`) e `rehydrate` que só reconstrói. Estado mutável é `private _campo` com getter. Mudanças só por métodos com nome de negócio.

- `Wallet` é o agregado que protege saldo e versão. `debit`, `credit` e `reverse` **retornam** o `WalletLedgerEntry`: não existe caminho para mudar o saldo sem produzir o lançamento.
- `WagerTransaction` é o agregado da operação, com a máquina de estados da spec §3.4.
- `WalletLedgerEntry` é imutável e valida a própria aritmética.

```ts
// bom: a regra mora no agregado e o retorno torna o lançamento obrigatório
const entry = wallet.debit(money, transaction.id, clock.now());

// ruim: regra no caso de uso, agregado anêmico
if (wallet.balance.isLessThan(money)) throw ...;
wallet.balance = wallet.balance.subtract(money);
```

**Fronteira de consistência.** A regra clássica "um agregado por transação" é quebrada aqui de propósito: `Wallet` e `WagerTransaction` mudam na mesma transação SQL, porque o enunciado exige atomicidade entre saldo, ledger, transação e outbox. Isso está registrado; não "conserte" com consistência eventual.

**Serviços de domínio** — só para regras que envolvem mais de um agregado e não pertencem a nenhum: `ReferencePolicy` (valida uma transação contra a referência e a wallet, na ordem da spec §3.4). Sem estado, sem I/O.

**Casos de uso (application)** — orquestram: abrem a transação, travam, carregam, chamam o domínio, persistem, enfileiram eventos. **Não contêm regra de negócio.** Se um `if` no caso de uso decide algo sobre dinheiro ou estado, ele pertence ao domínio.

**Repositórios** — uma interface (porta) por agregado em `application`, implementada em `infra`. Métodos com intenção (`lockById`, `findByIdempotencyKey`), nunca genéricos (`findOne(where)`). Repositório não decide regra.

**Erros de domínio** — classes com `failureCode` (`InsufficientFundsError`, `CurrencyMismatchError`). O caso de uso converte erro de regra de negócio em transação `REJECTED`; erros de invariante (`InvalidTransactionStateError`) são bugs e sobem como 500.

## Eventos

Não há domain events separados: os agregados devolvem o que aconteceu (o lançamento, o novo estado) e o caso de uso monta os integration events a partir disso. Um segundo tipo de evento só entraria se houvesse um consumidor interno, e não há. Detalhes na skill `event-driven`.

## Anti-padrões

- Setters públicos ou propriedades mutáveis em entidades.
- Domínio importando NestJS, MikroORM, AWS SDK ou pino (o lint barra).
- Regra de negócio em controller, consumer, repositório ou mapper.
- `rehydrate` validando transições, ou `create` usado para reconstruir do banco.
- Entidade do ORM usada como entidade de domínio.
- Classes "Manager", "Helper", "Utils" — dê nome de negócio ou mova a função para onde ela pertence.

## Checklist

- [ ] Toda invariante da spec que cabe numa classe está nela, e não no caso de uso.
- [ ] Não existe forma de mudar saldo sem gerar lançamento.
- [ ] Construtores privados; factories validam; `rehydrate` não valida.
- [ ] Nomes seguem a linguagem ubíqua.
- [ ] O domínio é testável sem banco, sem Nest e sem rede.
