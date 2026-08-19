import { Pool } from 'pg';
import { AdminAction, AdminActionStatus, AuditEvent, InvestmentOrder, Investor, Repository, UserAccount, WalletChallenge } from './domain';

const investorFromRow = (row: any): Investor => ({ id: row.id, email: row.email, type: row.investor_type, country: row.country, status: row.status,
  walletAddress: row.wallet_address ?? undefined, providerCheckId: row.provider_check_id ?? undefined,
  kycExpiresAt: row.kyc_expires_at?.toISOString(), onchainIdentity: row.onchain_identity ?? undefined,
  tokenBalance: String(row.token_balance), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
const actionFromRow = (row: any): AdminAction => ({ id: row.id, type: row.action_type, investorId: row.investor_id, makerId: row.maker_id,
  checkerId: row.checker_id ?? undefined, amount: row.amount == null ? undefined : String(row.amount), orderId: row.order_id ?? undefined,
  status: row.status, createdAt: row.created_at.toISOString(), startedAt: row.started_at?.toISOString(), executedAt: row.executed_at?.toISOString(),
  transactionHash: row.transaction_hash ?? undefined, identityAddress: row.identity_address ?? undefined, errorMessage: row.error_message ?? undefined });

export class PostgresRepository implements Repository {
  readonly pool: Pool;
  constructor(connectionString: string) { this.pool = new Pool({ connectionString }); }
  async migrate(): Promise<void> {
    await this.pool.query(`
      ALTER TABLE admin_actions ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES investment_orders(id);
      ALTER TABLE admin_actions ADD COLUMN IF NOT EXISTS started_at timestamptz;
      ALTER TABLE admin_actions ADD COLUMN IF NOT EXISTS transaction_hash text;
      ALTER TABLE admin_actions ADD COLUMN IF NOT EXISTS identity_address text;
      ALTER TABLE admin_actions ADD COLUMN IF NOT EXISTS error_message text;
      ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_status_check;
      ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_status_check CHECK(status IN ('PENDING','PROCESSING','EXECUTED','REJECTED','FAILED'));
      ALTER TABLE investment_orders ADD COLUMN IF NOT EXISTS mint_action_id uuid REFERENCES admin_actions(id);
      ALTER TABLE investment_orders ADD COLUMN IF NOT EXISTS ethereum_tx_hash text;
      ALTER TABLE investment_orders ADD COLUMN IF NOT EXISTS completed_at timestamptz;
      CREATE UNIQUE INDEX IF NOT EXISTS admin_actions_one_active_idx ON admin_actions(investor_id, action_type) WHERE status IN ('PENDING','PROCESSING');
      UPDATE investment_orders AS orders
      SET status='COMPLETED', completed_at=COALESCE(orders.completed_at, investors.updated_at), updated_at=investors.updated_at,
          mint_action_id=COALESCE(orders.mint_action_id, (
            SELECT actions.id FROM admin_actions AS actions
            WHERE actions.investor_id=orders.investor_id AND actions.action_type='MINT' AND actions.status='EXECUTED'
            ORDER BY actions.executed_at DESC NULLS LAST LIMIT 1
          ))
      FROM investors
      WHERE orders.investor_id=investors.id AND investors.status='INVESTED'
        AND orders.status IN ('PAYMENT_VERIFIED','ISSUANCE_PENDING');
    `);
  }
  async close(): Promise<void> { await this.pool.end(); }
  async saveInvestor(i: Investor): Promise<void> { await this.pool.query(`INSERT INTO investors(id,email,investor_type,country,status,wallet_address,provider_check_id,kyc_expires_at,onchain_identity,token_balance,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,investor_type=EXCLUDED.investor_type,country=EXCLUDED.country,status=EXCLUDED.status,wallet_address=EXCLUDED.wallet_address,provider_check_id=EXCLUDED.provider_check_id,kyc_expires_at=EXCLUDED.kyc_expires_at,onchain_identity=EXCLUDED.onchain_identity,token_balance=EXCLUDED.token_balance,updated_at=EXCLUDED.updated_at`,
    [i.id,i.email,i.type,i.country,i.status,i.walletAddress??null,i.providerCheckId??null,i.kycExpiresAt??null,i.onchainIdentity??null,i.tokenBalance,i.createdAt,i.updatedAt]); }
  async getInvestor(id:string){ const r=await this.pool.query('SELECT * FROM investors WHERE id=$1',[id]); return r.rows[0]?investorFromRow(r.rows[0]):undefined; }
  async findInvestorByEmail(email:string){ const r=await this.pool.query('SELECT * FROM investors WHERE email=$1',[email.toLowerCase()]); return r.rows[0]?investorFromRow(r.rows[0]):undefined; }
  async saveChallenge(c:WalletChallenge){ await this.pool.query(`INSERT INTO wallet_challenges(investor_id,wallet_address,nonce,message,expires_at,used_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(investor_id) DO UPDATE SET wallet_address=EXCLUDED.wallet_address,nonce=EXCLUDED.nonce,message=EXCLUDED.message,expires_at=EXCLUDED.expires_at,used_at=EXCLUDED.used_at`,[c.investorId,c.walletAddress,c.nonce,c.message,c.expiresAt,c.usedAt??null]); }
  async getChallenge(id:string){ const r=await this.pool.query('SELECT * FROM wallet_challenges WHERE investor_id=$1',[id]); const x=r.rows[0]; return x?{investorId:x.investor_id,walletAddress:x.wallet_address,nonce:x.nonce,message:x.message,expiresAt:x.expires_at.toISOString(),usedAt:x.used_at?.toISOString()}:undefined; }
  async saveAction(a:AdminAction){ await this.pool.query(`INSERT INTO admin_actions(id,action_type,investor_id,maker_id,checker_id,amount,order_id,status,created_at,started_at,executed_at,transaction_hash,identity_address,error_message) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO UPDATE SET checker_id=EXCLUDED.checker_id,order_id=EXCLUDED.order_id,status=EXCLUDED.status,started_at=EXCLUDED.started_at,executed_at=EXCLUDED.executed_at,transaction_hash=EXCLUDED.transaction_hash,identity_address=EXCLUDED.identity_address,error_message=EXCLUDED.error_message`,[a.id,a.type,a.investorId,a.makerId,a.checkerId??null,a.amount??null,a.orderId??null,a.status,a.createdAt,a.startedAt??null,a.executedAt??null,a.transactionHash??null,a.identityAddress??null,a.errorMessage??null]); }
  async getAction(id:string){ const r=await this.pool.query('SELECT * FROM admin_actions WHERE id=$1',[id]); return r.rows[0]?actionFromRow(r.rows[0]):undefined; }
  async listActions(status?:AdminActionStatus){ const r=status?await this.pool.query('SELECT * FROM admin_actions WHERE status=$1 ORDER BY created_at DESC',[status]):await this.pool.query('SELECT * FROM admin_actions ORDER BY created_at DESC'); return r.rows.map(actionFromRow); }
  async listActionsByInvestor(investorId:string){ const r=await this.pool.query('SELECT * FROM admin_actions WHERE investor_id=$1 ORDER BY created_at DESC',[investorId]); return r.rows.map(actionFromRow); }
  async claimAction(id:string,checkerId:string){ const r=await this.pool.query(`UPDATE admin_actions SET status='PROCESSING',checker_id=$2,started_at=now(),error_message=NULL WHERE id=$1 AND status IN ('PENDING','FAILED') AND maker_id<>$2 RETURNING *`,[id,checkerId]); return r.rows[0]?actionFromRow(r.rows[0]):undefined; }
  async appendAudit(e:AuditEvent){ await this.pool.query('INSERT INTO audit_events(id,actor_id,investor_id,action,data,created_at) VALUES($1,$2,$3,$4,$5,$6)',[e.id,e.actorId,e.investorId??null,e.action,e.data,e.createdAt]); }
  async hasWebhookEvent(id:string){ return (await this.pool.query('SELECT 1 FROM processed_webhook_events WHERE event_id=$1',[id])).rowCount===1; }
  async markWebhookEvent(id:string){ await this.pool.query('INSERT INTO processed_webhook_events(event_id) VALUES($1) ON CONFLICT DO NOTHING',[id]); }
  async saveUser(u:UserAccount){ await this.pool.query('INSERT INTO user_accounts(id,email,password_hash,role,investor_id,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,investor_id=EXCLUDED.investor_id',[u.id,u.email,u.passwordHash,u.role,u.investorId??null,u.createdAt]); }
  async findUserByEmail(email:string){ const r=await this.pool.query('SELECT * FROM user_accounts WHERE email=$1',[email.toLowerCase()]); return r.rows[0]?this.user(r.rows[0]):undefined; }
  async getUser(id:string){ const r=await this.pool.query('SELECT * FROM user_accounts WHERE id=$1',[id]); return r.rows[0]?this.user(r.rows[0]):undefined; }
  async saveOrder(o:InvestmentOrder){await this.pool.query(`INSERT INTO investment_orders(id,investor_id,tron_sender,tron_treasury,tron_token_contract,payment_amount_atomic,payment_decimals,argos_amount,price_label,tron_tx_id,mint_action_id,ethereum_tx_hash,status,expires_at,created_at,updated_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT(id) DO UPDATE SET tron_tx_id=EXCLUDED.tron_tx_id,mint_action_id=EXCLUDED.mint_action_id,ethereum_tx_hash=EXCLUDED.ethereum_tx_hash,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at,completed_at=EXCLUDED.completed_at`,[o.id,o.investorId,o.tronSender,o.tronTreasury,o.tronTokenContract,o.paymentAmountAtomic,o.paymentDecimals,o.argosAmount,o.priceLabel,o.tronTxId??null,o.mintActionId??null,o.ethereumTxHash??null,o.status,o.expiresAt,o.createdAt,o.updatedAt,o.completedAt??null]);}
  async getOrder(id:string){const r=await this.pool.query('SELECT * FROM investment_orders WHERE id=$1',[id]);return r.rows[0]?this.order(r.rows[0]):undefined;}
  async listOrdersByInvestor(id:string){const r=await this.pool.query('SELECT * FROM investment_orders WHERE investor_id=$1 ORDER BY created_at DESC',[id]);return r.rows.map(x=>this.order(x));}
  async findOrderByTronTxId(id:string){const r=await this.pool.query('SELECT * FROM investment_orders WHERE tron_tx_id=$1',[id]);return r.rows[0]?this.order(r.rows[0]):undefined;}
  async listAuditEvents(investorId:string){const r=await this.pool.query('SELECT * FROM audit_events WHERE investor_id=$1 ORDER BY created_at DESC LIMIT 100',[investorId]);return r.rows.map((x:any)=>({id:x.id,actorId:x.actor_id,investorId:x.investor_id??undefined,action:x.action,data:x.data,createdAt:x.created_at.toISOString()}));}
  async health(){await this.pool.query('SELECT 1');return true;}
  private user(x:any):UserAccount{return {id:x.id,email:x.email,passwordHash:x.password_hash,role:x.role,investorId:x.investor_id??undefined,createdAt:x.created_at.toISOString()};}
  private order(x:any):InvestmentOrder{return {id:x.id,investorId:x.investor_id,tronSender:x.tron_sender,tronTreasury:x.tron_treasury,tronTokenContract:x.tron_token_contract,paymentAmountAtomic:String(x.payment_amount_atomic),paymentDecimals:x.payment_decimals,argosAmount:String(x.argos_amount),priceLabel:x.price_label,tronTxId:x.tron_tx_id??undefined,mintActionId:x.mint_action_id??undefined,ethereumTxHash:x.ethereum_tx_hash??undefined,status:x.status,expiresAt:x.expires_at.toISOString(),createdAt:x.created_at.toISOString(),updatedAt:x.updated_at.toISOString(),completedAt:x.completed_at?.toISOString()};}
}
