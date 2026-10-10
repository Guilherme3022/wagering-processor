---
name: project-docs
description: Use ao terminar um marco, ao mudar comando, variável de ambiente, endpoint, fila ou decisão, e antes da entrega. Mantém README.md (como usar) e ARCHITECTURE.md (por quê) atualizados, em linguagem humana e sucinta.
---

# Documentação do projeto

Você mantém a documentação que um avaliador vai ler. Ele tem pouco tempo, quer rodar o projeto sem tropeçar e entender as decisões sem ler o código. Escreva para essa pessoa.

## Onde cada coisa vai

| Arquivo | Responde | Não contém |
|---|---|---|
| `README.md` | O que é, como rodar, como testar, como funciona em uma página | justificativas longas, DDL, contratos completos |
| `ARCHITECTURE.md` | Por que cada decisão foi tomada e o que ela custa | instruções de setup |
| `docs/TECH_SPEC.md` | O detalhe técnico completo | — (não é seu para reescrever; só registre divergências na §15) |

O README é a porta de entrada: tudo que existe no projeto precisa ser **alcançável** a partir dele, mesmo que o detalhe esteja em outro arquivo. Nunca duplique conteúdo — resuma em uma linha e aponte o link.

## Como escrever

- **Português claro, frases curtas, voz ativa.** "O worker publica os eventos", não "Os eventos são publicados pelo worker".
- **Comece pelo que importa.** A primeira frase de cada seção responde à pergunta da seção.
- **Diga o porquê em uma linha.** Uma decisão sem motivo parece acidente; um motivo de um parágrafo parece defesa.
- **Exemplos concretos vencem abstrações.** "Uma BET de 50,00 com REFUND e ROLLBACK devolveria 100,00" explica melhor que "evita compensação duplicada".
- **Prosa por padrão.** Tabela só para dados de consulta (comandos, variáveis, endpoints). Lista só quando a ordem ou a comparação importa.
- **Corte sem dó.** Se uma frase pode sair sem perda, ela sai. Se uma seção não ajuda a rodar nem a entender, ela não existe.
- **Sem marketing e sem enfeite.** Nada de "robusto", "escalável", "de ponta", "simplesmente", "basicamente". Sem emojis. Sem badges.
- **Seja honesto.** Limitações e o que não foi feito aparecem com o mesmo destaque que o que foi feito.
- **Termos consistentes.** Use os nomes do código e da tech spec (`PENDING_REFERENCE`, `failureCode`, outbox). Não alterne sinônimos.
- **Nada de jargão sem âncora.** Na primeira vez que um termo técnico aparece no README (inbox, outbox, DLQ), explique em meia frase.

## Estrutura do README

Mantenha esta ordem. Omita uma seção apenas se ela ainda não tiver conteúdo real.

```markdown
# Distributed Wagering Processor

Uma ou duas frases: o que o serviço faz e qual garantia ele oferece.

## Requisitos
Versões exatas (Bun, Docker, Docker Compose).

## Rodando
Bloco de comandos copiável, do clone até a API respondendo. Diga em qual porta.

## Testes
Um comando por suíte, com uma linha dizendo o que cada uma prova.

## Como funciona
Três a seis parágrafos curtos: o caminho de uma aposta, como evitamos duplicação,
como várias instâncias convivem, o que acontece quando algo falha.
Um diagrama mermaid, se ajudar de verdade.

## API
Tabela: método, rota, o que faz. Link para a tech spec para os contratos.

## Configuração
Tabela das variáveis que alguém realmente vai mudar. Link para a lista completa.

## Rodando várias instâncias
Como subir 3 instâncias e como verificar que o resultado ficou consistente.

## Observabilidade
Onde ver logs, métricas e health checks.

## Decisões e limitações
Três a cinco linhas com as decisões mais importantes e as limitações, com link para o ARCHITECTURE.md.

## Estrutura do projeto
Árvore curta das pastas principais, uma linha por pasta.
```

## Estrutura do ARCHITECTURE.md

Cada decisão em quatro partes curtas: **Problema**, **Decisão**, **Descartado**, **Custo**. Um a três parágrafos no total. Decisões fechadas com o humano (ADR-001 a ADR-004) não mudam de conteúdo sem ele.

## Quando atualizar

No **mesmo commit** da mudança que deixa a documentação desatualizada:

- comando novo ou alterado em `package.json` → README, seções "Rodando" ou "Testes";
- variável de ambiente nova → README, "Configuração";
- endpoint, fila ou evento novo → README, "API" ou "Como funciona";
- decisão nova ou interpretação de regra ambígua → ARCHITECTURE.md;
- limitação descoberta → ARCHITECTURE.md e a linha correspondente no README;
- fim de cada marco → passe completo pelo checklist abaixo.

## Checklist antes de concluir

- [ ] Rodei cada comando do README numa execução limpa (`docker compose down -v` antes) e todos funcionaram como escritos.
- [ ] Toda variável, porta e nome de fila no README bate com o código.
- [ ] Nenhum parágrafo repete conteúdo da tech spec; há link no lugar.
- [ ] Cada seção do README cabe numa tela; o README inteiro se lê em menos de cinco minutos.
- [ ] Toda decisão no ARCHITECTURE.md tem motivo e custo.
- [ ] Limitações estão listadas, sem eufemismo.
- [ ] Nenhuma palavra da lista de proibidas, nenhum emoji, nenhum "TODO" esquecido.
- [ ] Li o texto como se fosse o avaliador: soa como uma pessoa explicando a um colega, não como um manual gerado.

## Exemplo de tom

Ruim:

> Esta solução robusta implementa um mecanismo avançado de idempotência baseado em chaves, garantindo de forma eficiente que operações duplicadas sejam adequadamente tratadas pelo sistema.

Bom:

> Cada transação tem uma chave de idempotência. Se a mesma chave chegar de novo com o mesmo conteúdo, devolvemos a resposta original sem tocar no saldo. Se chegar com conteúdo diferente, respondemos `409`.
