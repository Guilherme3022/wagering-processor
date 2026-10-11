# Teste de carga

Diferencial do desafio (spec §12.2). O objetivo não é um número grande: é um experimento honesto
que também prova **correção sob carga**. O gerador está em [`test/load/run.ts`](../test/load/run.ts)
e roda com `bun run test:load`.

## Metodologia

- **Modelo aberto.** As requisições são disparadas num agendamento de taxa constante
  (`1000/rate` ms), sem esperar a resposta anterior. A latência de cada requisição é medida do
  **horário agendado** até a resposta — então, se o sistema fica lento, a fila aparece na latência
  (evita *coordinated omission*).
- **Aquecimento descartado.** As amostras dos primeiros `warmup` segundos não entram nas estatísticas.
- **3 instâncias.** O gerador sobe `start:cluster` equivalente (3 processos) e distribui as
  requisições em round-robin.
- **Verificação de correção ao fim de cada execução** (invalida o resultado se falhar):
  - reconciliação de 100% das wallets tocadas (`consistent: true`);
  - nenhuma transação duplicada por `(provider_id, external_transaction_id)`;
  - outbox drenada (`published_at` preenchido em tudo).

Parâmetros: `--scenario`, `--rate`, `--duration`, `--warmup`, `--wallets`. Cenários:
`distributed` (contenção baixa), `hot-wallet` (uma wallet só), `duplicates` (20% de reenvios).

## Ambiente desta execução

Execução **curta e ilustrativa** (não o protocolo completo de 120 s × 3 repetições): notebook,
WSL2, PostgreSQL 16 e emulador de SQS (MiniStack) em Docker na mesma máquina do gerador. Bun 1.x,
`DB_POOL_MAX=10` por instância, `SQS_CONSUMER_CONCURRENCY=10`. Gerador e serviço no mesmo host.

## Resultado (`distributed`, rate 100/s, 8 s medidos, 100 wallets)

| Métrica | Valor |
|---|---|
| Amostras | 600 |
| Vazão aceita (2xx+422) | ~75/s |
| Latência p50 | 4.98 ms |
| Latência p95 | 7.23 ms |
| Latência p99 | 10.11 ms |
| Latência máx. | 15.88 ms |
| Conflitos de lock | 0 |
| `outbox_lag_seconds` máx. | 6.69 s |
| Correção | consistente, 0 duplicados, outbox drenada |

(JSON bruto em `test/load/results/`.)

## Resultado (`sqs`, rate 40/s, 5 s, 40 wallets)

Mede o atraso **ponta a ponta**: do `SendMessage` até a transação persistida (`processed_at`).

| Métrica | Valor |
|---|---|
| Mensagens | 200 |
| p50 ponta a ponta | 30 ms |
| p95 | 93 ms |
| p99 | 100 ms |
| Correção | consistente, 0 duplicados, outbox drenada |

O atraso ponta a ponta é dominado pelo ciclo de *long polling* do consumidor (recebe em lotes a
cada janela), não pelo processamento em si.

## Onde está o gargalo (com evidência)

O caminho de escrita HTTP é rápido e estável: p50 ~5 ms, p99 ~10 ms, **zero conflitos de lock** no
cenário distribuído (wallets diferentes não disputam o mesmo row lock). A latência não cresce com a
taxa nesse regime — o PostgreSQL absorve as transações financeiras com folga.

O gargalo é a **publicação da outbox para o emulador de SQS**: `outbox_lag_seconds` sobe para ~6–9 s
durante a rajada (cada transação `PROCESSED` gera 2 eventos, então ~2× o volume de escrita) e só
**drena depois** que a carga para. Ou seja, a ingestão é limitada pela vazão de `SendMessageBatch`
do MiniStack, não pelo banco nem pelo lock. Isso é esperado e seguro: a outbox é assíncrona e
at-least-once; nenhum evento se perde, só chega com atraso sob pico. A medição confirma isso —
a verificação de correção só passa quando a outbox termina de drenar.

## Limitações honestas

- Execução curta (segundos), não o protocolo de 120 s × 3 repetições da spec — os números servem
  de ordem de grandeza, não de benchmark.
- Gerador e serviço na **mesma máquina**: competem por CPU; num ambiente real a latência tende a ser
  melhor e a vazão maior.
- **MiniStack não é o SQS real.** A vazão de publicação observada reflete o emulador, não a AWS; o
  gargalo da outbox provavelmente desaparece contra um SQS de verdade.
- Docker em notebook não é produção.
- `hot-wallet` e `duplicates` têm cenário implementado, mas não foram incluídos nesta rodada curta.
