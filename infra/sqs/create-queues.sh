#!/bin/sh
# Cria as filas da spec §8.1. Idempotente: rodar de novo não muda nada.
set -eu

QUEUE_ATTRS_COMMON='"FifoQueue":"true","ContentBasedDeduplication":"false"'

aws sqs create-queue --queue-name wager-transactions-dlq.fifo \
  --attributes "{${QUEUE_ATTRS_COMMON},\"MessageRetentionPeriod\":\"1209600\"}" >/dev/null

DLQ_URL=$(aws sqs get-queue-url --queue-name wager-transactions-dlq.fifo --query QueueUrl --output text)
DLQ_ARN=$(aws sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn --query Attributes.QueueArn --output text)

REDRIVE="{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}"
aws sqs create-queue --queue-name wager-transactions.fifo \
  --attributes "{${QUEUE_ATTRS_COMMON},\"VisibilityTimeout\":\"60\",\"RedrivePolicy\":\"${REDRIVE}\"}" >/dev/null

aws sqs create-queue --queue-name wagering-events.fifo \
  --attributes "{${QUEUE_ATTRS_COMMON}}" >/dev/null

echo "Filas prontas:"
aws sqs list-queues --query QueueUrls --output text
