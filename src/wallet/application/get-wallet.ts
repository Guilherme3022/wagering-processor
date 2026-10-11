import { Inject, Injectable } from "@nestjs/common";
import { UNIT_OF_WORK, type UnitOfWork } from "../../shared/application/persistence";
import { toView, type WalletView } from "./open-wallet";

/** Leitura de uma wallet (spec §7.2). `null` quando não existe → o controller devolve 404. */
@Injectable()
export class GetWallet {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async execute(walletId: string): Promise<WalletView | null> {
    return this.uow.transaction(async (ports) => {
      const wallet = await ports.wallets.findById(walletId);
      return wallet === null ? null : toView(wallet);
    });
  }
}
