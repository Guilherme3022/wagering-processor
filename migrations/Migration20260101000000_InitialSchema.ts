import { Migration } from "@mikro-orm/migrations";

/**
 * Schema inicial completo (spec §4). Tabelas, constraints, índices e triggers em SQL explícito;
 * as garantias vivem no banco, não só no TypeScript (restrição inviolável 9 do AGENTS). Triggers
 * de invariante levantam `P0001` com prefixo `invariant_violation:` para o mapeamento de erro
 * reconhecer violação de invariante (HTTP 500).
 */
export class Migration20260101000000_InitialSchema extends Migration {
  override async up(): Promise<void> {
    this.addSql(`CREATE TABLE wallets (
      id              UUID PRIMARY KEY,
      player_id       UUID NOT NULL,
      currency        CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      balance_amount  NUMERIC(20,2) NOT NULL CHECK (balance_amount >= 0),
      version         INTEGER NOT NULL CHECK (version >= 1),
      created_at      TIMESTAMPTZ NOT NULL,
      updated_at      TIMESTAMPTZ NOT NULL,
      CONSTRAINT uq_wallets_player_currency UNIQUE (player_id, currency)
    );`);

    this.addSql(`CREATE TABLE wager_transactions (
      id                                UUID PRIMARY KEY,
      provider_id                       TEXT NOT NULL,
      external_transaction_id           TEXT NOT NULL,
      idempotency_key                   TEXT NOT NULL,
      payload_hash                      TEXT NOT NULL,
      requested_wallet_id               UUID NOT NULL,
      wallet_id                         UUID NULL REFERENCES wallets(id),
      player_id                         UUID NOT NULL,
      round_id                          TEXT NULL,
      game_id                           TEXT NULL,
      kind                              TEXT NOT NULL CHECK (kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
      amount                            NUMERIC(20,2) NOT NULL CHECK (amount > 0),
      currency                          CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      reference_external_transaction_id TEXT NULL,
      reference_transaction_id          UUID NULL REFERENCES wager_transactions(id),
      status                            TEXT NOT NULL CHECK (status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
      failure_code                      TEXT NULL,
      result_balance_amount             NUMERIC(20,2) NULL,
      result_balance_currency           CHAR(3) NULL,
      reference_attempts                INTEGER NOT NULL DEFAULT 0,
      next_reference_attempt_at         TIMESTAMPTZ NULL,
      reference_deadline_at             TIMESTAMPTZ NULL,
      correlation_id                    TEXT NOT NULL,
      created_at                        TIMESTAMPTZ NOT NULL,
      processed_at                      TIMESTAMPTZ NULL,
      CONSTRAINT uq_wtx_idempotency_key UNIQUE (idempotency_key),
      CONSTRAINT uq_wtx_provider_external UNIQUE (provider_id, external_transaction_id),
      CONSTRAINT ck_wtx_reference_required
        CHECK (kind NOT IN ('REFUND','ROLLBACK') OR reference_external_transaction_id IS NOT NULL),
      CONSTRAINT ck_wtx_bet_no_reference
        CHECK (kind <> 'BET' OR reference_external_transaction_id IS NULL),
      CONSTRAINT ck_wtx_opening_is_system
        CHECK ((kind = 'OPENING') = (provider_id = '__system__')),
      CONSTRAINT ck_wtx_round_game
        CHECK (kind = 'OPENING' OR (round_id IS NOT NULL AND game_id IS NOT NULL)),
      CONSTRAINT ck_wtx_wallet_resolved
        CHECK (wallet_id IS NOT NULL OR (status = 'REJECTED' AND failure_code = 'WALLET_NOT_FOUND')),
      CONSTRAINT ck_wtx_failure_code
        CHECK ((status IN ('REJECTED','FAILED')) = (failure_code IS NOT NULL)),
      CONSTRAINT ck_wtx_processed_at
        CHECK ((status = 'PROCESSED') = (processed_at IS NOT NULL)),
      CONSTRAINT ck_wtx_result_balance
        CHECK (status NOT IN ('PROCESSED','REJECTED') OR result_balance_amount IS NOT NULL
               OR failure_code = 'WALLET_NOT_FOUND'),
      CONSTRAINT ck_wtx_result_balance_currency
        CHECK ((result_balance_amount IS NULL) = (result_balance_currency IS NULL)),
      CONSTRAINT ck_wtx_pending_reference
        CHECK (status <> 'PENDING_REFERENCE'
               OR (next_reference_attempt_at IS NOT NULL AND reference_deadline_at IS NOT NULL)),
      -- Compensação única (ADR-001): um REFUND/ROLLBACK PROCESSED tem de apontar a referência interna,
      -- senão o índice único parcial (que indexa reference_transaction_id) seria contornado com NULL.
      CONSTRAINT ck_wtx_compensation_reference
        CHECK (NOT (status = 'PROCESSED' AND kind IN ('REFUND','ROLLBACK'))
               OR reference_transaction_id IS NOT NULL)
    );`);

    this.addSql(`CREATE UNIQUE INDEX uq_wtx_single_compensation
      ON wager_transactions (reference_transaction_id)
      WHERE status = 'PROCESSED' AND kind IN ('REFUND','ROLLBACK');`);
    this.addSql(`CREATE INDEX ix_wtx_reference_lookup
      ON wager_transactions (provider_id, reference_external_transaction_id)
      WHERE reference_external_transaction_id IS NOT NULL;`);
    this.addSql(`CREATE INDEX ix_wtx_pending_reference_due
      ON wager_transactions (next_reference_attempt_at)
      WHERE status = 'PENDING_REFERENCE';`);

    this.addSql(`CREATE TABLE wallet_ledger_entries (
      id              UUID PRIMARY KEY,
      seq             BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
      wallet_id       UUID NOT NULL REFERENCES wallets(id),
      transaction_id  UUID NOT NULL REFERENCES wager_transactions(id),
      direction       TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
      amount          NUMERIC(20,2) NOT NULL CHECK (amount > 0),
      currency        CHAR(3) NOT NULL,
      balance_before  NUMERIC(20,2) NOT NULL CHECK (balance_before >= 0),
      balance_after   NUMERIC(20,2) NOT NULL CHECK (balance_after >= 0),
      wallet_version  INTEGER NOT NULL CHECK (wallet_version >= 1),
      created_at      TIMESTAMPTZ NOT NULL,
      CONSTRAINT uq_ledger_tx_wallet UNIQUE (transaction_id, wallet_id),
      CONSTRAINT uq_ledger_wallet_version UNIQUE (wallet_id, wallet_version),
      CONSTRAINT ck_ledger_arithmetic CHECK (
        (direction = 'CREDIT' AND balance_after = balance_before + amount) OR
        (direction = 'DEBIT'  AND balance_after = balance_before - amount))
    );`);
    this.addSql(`CREATE INDEX ix_ledger_wallet_seq ON wallet_ledger_entries (wallet_id, seq);`);

    this.addSql(`CREATE TABLE inbox_messages (
      consumer_name  TEXT NOT NULL,
      message_id     TEXT NOT NULL,
      payload_hash   TEXT NOT NULL,
      received_at    TIMESTAMPTZ NOT NULL,
      processed_at   TIMESTAMPTZ NULL,
      PRIMARY KEY (consumer_name, message_id)
    );`);

    this.addSql(`CREATE TABLE outbox_messages (
      id               UUID PRIMARY KEY,
      aggregate_id     TEXT NOT NULL,
      event_type       TEXT NOT NULL,
      payload          JSONB NOT NULL,
      occurred_at      TIMESTAMPTZ NOT NULL,
      attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      next_attempt_at  TIMESTAMPTZ NOT NULL,
      locked_until     TIMESTAMPTZ NULL,
      locked_by        TEXT NULL,
      published_at     TIMESTAMPTZ NULL,
      last_error       TEXT NULL
    );`);
    this.addSql(`CREATE INDEX ix_outbox_due ON outbox_messages (next_attempt_at) WHERE published_at IS NULL;`);

    // ---- Triggers: ledger imutável e cadeia de versões (spec §4.2) ----
    this.addSql(`CREATE FUNCTION trg_ledger_immutable_fn() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'invariant_violation: wallet_ledger_entries is append-only' USING ERRCODE = 'P0001';
      END;
      $$ LANGUAGE plpgsql;`);
    this.addSql(`CREATE TRIGGER trg_ledger_immutable
      BEFORE UPDATE OR DELETE ON wallet_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION trg_ledger_immutable_fn();`);
    this.addSql(`CREATE TRIGGER trg_ledger_no_truncate
      BEFORE TRUNCATE ON wallet_ledger_entries
      FOR EACH STATEMENT EXECUTE FUNCTION trg_ledger_immutable_fn();`);

    this.addSql(`CREATE FUNCTION trg_ledger_chain_fn() RETURNS trigger AS $$
      DECLARE prev_after NUMERIC(20,2);
      BEGIN
        SELECT balance_after INTO prev_after
          FROM wallet_ledger_entries
         WHERE wallet_id = NEW.wallet_id AND wallet_version = NEW.wallet_version - 1;
        IF FOUND THEN
          IF NEW.balance_before <> prev_after THEN
            RAISE EXCEPTION 'invariant_violation: ledger chain broken for wallet %', NEW.wallet_id USING ERRCODE = 'P0001';
          END IF;
        ELSE
          IF NEW.balance_before <> 0 OR NEW.wallet_version NOT IN (1, 2) THEN
            RAISE EXCEPTION 'invariant_violation: first ledger entry must start from zero' USING ERRCODE = 'P0001';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;`);
    this.addSql(`CREATE TRIGGER trg_ledger_chain
      BEFORE INSERT ON wallet_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION trg_ledger_chain_fn();`);

    // Direção inversa da consistência (spec §6.2 "e vice-versa"): um lançamento inserido sem a
    // atualização correspondente da wallet falha no commit. Deferida para a wallet poder ser
    // atualizada depois do INSERT do ledger dentro da mesma transação.
    this.addSql(`CREATE FUNCTION trg_ledger_requires_wallet_fn() RETURNS trigger AS $$
      DECLARE w_version INTEGER; w_balance NUMERIC(20,2);
      BEGIN
        SELECT version, balance_amount INTO w_version, w_balance FROM wallets WHERE id = NEW.wallet_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'invariant_violation: ledger entry for unknown wallet %', NEW.wallet_id USING ERRCODE = 'P0001';
        END IF;
        IF w_version <> NEW.wallet_version OR w_balance <> NEW.balance_after THEN
          RAISE EXCEPTION 'invariant_violation: ledger entry % does not match wallet % state', NEW.id, NEW.wallet_id USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;`);
    this.addSql(`CREATE CONSTRAINT TRIGGER trg_ledger_requires_wallet
      AFTER INSERT ON wallet_ledger_entries
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION trg_ledger_requires_wallet_fn();`);

    // ---- Triggers: guarda da wallet e consistência deferida com o ledger (spec §4.2) ----
    this.addSql(`CREATE FUNCTION trg_wallet_guard_fn() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'invariant_violation: wallets cannot be deleted' USING ERRCODE = 'P0001';
        END IF;
        IF NEW.id <> OLD.id OR NEW.player_id <> OLD.player_id
           OR NEW.currency <> OLD.currency OR NEW.created_at <> OLD.created_at THEN
          RAISE EXCEPTION 'invariant_violation: wallet identity columns are immutable' USING ERRCODE = 'P0001';
        END IF;
        IF NEW.balance_amount <> OLD.balance_amount THEN
          IF NEW.version <> OLD.version + 1 THEN
            RAISE EXCEPTION 'invariant_violation: balance change must bump version by one' USING ERRCODE = 'P0001';
          END IF;
        ELSE
          IF NEW.version <> OLD.version THEN
            RAISE EXCEPTION 'invariant_violation: version cannot change without a balance change' USING ERRCODE = 'P0001';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;`);
    this.addSql(`CREATE TRIGGER trg_wallet_guard
      BEFORE UPDATE OR DELETE ON wallets
      FOR EACH ROW EXECUTE FUNCTION trg_wallet_guard_fn();`);

    this.addSql(`CREATE FUNCTION trg_wallet_ledger_consistency_fn() RETURNS trigger AS $$
      BEGIN
        IF NEW.version = 1 AND NEW.balance_amount = 0 THEN
          RETURN NEW;
        END IF;
        PERFORM 1 FROM wallet_ledger_entries
          WHERE wallet_id = NEW.id AND wallet_version = NEW.version
            AND balance_after = NEW.balance_amount;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'invariant_violation: wallet % version % has no matching ledger entry', NEW.id, NEW.version USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;`);
    this.addSql(`CREATE CONSTRAINT TRIGGER trg_wallet_ledger_consistency
      AFTER INSERT OR UPDATE ON wallets
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION trg_wallet_ledger_consistency_fn();`);

    // ---- Trigger: guarda de wager_transactions (estado terminal + identidade) ----
    this.addSql(`CREATE FUNCTION trg_wtx_guard_fn() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'invariant_violation: wager_transactions cannot be deleted' USING ERRCODE = 'P0001';
        END IF;
        IF OLD.status IN ('PROCESSED','REJECTED','FAILED') THEN
          RAISE EXCEPTION 'invariant_violation: terminal wager transaction % is immutable', OLD.id USING ERRCODE = 'P0001';
        END IF;
        IF NEW.id <> OLD.id OR NEW.provider_id <> OLD.provider_id
           OR NEW.external_transaction_id <> OLD.external_transaction_id
           OR NEW.idempotency_key <> OLD.idempotency_key
           OR NEW.payload_hash <> OLD.payload_hash
           OR NEW.requested_wallet_id <> OLD.requested_wallet_id
           OR NEW.player_id <> OLD.player_id
           OR NEW.kind <> OLD.kind OR NEW.amount <> OLD.amount OR NEW.currency <> OLD.currency
           OR NEW.created_at <> OLD.created_at
           OR COALESCE(NEW.reference_external_transaction_id, '') <> COALESCE(OLD.reference_external_transaction_id, '') THEN
          RAISE EXCEPTION 'invariant_violation: wager transaction identity columns are immutable' USING ERRCODE = 'P0001';
        END IF;
        -- wallet_id só pode ser preenchido uma vez (null -> resolvido); nunca reescrito.
        IF OLD.wallet_id IS NOT NULL AND NEW.wallet_id IS DISTINCT FROM OLD.wallet_id THEN
          RAISE EXCEPTION 'invariant_violation: resolved wallet_id is immutable' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;`);
    this.addSql(`CREATE TRIGGER trg_wtx_guard
      BEFORE UPDATE OR DELETE ON wager_transactions
      FOR EACH ROW EXECUTE FUNCTION trg_wtx_guard_fn();`);

    // ---- Trigger: guarda da outbox (payload e tipo imutáveis; não republica) ----
    this.addSql(`CREATE FUNCTION trg_outbox_guard_fn() RETURNS trigger AS $$
      BEGIN
        IF NEW.id <> OLD.id OR NEW.aggregate_id <> OLD.aggregate_id
           OR NEW.event_type <> OLD.event_type OR NEW.payload <> OLD.payload
           OR NEW.occurred_at <> OLD.occurred_at THEN
          RAISE EXCEPTION 'invariant_violation: outbox identity columns are immutable' USING ERRCODE = 'P0001';
        END IF;
        IF OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
          RAISE EXCEPTION 'invariant_violation: outbox message already published' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;`);
    this.addSql(`CREATE TRIGGER trg_outbox_guard
      BEFORE UPDATE ON outbox_messages
      FOR EACH ROW EXECUTE FUNCTION trg_outbox_guard_fn();`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TRIGGER IF EXISTS trg_outbox_guard ON outbox_messages;`);
    this.addSql(`DROP FUNCTION IF EXISTS trg_outbox_guard_fn();`);
    this.addSql(`DROP TRIGGER IF EXISTS trg_wtx_guard ON wager_transactions;`);
    this.addSql(`DROP FUNCTION IF EXISTS trg_wtx_guard_fn();`);
    this.addSql(`DROP TRIGGER IF EXISTS trg_wallet_ledger_consistency ON wallets;`);
    this.addSql(`DROP FUNCTION IF EXISTS trg_wallet_ledger_consistency_fn();`);
    this.addSql(`DROP TRIGGER IF EXISTS trg_wallet_guard ON wallets;`);
    this.addSql(`DROP FUNCTION IF EXISTS trg_wallet_guard_fn();`);
    this.addSql(`DROP TRIGGER IF EXISTS trg_ledger_requires_wallet ON wallet_ledger_entries;`);
    this.addSql(`DROP FUNCTION IF EXISTS trg_ledger_requires_wallet_fn();`);
    this.addSql(`DROP TRIGGER IF EXISTS trg_ledger_chain ON wallet_ledger_entries;`);
    this.addSql(`DROP FUNCTION IF EXISTS trg_ledger_chain_fn();`);
    this.addSql(`DROP TRIGGER IF EXISTS trg_ledger_no_truncate ON wallet_ledger_entries;`);
    this.addSql(`DROP TRIGGER IF EXISTS trg_ledger_immutable ON wallet_ledger_entries;`);
    this.addSql(`DROP FUNCTION IF EXISTS trg_ledger_immutable_fn();`);
    this.addSql(`DROP TABLE IF EXISTS outbox_messages;`);
    this.addSql(`DROP TABLE IF EXISTS inbox_messages;`);
    this.addSql(`DROP TABLE IF EXISTS wallet_ledger_entries;`);
    this.addSql(`DROP TABLE IF EXISTS wager_transactions;`);
    this.addSql(`DROP TABLE IF EXISTS wallets;`);
  }
}
