import { type AnyIntegrationEvent } from "../events/wagering-events";
import { type WalletLedgerEntry, type LedgerEntrySnapshot } from "../../wallet/domain/wallet-ledger-entry";
import { type Wallet, type WalletSnapshot } from "../../wallet/domain/wallet";
import { type WagerTransaction } from "../../wagering/domain/wager-transaction";

/**
 * Portas de persistência (arquitetura hexagonal, spec §2.1). A aplicação depende só destas
 * interfaces; a infra as implementa com SQL. Toda operação financeira roda dentro de
 * `UnitOfWork.transaction`, que entrega os stores ligados à mesma transação SQL.
 */

export interface WalletStore {
  insert(wallet: Wallet): Promise<void>;
  findById(id: string): Promise<WalletSnapshot | null>;
  /** `SELECT ... FOR UPDATE` — serializa operações da mesma wallet (ADR-005). */
  lockById(id: string): Promise<WalletSnapshot | null>;
  /** UPDATE condicionado por versão; devolve linhas afetadas (0 = bug sob lock). */
  updateBalance(params: {
    id: string;
    newBalance: Wallet["balance"];
    expectedVersion: number;
    newVersion: number;
    at: Date;
  }): Promise<number>;
}

export interface LedgerStore {
  insert(entry: WalletLedgerEntry): Promise<void>;
  /** Página por cursor de `seq` (ascendente). `afterSeq` nulo começa do início. */
  page(walletId: string, afterSeq: bigint | null, limit: number): Promise<LedgerEntrySnapshot[]>;
  /** Todos os lançamentos ordenados por versão (reconciliação). */
  allByWallet(walletId: string): Promise<LedgerEntrySnapshot[]>;
}

export interface WagerTransactionStore {
  insert(tx: WagerTransaction): Promise<void>;
  /** `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`; `true` se inseriu (ADR-002). */
  insertIfAbsent(tx: WagerTransaction): Promise<boolean>;
  /** UPDATE das colunas mutáveis (status, resultado, referência, agenda) por id. */
  update(tx: WagerTransaction): Promise<void>;
  findByIdempotencyKey(key: string): Promise<WagerTransaction | null>;
  findByProviderExternal(providerId: string, externalTransactionId: string): Promise<WagerTransaction | null>;
  findById(id: string): Promise<WagerTransaction | null>;
  /** `SELECT ... FOR UPDATE` de uma transação (worker de referência). */
  lockById(id: string): Promise<WagerTransaction | null>;
  /** Já existe REFUND/ROLLBACK `PROCESSED` sobre esta referência? (ADR-001). */
  hasProcessedCompensation(referenceTransactionId: string): Promise<boolean>;
  /** Reagenda para agora as `PENDING_REFERENCE` que apontam para esta transação (spec §6.4). */
  rescheduleDependents(providerId: string, externalTransactionId: string, at: Date): Promise<void>;
  /** Ids de `PENDING_REFERENCE` vencidas, com `FOR UPDATE SKIP LOCKED` (worker). */
  claimPendingReferenceDue(now: Date, limit: number): Promise<string[]>;
  /** Quantas transações estão em `PENDING_REFERENCE` (gauge). */
  countPendingReference(): Promise<number>;
}

export interface OutboxStore {
  enqueue(event: AnyIntegrationEvent, occurredAt: Date): Promise<void>;
}

export type InboxState = "inserted" | "duplicate" | "conflict";

export interface InboxStore {
  /** `INSERT ... ON CONFLICT DO NOTHING`; `conflict` se já existe com outro `payloadHash`. */
  register(consumerName: string, messageId: string, payloadHash: string, at: Date): Promise<InboxState>;
  markProcessed(consumerName: string, messageId: string, at: Date): Promise<void>;
}

export interface PersistencePorts {
  readonly wallets: WalletStore;
  readonly ledger: LedgerStore;
  readonly transactions: WagerTransactionStore;
  readonly outbox: OutboxStore;
  readonly inbox: InboxStore;
}

export type IsolationLevel = "read committed" | "repeatable read";

export interface UnitOfWork {
  transaction<T>(
    work: (ports: PersistencePorts) => Promise<T>,
    options?: { isolationLevel?: IsolationLevel; lockTimeoutMs?: number },
  ): Promise<T>;
}

export const UNIT_OF_WORK = Symbol("UNIT_OF_WORK");
