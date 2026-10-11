import { type MikroORM } from "@mikro-orm/postgresql";
import { MoneyAmountType } from "../../src/shared/infra/persistence/money-amount.type";

const money = new MoneyAmountType();

interface WalletRow {
  readonly balance_amount: string;
  readonly version: number;
}

interface LedgerRow {
  readonly direction: "CREDIT" | "DEBIT";
  readonly amount: string;
  readonly balance_before: string;
  readonly balance_after: string;
  readonly wallet_version: number;
}

/**
 * Prova as invariantes de uma wallet (AGENTS §10): saldo materializado == Σ(CREDIT) − Σ(DEBIT),
 * cadeia de `balance_before`/`balance_after` contínua, versões sem buracos e saldo final batendo
 * com o último lançamento. Deve rodar ao fim de todo teste de integração e concorrência.
 */
export async function assertWalletConsistent(orm: MikroORM, walletId: string): Promise<void> {
  const connection = orm.em.getConnection();
  const wallets = await connection.execute<WalletRow[]>(
    "SELECT balance_amount, version FROM wallets WHERE id = ?",
    [walletId],
  );
  const wallet = wallets[0];
  if (wallet === undefined) {
    throw new Error(`wallet ${walletId} not found`);
  }

  const entries = await connection.execute<LedgerRow[]>(
    `SELECT direction, amount, balance_before, balance_after, wallet_version
       FROM wallet_ledger_entries WHERE wallet_id = ? ORDER BY wallet_version ASC`,
    [walletId],
  );

  let running = 0n;
  let previousAfter: bigint | null = null;
  let previousVersion: number | null = null;

  for (const entry of entries) {
    const amount = money.convertToJSValue(entry.amount);
    const before = money.convertToJSValue(entry.balance_before);
    const after = money.convertToJSValue(entry.balance_after);
    const expected = entry.direction === "CREDIT" ? before + amount : before - amount;
    if (after !== expected) {
      throw new Error(`ledger arithmetic broken on wallet ${walletId} version ${entry.wallet_version}`);
    }
    running += entry.direction === "CREDIT" ? amount : -amount;

    if (previousAfter === null) {
      if (before !== 0n) {
        throw new Error(`first ledger entry of wallet ${walletId} must start from zero`);
      }
    } else {
      if (before !== previousAfter) {
        throw new Error(`ledger chain broken on wallet ${walletId} version ${entry.wallet_version}`);
      }
      if (previousVersion !== null && entry.wallet_version !== previousVersion + 1) {
        throw new Error(`ledger version gap on wallet ${walletId} near ${entry.wallet_version}`);
      }
    }
    previousAfter = after;
    previousVersion = entry.wallet_version;
  }

  const balance = money.convertToJSValue(wallet.balance_amount);
  if (running !== balance) {
    throw new Error(`wallet ${walletId} balance ${balance} != ledger sum ${running}`);
  }
  if (previousAfter !== null && previousAfter !== balance) {
    throw new Error(`wallet ${walletId} balance does not match the last ledger entry`);
  }
  if (previousVersion !== null && previousVersion !== wallet.version) {
    throw new Error(`wallet ${walletId} version ${wallet.version} != last ledger version ${previousVersion}`);
  }
}
