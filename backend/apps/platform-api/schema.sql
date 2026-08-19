CREATE TABLE investors (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  investor_type text NOT NULL CHECK (investor_type IN ('INDIVIDUAL', 'COMPANY')),
  country integer NOT NULL CHECK (country BETWEEN 0 AND 65535),
  status text NOT NULL,
  wallet_address text UNIQUE,
  provider_check_id text UNIQUE,
  kyc_expires_at timestamptz,
  onchain_identity text UNIQUE,
  token_balance numeric(78, 0) NOT NULL DEFAULT 0 CHECK (token_balance >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE wallet_challenges (
  investor_id uuid PRIMARY KEY REFERENCES investors(id),
  wallet_address text NOT NULL,
  nonce text NOT NULL UNIQUE,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE admin_actions (
  id uuid PRIMARY KEY,
  action_type text NOT NULL CHECK (action_type IN ('ONCHAIN_ENROLLMENT', 'MINT')),
  investor_id uuid NOT NULL REFERENCES investors(id),
  maker_id text NOT NULL,
  checker_id text,
  amount numeric(78, 0) CHECK (amount > 0),
  status text NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'EXECUTED', 'REJECTED', 'FAILED')),
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  executed_at timestamptz,
  transaction_hash text,
  identity_address text,
  error_message text,
  CHECK (checker_id IS NULL OR checker_id <> maker_id)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL,
  investor_id uuid REFERENCES investors(id),
  action text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE processed_webhook_events (
  event_id text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('INVESTOR','MAKER','CHECKER','ADMIN')),
  investor_id uuid UNIQUE REFERENCES investors(id),
  created_at timestamptz NOT NULL
);

CREATE TABLE investment_orders (
  id uuid PRIMARY KEY,
  investor_id uuid NOT NULL REFERENCES investors(id),
  tron_sender text NOT NULL,
  tron_treasury text NOT NULL,
  tron_token_contract text NOT NULL,
  payment_amount_atomic numeric(78,0) NOT NULL,
  payment_decimals integer NOT NULL,
  argos_amount numeric(78,0) NOT NULL,
  price_label text NOT NULL,
  tron_tx_id text UNIQUE,
  status text NOT NULL CHECK(status IN ('CREATED','PAYMENT_VERIFIED','ISSUANCE_PENDING','COMPLETED','CANCELLED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE admin_actions ADD COLUMN order_id uuid REFERENCES investment_orders(id);
ALTER TABLE investment_orders ADD COLUMN mint_action_id uuid REFERENCES admin_actions(id);
ALTER TABLE investment_orders ADD COLUMN ethereum_tx_hash text;
ALTER TABLE investment_orders ADD COLUMN completed_at timestamptz;

CREATE INDEX investment_orders_investor_idx ON investment_orders(investor_id, created_at DESC);

CREATE INDEX investors_status_idx ON investors(status);
CREATE INDEX admin_actions_pending_idx ON admin_actions(status) WHERE status = 'PENDING';
CREATE UNIQUE INDEX admin_actions_one_active_idx ON admin_actions(investor_id, action_type) WHERE status IN ('PENDING','PROCESSING');
CREATE INDEX audit_events_investor_idx ON audit_events(investor_id, created_at);
