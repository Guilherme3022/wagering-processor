import { Inject, Injectable } from "@nestjs/common";
import { balanceChangedEvent, processedEvent } from "../../shared/application/event-factory";
import { UNIT_OF_WORK, type UnitOfWork } from "../../shared/application/persistence";
import { CLOCK, type Clock } from "../../shared/domain/clock";
import { ID_GENERATOR, type IdGenerator } from "../../shared/domain/id-generator";
import { type Money, Money as MoneyClass, type MoneyProps } from "../../shared/domain/money";
import { createOpeningTransaction, openingHashPayload } from "../../wagering/domain/opening-transaction";
import { PayloadHasher } from "../../wagering/domain/payload-hasher";
import { Wallet } from "../domain/wallet";

export interface OpenWalletCommand {
  readonly playerId: string;
  readonly initialBalance: MoneyProps;
  readonly correlationId: string;
}

export interface WalletView {
  readonly id: string;
  readonly playerId: string;
  readonly balance: MoneyProps;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Abre uma wallet (spec §6.3). Saldo inicial positivo grava, na mesma transação SQL, a wallet,
 * a transação `OPENING` (`PROCESSED`), o lançamento `CREDIT` e os eventos na outbox. Duplicidade
 * de `(player, currency)` vira `WalletAlreadyExistsError` → 409.
 */
@Injectable()
export class OpenWallet {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly hasher: PayloadHasher,
  ) {}

  async execute(command: OpenWalletCommand): Promise<WalletView> {
    const initialBalance = MoneyClass.from(command.initialBalance);
    const at = this.clock.now();
    const walletId = this.ids.next();
    const openingTransactionId = this.ids.next();
    const openingEntryId = this.ids.next();

    const { wallet, openingEntry } = Wallet.open({
      id: walletId,
      playerId: command.playerId,
      initialBalance,
      openingTransactionId,
      openingEntryId,
      at,
    });

    await this.uow.transaction(async (ports) => {
      await ports.wallets.insert(wallet);
      if (openingEntry !== undefined) {
        const payloadHash = this.hasher.hash(
          openingHashPayload({ walletId, playerId: command.playerId, money: initialBalance }),
        );
        const tx = createOpeningTransaction({
          id: openingTransactionId,
          walletId,
          playerId: command.playerId,
          money: initialBalance,
          payloadHash,
          correlationId: command.correlationId,
          at,
        });
        await ports.transactions.insert(tx);
        await ports.ledger.insert(openingEntry);
        await ports.outbox.enqueue(
          processedEvent({ tx, eventId: this.ids.next(), causationId: tx.id }),
          at,
        );
        await ports.outbox.enqueue(
          balanceChangedEvent({
            entry: openingEntry,
            eventId: this.ids.next(),
            causationId: tx.id,
            correlationId: command.correlationId,
          }),
          at,
        );
      }
    });

    return toView(wallet);
  }
}

/** Aceita tanto o agregado `Wallet` quanto um `WalletSnapshot` da persistência. */
export interface WalletLike {
  readonly id: string;
  readonly playerId: string;
  readonly balance: Money;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function toView(wallet: WalletLike): WalletView {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString(),
  };
}
