import { Injectable } from "@nestjs/common";
import {
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  type Message,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { type AppConfig } from "../../../shared/infra/config/app-config";
import { InjectConfig } from "../../../shared/infra/config/config.module";

const SEND_BATCH_LIMIT = 10;

export interface OutgoingMessage {
  readonly id: string;
  readonly body: string;
  readonly groupId: string;
  readonly deduplicationId: string;
}

export interface ReceivedMessage {
  readonly messageId: string;
  readonly receiptHandle: string;
  readonly body: string;
  readonly approximateReceiveCount: number;
}

/** Adaptador fino do SQS (via emulador). Resolve e cacheia URLs de fila por nome. */
@Injectable()
export class SqsClient {
  private readonly client: SQSClient;
  private readonly urlCache = new Map<string, string>();

  constructor(@InjectConfig() config: AppConfig) {
    this.client = new SQSClient({
      region: config.sqs.region,
      ...(config.sqs.endpointUrl === undefined ? {} : { endpoint: config.sqs.endpointUrl }),
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
  }

  async queueUrl(queueName: string): Promise<string> {
    const cached = this.urlCache.get(queueName);
    if (cached !== undefined) {
      return cached;
    }
    const result = await this.client.send(new GetQueueUrlCommand({ QueueName: queueName }));
    const url = result.QueueUrl ?? "";
    this.urlCache.set(queueName, url);
    return url;
  }

  /** Cria uma fila FIFO (idempotente); usado pelo init e pelos testes. */
  async createFifoQueue(queueName: string, attributes: Record<string, string> = {}): Promise<string> {
    const result = await this.client.send(
      new CreateQueueCommand({
        QueueName: queueName,
        Attributes: { FifoQueue: "true", ContentBasedDeduplication: "false", ...attributes },
      }),
    );
    const url = result.QueueUrl ?? "";
    this.urlCache.set(queueName, url);
    return url;
  }

  async sendBatch(queueName: string, messages: readonly OutgoingMessage[]): Promise<Set<string>> {
    if (messages.length === 0) {
      return new Set();
    }
    const url = await this.queueUrl(queueName);
    const succeeded = new Set<string>();
    // O SendMessageBatch do SQS aceita no máximo 10 entradas por chamada.
    for (let offset = 0; offset < messages.length; offset += SEND_BATCH_LIMIT) {
      const chunk = messages.slice(offset, offset + SEND_BATCH_LIMIT);
      const result = await this.client.send(
        new SendMessageBatchCommand({
          QueueUrl: url,
          Entries: chunk.map((message) => ({
            Id: message.id,
            MessageBody: message.body,
            MessageGroupId: message.groupId,
            MessageDeduplicationId: message.deduplicationId,
          })),
        }),
      );
      for (const entry of result.Successful ?? []) {
        succeeded.add(entry.Id ?? "");
      }
    }
    return succeeded;
  }

  async sendOne(queueName: string, message: OutgoingMessage): Promise<void> {
    const url = await this.queueUrl(queueName);
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: url,
        MessageBody: message.body,
        MessageGroupId: message.groupId,
        MessageDeduplicationId: message.deduplicationId,
      }),
    );
  }

  async receive(
    queueName: string,
    options: { maxMessages: number; waitSeconds: number; visibilityTimeout: number; abortSignal?: AbortSignal },
  ): Promise<ReceivedMessage[]> {
    const url = await this.queueUrl(queueName);
    const result = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: url,
        MaxNumberOfMessages: options.maxMessages,
        WaitTimeSeconds: options.waitSeconds,
        VisibilityTimeout: options.visibilityTimeout,
        MessageSystemAttributeNames: ["ApproximateReceiveCount"],
      }),
      options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal },
    );
    return (result.Messages ?? []).map((message: Message) => ({
      messageId: message.MessageId ?? "",
      receiptHandle: message.ReceiptHandle ?? "",
      body: message.Body ?? "",
      approximateReceiveCount: Number(message.Attributes?.ApproximateReceiveCount ?? "1"),
    }));
  }

  async deleteMessage(queueName: string, receiptHandle: string): Promise<void> {
    const url = await this.queueUrl(queueName);
    await this.client.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: receiptHandle }));
  }

  async changeMessageVisibility(
    queueName: string,
    receiptHandle: string,
    visibilityTimeout: number,
  ): Promise<void> {
    const url = await this.queueUrl(queueName);
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: url,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilityTimeout,
      }),
    );
  }

  async queueArn(queueName: string): Promise<string> {
    const url = await this.queueUrl(queueName);
    const result = await this.client.send(
      new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }),
    );
    return result.Attributes?.QueueArn ?? "";
  }

  async queueIsReachable(queueName: string): Promise<boolean> {
    const url = await this.queueUrl(queueName);
    await this.client.send(
      new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }),
    );
    return true;
  }

  destroy(): void {
    this.client.destroy();
  }
}
