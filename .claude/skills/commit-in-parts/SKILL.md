---
name: commit-in-parts
description: Use sempre que for commitar. Divide o trabalho em commits pequenos, cada um com uma única intenção, que compilam e passam nos testes, com mensagem Conventional Commits descritiva e a task do TASKS.md no rodapé.
---

# Commits em partes

O histórico é parte da entrega: o avaliador pode ler o `git log` para entender como a solução foi construída. Cada commit conta um passo, com uma intenção, e explica por que ele existe.

## Regras

1. **Uma intenção por commit.** Se a mensagem precisa de "e" para descrever o que mudou, são dois commits.
2. **Todo commit compila e passa nos testes.** Rode `bun run typecheck` e os testes afetados antes de cada commit. O histórico precisa funcionar com `git bisect`.
3. **Teste vai junto com o código que ele testa.** Não existe commit "adiciona testes" separado do comportamento, exceto quando o teste vem antes (teste que falha + implementação logo em seguida, em dois commits, os dois verdes nos testes que já existiam).
4. **Documentação vai no mesmo commit da mudança que a desatualizou** (regra da skill `project-docs`).
5. **Nunca misture** refatoração com mudança de comportamento, nem formatação com lógica. Faça a refatoração primeiro, em commit próprio.
6. **Tamanho:** mire em até ~300 linhas alteradas, sem contar lockfile e migrations geradas. Passou disso, procure o corte.
7. **Marque a task.** O commit que conclui uma task também marca `[x]` no `TASKS.md`.
8. **Nunca commite** `.env`, segredos, arquivos gerados de build, `console.log` de depuração ou código comentado.
9. **Nunca use** `--no-verify`, nunca reescreva commits já enviados ao remoto, nunca faça `git add .` sem revisar o diff.

## Formato da mensagem

```
<tipo>(<escopo>): <o que muda, no imperativo, até 72 caracteres>

<Por que a mudança existe e qual decisão ela implementa. 1 a 4 linhas,
quebradas em 72 colunas. Diga o efeito observável, não repita o diff.>

Refs: T<task>[, ADR-<n>]
```

- **Tipo:** `feat`, `fix`, `test`, `refactor`, `docs`, `build`, `ci`, `chore`, `perf`.
- **Escopo** (um só): `money`, `wallet`, `ledger`, `wagering`, `idempotency`, `references`, `outbox`, `inbox`, `sqs`, `workers`, `schema`, `api`, `obs`, `health`, `auth`, `config`, `infra`, `test-support`, `docs`.
- **Assunto:** em português, imperativo, minúsculo, sem ponto final. Diz o que muda, não o que você fez ("rejeita aposta sem saldo", não "implementei validação").
- **Corpo:** obrigatório, exceto em mudanças triviais (`chore`, typo). Explica o porquê e cita a decisão quando houver.
- **Rodapé:** `Refs:` com o ID da task do `TASKS.md` e, quando aplicável, o ADR.

## Como dividir

1. Antes de commitar, rode `git status` e `git diff` e liste as intenções que existem ali.
2. Para cada intenção, na ordem em que uma depende da outra:
   - adicione só os arquivos ou trechos dela (`git add <arquivo>` ou `git add -p`);
   - confira com `git diff --staged` que nada de outra intenção entrou;
   - rode typecheck e os testes afetados com o resto ainda fora do stage (use `git stash --keep-index` se precisar provar que o commit funciona sozinho);
   - escreva a mensagem e commite.
3. No fim, `git log --oneline -n <k>` deve contar a história da task, um passo por linha.

Ordem típica dentro de uma task: migration → domínio (com testes unitários) → persistência/mapper → caso de uso → borda (HTTP/SQS) → teste de integração ou concorrência → docs. Junte etapas pequenas quando separar não ajudar quem lê.

## Exemplos

Bom — task T5.3 em quatro commits:

```
feat(wagering): trava a wallet antes de checar idempotência

Toda leitura que decide algo acontece depois do SELECT ... FOR UPDATE,
então requisições duplicadas para a mesma wallet são serializadas pelo
PostgreSQL e a segunda vê a transação da primeira.

Refs: T5.3, ADR-005
```

```
feat(wagering): aplica BET, WIN e LOSS no agregado Wallet

LOSS é gravada como PROCESSED sem lançamento e sem mudar a versão
da wallet; BET sem saldo vira REJECTED com INSUFFICIENT_FUNDS.

Refs: T5.3
```

```
feat(wagering): grava snapshot do saldo para replay exato

O replay é montado só a partir da linha persistida, devolvendo o
saldo observado no momento original (regra 7 do enunciado).

Refs: T5.3
```

```
feat(outbox): enfileira eventos da transação na mesma transação SQL

WagerTransactionProcessed/Rejected sempre; WalletBalanceChanged só
quando houve lançamento no ledger.

Refs: T5.3
```

Ruim:

```
wip
ajustes
feat: implementa transações, outbox, testes e corrige lint
fix: corrige bug
```

## Checklist antes de cada commit

- [ ] Uma intenção só; o assunto não precisa de "e".
- [ ] `bun run typecheck` e os testes afetados passam com apenas o que está no stage.
- [ ] Docs atualizadas, se a mudança as desatualizou.
- [ ] Mensagem no formato acima, com corpo e `Refs:`.
- [ ] `TASKS.md` marcado, se a task terminou aqui.
- [ ] Nenhum segredo, arquivo gerado ou código de depuração no diff.
