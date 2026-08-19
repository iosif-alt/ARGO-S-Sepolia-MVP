export type InvestorType = 'INDIVIDUAL' | 'COMPANY';

export type InvestorStatus =
  | 'REGISTERED'
  | 'KYC_STARTED'
  | 'KYC_MANUAL_REVIEW'
  | 'KYC_REJECTED'
  | 'KYC_APPROVED'
  | 'WALLET_VERIFIED'
  | 'ONCHAIN_PENDING'
  | 'ONCHAIN_VERIFIED'
  | 'DOCUMENTS_SIGNED'
  | 'ELIGIBLE'
  | 'PAYMENT_CONFIRMED'
  | 'MINT_PENDING'
  | 'INVESTED'
  | 'FROZEN'
  | 'KYC_EXPIRED';

export interface Investor {
  id: string;
  email: string;
  type: InvestorType;
  country: number;
  status: InvestorStatus;
  walletAddress?: string;
  providerCheckId?: string;
  kycExpiresAt?: string;
  onchainIdentity?: string;
  tokenBalance: string;
  createdAt: string;
  updatedAt: string;
}

export type AdminActionType = 'ONCHAIN_ENROLLMENT' | 'MINT';
export type AdminActionStatus = 'PENDING' | 'PROCESSING' | 'EXECUTED' | 'REJECTED' | 'FAILED';

export interface AdminAction {
  id: string;
  type: AdminActionType;
  investorId: string;
  makerId: string;
  checkerId?: string;
  amount?: string;
  orderId?: string;
  status: AdminActionStatus;
  createdAt: string;
  startedAt?: string;
  executedAt?: string;
  transactionHash?: string;
  identityAddress?: string;
  errorMessage?: string;
}

export interface WalletChallenge {
  investorId: string;
  walletAddress: string;
  nonce: string;
  message: string;
  expiresAt: string;
  usedAt?: string;
}

export interface AuditEvent {
  id: string;
  actorId: string;
  investorId?: string;
  action: string;
  createdAt: string;
  data: Record<string, unknown>;
}

export type UserRole = 'INVESTOR' | 'MAKER' | 'CHECKER' | 'ADMIN';

export interface UserAccount {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  investorId?: string;
  createdAt: string;
}

export type InvestmentOrderStatus = 'CREATED' | 'PAYMENT_VERIFIED' | 'ISSUANCE_PENDING' | 'COMPLETED' | 'CANCELLED';
export interface InvestmentOrder {
  id: string;
  investorId: string;
  tronSender: string;
  tronTreasury: string;
  tronTokenContract: string;
  paymentAmountAtomic: string;
  paymentDecimals: number;
  argosAmount: string;
  priceLabel: string;
  tronTxId?: string;
  mintActionId?: string;
  ethereumTxHash?: string;
  status: InvestmentOrderStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface KycWebhookEvent {
  eventId: string;
  investorId: string;
  providerCheckId: string;
  result: 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW';
  country: number;
  expiresAt?: string;
}

export interface BlockchainEnrollmentResult {
  identityAddress: string;
  claimTransactionHash: string;
  registrationTransactionHash: string;
}

export interface EnrollmentProgress {
  identityAddress?: string;
  claimTransactionHash?: string;
  registrationTransactionHash?: string;
}

export interface BlockchainPort {
  enrollInvestor(
    investor: Investor,
    resume?: EnrollmentProgress,
    onProgress?: (progress: EnrollmentProgress) => Promise<void>,
  ): Promise<BlockchainEnrollmentResult>;
  mint(walletAddress: string, amount: string, expectedBalanceAfter: string): Promise<{ transactionHash: string; alreadyApplied?: boolean }>;
  health(): Promise<{ chainId: number; blockNumber: number }>;
  tokenInfo(): Promise<{ address: string; name: string; symbol: string; decimals: number }>;
}

export interface Repository {
  saveInvestor(investor: Investor): Promise<void>;
  getInvestor(id: string): Promise<Investor | undefined>;
  findInvestorByEmail(email: string): Promise<Investor | undefined>;
  saveChallenge(challenge: WalletChallenge): Promise<void>;
  getChallenge(investorId: string): Promise<WalletChallenge | undefined>;
  saveAction(action: AdminAction): Promise<void>;
  getAction(id: string): Promise<AdminAction | undefined>;
  listActions(status?: AdminActionStatus): Promise<AdminAction[]>;
  listActionsByInvestor(investorId: string): Promise<AdminAction[]>;
  claimAction(id: string, checkerId: string): Promise<AdminAction | undefined>;
  saveUser(user: UserAccount): Promise<void>;
  findUserByEmail(email: string): Promise<UserAccount | undefined>;
  getUser(id: string): Promise<UserAccount | undefined>;
  saveOrder(order: InvestmentOrder): Promise<void>;
  getOrder(id: string): Promise<InvestmentOrder | undefined>;
  listOrdersByInvestor(investorId: string): Promise<InvestmentOrder[]>;
  findOrderByTronTxId(txId: string): Promise<InvestmentOrder | undefined>;
  listAuditEvents(investorId: string): Promise<AuditEvent[]>;
  health(): Promise<boolean>;
  appendAudit(event: AuditEvent): Promise<void>;
  hasWebhookEvent(eventId: string): Promise<boolean>;
  markWebhookEvent(eventId: string): Promise<void>;
}

export class DomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}
