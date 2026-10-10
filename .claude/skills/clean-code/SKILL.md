---
name: clean-code
description: Use ao escrever ou revisar qualquer código TypeScript ou teste deste projeto. Define convenções de nomes, funções, tipos, erros, comentários, organização de arquivos e testes, com o critério de que outra pessoa entenda o código sem precisar perguntar.
---

# Clean code neste projeto

O avaliador vai ler o código. Escreva para que ele entenda cada arquivo na primeira leitura. Simplicidade conta pontos: o código mais claro que prova a garantia vence o mais engenhoso.

## Idioma

- Código, nomes, testes e mensagens de log: **inglês**.
- Documentação, commits e mensagens ao humano: **português**.

## Nomes

- Use a linguagem ubíqua da skill `ddd-modeling`. Um conceito, um nome, em todo o código.
- Nomes dizem intenção: `lockWalletForUpdate`, não `getWallet2`; `remainingAttempts`, não `n`.
- Booleanos com `is`, `has`, `can`, `should`: `isTerminal()`, `hasReference`.
- Unidade no nome quando há unidade: `lockTimeoutMs`, `visibilityTimeoutSeconds`.
- Sem abreviações fora das consagradas (`id`, `url`, `sqs`, `db`).
- Classes são substantivos; métodos são verbos. Nada de `Manager`, `Helper`, `Utils`, `Data`, `Info`.

## Funções e métodos

- Uma responsabilidade e um nível de abstração por função. Se precisa de um comentário dizendo "agora faz X", X é outra função.
- Retorno antecipado em vez de `if` aninhado.
- No máximo 3 parâmetros posicionais; acima disso, um objeto nomeado.
- Sem parâmetro booleano que muda o comportamento (`process(tx, true)`): crie dois métodos.
- Funções puras sempre que possível; I/O nas bordas.

## Tipos

- `strict` sem exceção. Proibidos em código de domínio e aplicação: `any`, `as unknown as`, `@ts-ignore`, `!` sem justificativa em comentário.
- Resultado de caso de uso é uma **união discriminada**, não exceção:

```ts
type SubmitResult =
  | { kind: "processed"; transaction: WagerTransactionView; replay: boolean }
  | { kind: "rejected"; transaction: WagerTransactionView; replay: boolean }
  | { kind: "pending_reference"; transaction: WagerTransactionView; replay: boolean }
  | { kind: "idempotency_conflict"; code: "IDEMPOTENCY_KEY_CONFLICT" | "DUPLICATE_EXTERNAL_TRANSACTION" };
```

  A borda (controller ou consumer) faz o `switch` exaustivo (com `never` no `default`) e mapeia para HTTP ou ack.
- `readonly` por padrão em propriedades e arrays de entrada. Não mute argumentos.
- Enums de domínio como `as const` + tipo derivado, ou `enum` de string; nunca enum numérico.

## Erros

- Erros são classes tipadas, nunca `throw new Error("texto")` no domínio.
- Três categorias, e cada uma tem um destino: regra de negócio (vira `REJECTED`), transitório (vira 503 ou retry), invariante/bug (vira 500 e log `error`).
- Nunca engula um erro (`catch {}`). Se tratar, trate de verdade; se não, deixe subir.
- O mapeamento para HTTP mora num lugar só (filtro global); controllers não montam respostas de erro à mão.

## Comentários

- Comente o **porquê**, nunca o quê. "Lock antes da leitura: garante que duplicatas vejam a primeira gravação (ADR-005)" é bom; "busca a wallet" é ruído.
- Cite ADR ou seção da spec quando a decisão não é óbvia.
- Sem código comentado, sem `TODO` sem task correspondente no `TASKS.md`.

## Organização

- Um conceito por arquivo; nome do arquivo em `kebab-case` igual ao conceito (`wallet-ledger-entry.ts`).
- Sem barrel files (`index.ts` reexportando): escondem dependências e criam ciclos.
- Dependências entram pelo construtor (injeção do Nest na infra; portas no domínio e na aplicação). Sem singletons globais nem `new` de infraestrutura dentro de regra.
- Sem números mágicos: limites e prazos vêm da config (spec §11) ou de constantes nomeadas.
- Prettier formata; ninguém discute formatação em revisão.

## Logs

- Estruturados: `logger.info({ transactionId, status }, "wager transaction processed")`. Mensagem fixa, dados nos campos. Nunca interpolar valores na string.
- Nada de valores monetários, payload completo ou headers de autenticação (spec §10).

## Testes

- Nome descreve o comportamento: `rejects second compensation of the same bet`, não `test refund 2`.
- Estrutura arrange / act / assert, uma razão para falhar por teste.
- Dados de teste por builders com padrões sensatos (`aWallet().withBalance("100.00")`), só os campos relevantes ao cenário aparecem no teste.
- Asserções de dinheiro comparam strings ou `Money`, nunca `number`.
- Sem `sleep` fixo, sem dependência de ordem entre testes, sem estado compartilhado entre arquivos.

## Checklist de revisão

- [ ] Alguém sem contexto entende cada função lendo só o nome e as primeiras linhas.
- [ ] Nenhuma função faz duas coisas; nenhum arquivo mistura camadas.
- [ ] Nenhum `any`, `@ts-ignore`, `catch {}`, código comentado ou número mágico.
- [ ] Toda união discriminada tem `switch` exaustivo.
- [ ] Comentários explicam porquês; nenhum repete o código.
- [ ] Simples o bastante: dá para remover algo sem perder garantia? Remova.
