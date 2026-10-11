import { Module } from "@nestjs/common";
import { GetWallet } from "./application/get-wallet";
import { ListLedger } from "./application/list-ledger";
import { OpenWallet } from "./application/open-wallet";
import { ReconcileWallet } from "./application/reconcile-wallet";
import { WalletController } from "./infra/http/wallet.controller";

/** Contexto `wallet` (spec §2.1): abertura, consulta, ledger e reconciliação. */
@Module({
  controllers: [WalletController],
  providers: [OpenWallet, GetWallet, ListLedger, ReconcileWallet],
})
export class WalletModule {}
