---
name: wagering-processor
description: Use ao iniciar, continuar ou revisar qualquer trabalho de implementação do Distributed Wagering Processor. Define a rotina de sessão, o ciclo por task do TASKS.md, os portões de fim de marco, quando parar e perguntar ao humano e onde está cada decisão.
---

# Implementar o Distributed Wagering Processor

Esta skill é o ponto de entrada do trabalho. Ela não substitui os documentos do projeto; diz **em que ordem** usá-los e **como** avançar sem perder correção.

| Documento | Para quê |
|---|---|
| `docs/CHALLENGE.md` | O que foi pedido (fonte da verdade) |
| `docs/TECH_SPEC.md` | Como construir: DDL, contratos, fluxos, testes |
| `AGENTS.md` | Regras, decisões fechadas, falhas eliminatórias |
| `TASKS.md` | O que fazer agora |
| skill `ddd-modeling` | Como modelar domínio e casos de uso |
| skill `event-driven` | Como tratar mensagens, inbox, outbox e eventos |
| skill `clean-code` | Como escrever e revisar código e testes |
| skill `commit-in-parts` | Como commitar |
| skill `project-docs` | Como documentar |

Precedência em conflito: enunciado → spec → AGENTS. Decisões ADR-001 a ADR-004 são do humano e não se reabrem.

## 1. Início de toda sessão

1. Leia `AGENTS.md` §2 (falhas eliminatórias) e §13 (regras de trabalho). Na primeira sessão, leia o arquivo inteiro e a spec inteira.
2. Abra `TASKS.md` e encontre a task `[~]` em andamento; se não houver, a primeira `[ ]`.
3. Rode `git status` e `git log --oneline -n 10` para saber onde o trabalho parou. Mudanças não commitadas de uma sessão anterior: revise antes de continuar, nunca descarte sem entender.
4. Suba a infraestrutura (`docker compose up -d`) e rode `bun run lint && bun run typecheck && bun test` para ter a linha de base. Se algo já está vermelho, consertar isso é a primeira coisa — antes de qualquer task nova.

## 2. Ciclo de cada task

1. **Entenda.** Leia a task e a seção da spec que ela cita. Se a task depende de algo que ainda não existe, a ordem do `TASKS.md` está errada ou você pulou uma task: volte.
2. **Planeje em poucas linhas.** Arquivos que vai criar ou mudar, migrations, testes. Se o plano passa de ~10 arquivos, a task está grande: divida em subtasks no `TASKS.md` (T5.3a, T5.3b).
3. **Marque `[~]`** na task.
4. **Teste primeiro** quando a task protege uma invariante financeira, de concorrência ou de idempotência: escreva o teste que falharia sem a garantia e veja ele falhar.
5. **Implemente o mínimo** que faz o teste passar e respeita a spec. Nomes, códigos de falha, status HTTP, eventos e métricas vêm da spec, sem variantes. Siga `clean-code` sempre; `ddd-modeling` ao tocar `domain`/`application`; `event-driven` ao tocar mensagens, inbox, outbox ou eventos.
6. **Verifique:** `bun run lint`, `bun run typecheck` e os testes afetados. Testes de concorrência rodam pelo menos 3 vezes antes de você confiar neles.
7. **Revise o seu diff** contra o §2 do AGENTS (falhas eliminatórias) e o checklist de revisão da skill `clean-code` — olhando o diff, não a sua memória.
8. **Documente** se a mudança desatualizou README ou ARCHITECTURE (skill `project-docs`).
9. **Commite** em partes (skill `commit-in-parts`), marcando `[x]` no commit que conclui a task.
10. Próxima task.

Nunca trabalhe em duas tasks ao mesmo tempo. Achou um problema fora da task atual: anote como task nova no marco certo e siga.

## 3. Portão de fim de marco

Um marco só termina quando tudo abaixo é verdade:

- [ ] Todas as tasks do marco estão `[x]`.
- [ ] `bun run lint && bun run typecheck && bun test` verde, do zero (`docker compose down -v` antes).
- [ ] Testes de concorrência do marco rodaram 3 vezes seguidas sem falha.
- [ ] Checklist da skill `project-docs` passado.
- [ ] Divergências com a spec registradas na §15 dela.

Então mande ao humano um relato curto neste formato:

```
Marco M<n> concluído.
Entregue: <2–4 linhas do que passou a funcionar>
Testes: <suítes rodadas e resultado>
Decisões novas: <ADR ou "nenhuma">
Pendências/riscos: <o que preocupa, ou "nenhum">
Próximo: M<n+1> — <primeira task>
```

## 4. Pare e pergunte ao humano quando

- uma decisão fechada (ADR-001 a ADR-004) parece errada ou impossível de implementar como escrita;
- a spec contradiz o enunciado;
- você não consegue garantir um item das falhas eliminatórias;
- um teste de concorrência falha de forma intermitente e, depois de investigar, você não sabe por quê;
- precisa de uma dependência fora da stack do AGENTS §3;
- uma task exige algo que o humano descartou (partidas dobradas, OpenTelemetry, dashboard, Keycloak);
- uma mudança de schema exigiria editar uma migration já commitada (crie uma nova; se não der, pergunte).

Ao perguntar: diga o problema em uma frase, as opções com o custo de cada uma e qual você recomenda.

## 5. Onde está cada resposta

| Pergunta | Onde |
|---|---|
| Qual o DDL, constraint ou trigger? | spec §4 |
| Como travar e em que ordem ler? | spec §5, §6.1 |
| Como fica o replay? | spec §6.2 |
| Que status HTTP e que corpo? | spec §7 |
| Qual `failureCode`? | spec §9 |
| Qual evento e com que campos? | spec §8.3 |
| Qual métrica e com que labels? | spec §10 |
| Qual variável de ambiente? | spec §11 |
| Que teste e com que critério? | spec §12 |
| Como fazer o teste de carga? | spec §12.2 |
| Por que foi decidido assim? | `ARCHITECTURE.md` |

## 6. Como o avaliador vai olhar (revise por aqui antes de cada portão)

| Área (pontos) | O que ele procura | Onde você prova |
|---|---|---|
| Correção financeira (20) | `Money` sem `number`, ledger fecha com o saldo, reversões corretas, reconciliação honesta | U1, I4, I8, `assertWalletConsistent` em todo teste |
| Concorrência (20) | sem lost update, hot wallet, ≥ 3 instâncias, lock por wallet | C1, C2, C3, C4, C9 |
| Idempotência (15) | dedup persistente, replay exato, conflito de payload | I3, I5, C1 |
| Mensageria e falhas (15) | inbox, outbox, retry, DLQ, crash, shutdown, indisponibilidade | I6, I7, I9, I10, I11, C5, C6, C8 |
| Modelagem (10) | invariantes nas classes, construtores privados, portas, simplicidade | U2, U3, U5, lint A1 |
| Testes (10) | infra real, races reais, determinismo, falhas cobertas | suíte 10× verde, sem `sleep` fixo |
| Observabilidade (5) | logs JSON com contexto, métricas pedidas, health separado | M9, `/metrics`, `/health/*` |
| Documentação (5) | README que roda do zero, ARCHITECTURE com porquê e custo | skill `project-docs` |
| Diferencial | teste de carga com metodologia honesta | spec §12.2, `docs/LOAD_TEST.md` |

## 7. Nunca

- Enfraquecer constraint, teste ou trigger para algo passar.
- Mockar PostgreSQL ou SQS em teste de integração ou concorrência.
- Adicionar `sleep` ou retry num teste para escondê-lo instável.
- Usar `number` para dinheiro em qualquer camada, inclusive nas asserções de teste.
- Publicar evento dentro da transação ou antes do commit.
- Declarar uma task pronta sem ter rodado os testes que a provam.
