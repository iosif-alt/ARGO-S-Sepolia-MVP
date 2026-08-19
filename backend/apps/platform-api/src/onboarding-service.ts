import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { ethers } from 'ethers';
import {
  AdminAction,
  BlockchainPort,
  DomainError,
  Investor,
  InvestorType,
  KycWebhookEvent,
  Repository,
  WalletChallenge,
} from './domain';

export interface ServiceConfig {
  walletDomain: string;
  chainId: number;
  walletChallengeTtlSeconds: number;
  kycWebhookSecret: string;
}

export class OnboardingService {
  constructor(
    private readonly repository: Repository,
    private readonly blockchain: BlockchainPort,
    private readonly config: ServiceConfig,
  ) {}

  async registerInvestor(email: string, type: InvestorType, country: number): Promise<Investor> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes('@')) throw new DomainError('INVALID_EMAIL', 'Email is invalid');
    if (!Number.isInteger(country) || country < 0 || country > 65_535) {
      throw new DomainError('INVALID_COUNTRY', 'Country must be a uint16 value');
    }
    if (await this.repository.findInvestorByEmail(normalizedEmail)) {
      throw new DomainError('EMAIL_EXISTS', 'Investor with this email already exists');
    }

    const now = new Date().toISOString();
    const investor: Investor = {
      id: randomUUID(), email: normalizedEmail, type, country, status: 'REGISTERED',
      tokenBalance: '0', createdAt: now, updatedAt: now,
    };
    await this.repository.saveInvestor(investor);
    await this.audit('SYSTEM', investor.id, 'INVESTOR_REGISTERED', { type, country });
    return investor;
  }

  async startKyc(investorId: string): Promise<Investor> {
    const investor = await this.requireInvestor(investorId);
    this.requireStatus(investor, ['REGISTERED', 'KYC_REJECTED']);
    return this.updateStatus(investor, 'KYC_STARTED', 'KYC_STARTED', 'INVESTOR');
  }

  signKycWebhook(payload: string): string {
    return createHmac('sha256', this.config.kycWebhookSecret).update(payload).digest('hex');
  }

  async handleKycWebhook(rawPayload: string, signature: string): Promise<Investor> {
    const expected = Buffer.from(this.signKycWebhook(rawPayload), 'hex');
    const received = Buffer.from(signature, 'hex');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new DomainError('INVALID_WEBHOOK_SIGNATURE', 'KYC webhook signature is invalid');
    }

    const event = JSON.parse(rawPayload) as KycWebhookEvent;
    if (await this.repository.hasWebhookEvent(event.eventId)) {
      return this.requireInvestor(event.investorId);
    }

    const investor = await this.requireInvestor(event.investorId);
    this.requireStatus(investor, ['KYC_STARTED', 'KYC_MANUAL_REVIEW']);
    investor.providerCheckId = event.providerCheckId;
    investor.country = event.country;
    investor.kycExpiresAt = event.expiresAt;
    investor.status = event.result === 'APPROVED' ? 'KYC_APPROVED' : event.result === 'REJECTED' ? 'KYC_REJECTED' : 'KYC_MANUAL_REVIEW';
    investor.updatedAt = new Date().toISOString();
    await this.repository.saveInvestor(investor);
    await this.repository.markWebhookEvent(event.eventId);
    await this.audit('KYC_PROVIDER', investor.id, `KYC_${event.result}`, { providerCheckId: event.providerCheckId });
    return investor;
  }

  async createWalletChallenge(investorId: string, walletAddress: string): Promise<WalletChallenge> {
    const investor = await this.requireInvestor(investorId);
    this.requireStatus(investor, ['KYC_APPROVED']);
    const normalizedWallet = ethers.utils.getAddress(walletAddress);
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + this.config.walletChallengeTtlSeconds * 1_000).toISOString();
    const message = [
      'ARGO-S wallet verification', `Domain: ${this.config.walletDomain}`, `Investor ID: ${investor.id}`,
      `Wallet: ${normalizedWallet}`, `Chain ID: ${this.config.chainId}`, `Nonce: ${nonce}`, `Expires: ${expiresAt}`,
    ].join('\n');
    const challenge = { investorId, walletAddress: normalizedWallet, nonce, message, expiresAt };
    await this.repository.saveChallenge(challenge);
    await this.audit(investor.id, investor.id, 'WALLET_CHALLENGE_CREATED', { walletAddress: normalizedWallet });
    return challenge;
  }

  async verifyWalletSignature(investorId: string, signature: string): Promise<Investor> {
    const investor = await this.requireInvestor(investorId);
    this.requireStatus(investor, ['KYC_APPROVED']);
    const challenge = await this.repository.getChallenge(investorId);
    if (!challenge || challenge.usedAt) throw new DomainError('CHALLENGE_NOT_FOUND', 'Active wallet challenge not found');
    if (Date.parse(challenge.expiresAt) <= Date.now()) throw new DomainError('CHALLENGE_EXPIRED', 'Wallet challenge expired');
    const recovered = ethers.utils.verifyMessage(challenge.message, signature);
    if (recovered.toLowerCase() !== challenge.walletAddress.toLowerCase()) {
      throw new DomainError('WALLET_SIGNATURE_MISMATCH', 'Signature does not match requested wallet');
    }
    challenge.usedAt = new Date().toISOString();
    await this.repository.saveChallenge(challenge);
    investor.walletAddress = challenge.walletAddress;
    return this.updateStatus(investor, 'WALLET_VERIFIED', 'WALLET_VERIFIED', investor.id);
  }

  async requestOnchainEnrollment(investorId: string, makerId: string): Promise<AdminAction> {
    const investor = await this.requireInvestor(investorId);
    this.requireStatus(investor, ['WALLET_VERIFIED']);
    investor.status = 'ONCHAIN_PENDING'; investor.updatedAt = new Date().toISOString();
    await this.repository.saveInvestor(investor);
    return this.createAction('ONCHAIN_ENROLLMENT', investorId, makerId);
  }

  async confirmDocuments(investorId: string, actorId: string): Promise<Investor> {
    const investor = await this.requireInvestor(investorId);
    this.requireStatus(investor, ['ONCHAIN_VERIFIED']);
    await this.updateStatus(investor, 'DOCUMENTS_SIGNED', 'DOCUMENTS_SIGNED', actorId);
    return this.updateStatus(investor, 'ELIGIBLE', 'INVESTOR_ELIGIBLE', actorId);
  }

  async confirmPayment(investorId: string, actorId: string): Promise<Investor> {
    const investor = await this.requireInvestor(investorId);
    this.requireStatus(investor, ['ELIGIBLE']);
    const orders = await this.repository.listOrdersByInvestor(investorId);
    if (!orders.some((order) => order.status === 'PAYMENT_VERIFIED')) {
      throw new DomainError('VERIFIED_ORDER_REQUIRED', 'A verified investment payment is required');
    }
    return this.updateStatus(investor, 'PAYMENT_CONFIRMED', 'PAYMENT_CONFIRMED', actorId);
  }

  async requestMint(investorId: string, amount: string, makerId: string): Promise<AdminAction> {
    const investor = await this.requireInvestor(investorId);
    this.requireStatus(investor, ['PAYMENT_CONFIRMED']);
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) throw new DomainError('INVALID_AMOUNT', 'Mint amount must be a positive integer');
    const orders = await this.repository.listOrdersByInvestor(investorId);
    const order = orders.find((candidate) => candidate.status === 'PAYMENT_VERIFIED' && candidate.argosAmount === amount);
    if (!order) throw new DomainError('ORDER_AMOUNT_MISMATCH', 'Mint amount must match a verified investment order');
    investor.status = 'MINT_PENDING'; investor.updatedAt = new Date().toISOString();
    await this.repository.saveInvestor(investor);
    const action = await this.createAction('MINT', investorId, makerId, amount, order.id);
    order.status = 'ISSUANCE_PENDING'; order.mintActionId = action.id; order.updatedAt = new Date().toISOString();
    await this.repository.saveOrder(order);
    return action;
  }

  async approveAction(actionId: string, checkerId: string): Promise<AdminAction> {
    const existing = await this.repository.getAction(actionId);
    if (!existing) throw new DomainError('ACTION_NOT_FOUND', 'Admin action not found');
    if (existing.makerId === checkerId) throw new DomainError('MAKER_CHECKER_CONFLICT', 'Maker cannot approve the same action');
    if (existing.status === 'EXECUTED') return existing;
    const action = await this.repository.claimAction(actionId, checkerId);
    if (!action) {
      const current = await this.repository.getAction(actionId);
      if (current?.status === 'PROCESSING') throw new DomainError('ACTION_IN_PROGRESS', 'Action is already being processed');
      throw new DomainError('ACTION_ALREADY_RESOLVED', 'Admin action is already resolved');
    }
    const investor = await this.requireInvestor(action.investorId);

    try {
      if (action.type === 'ONCHAIN_ENROLLMENT') {
        const result = await this.blockchain.enrollInvestor(
          investor,
          { identityAddress: action.identityAddress },
          async (progress) => {
            action.identityAddress = progress.identityAddress ?? action.identityAddress;
            action.transactionHash = progress.registrationTransactionHash ?? progress.claimTransactionHash ?? action.transactionHash;
            await this.repository.saveAction(action);
          },
        );
        investor.onchainIdentity = result.identityAddress;
        investor.status = 'ONCHAIN_VERIFIED';
        action.identityAddress = result.identityAddress;
        action.transactionHash = result.registrationTransactionHash;
      } else {
        if (!investor.walletAddress || !action.amount || !action.orderId) throw new DomainError('INVALID_MINT_ACTION', 'Mint action is incomplete');
        const expectedBalanceAfter = (BigInt(investor.tokenBalance) + BigInt(action.amount)).toString();
        const result = await this.blockchain.mint(investor.walletAddress, action.amount, expectedBalanceAfter);
        investor.tokenBalance = expectedBalanceAfter;
        investor.status = 'INVESTED';
        action.transactionHash = result.transactionHash;
        const order = await this.repository.getOrder(action.orderId);
        if (!order) throw new DomainError('ORDER_NOT_FOUND', 'Linked investment order was not found');
        order.status = 'COMPLETED'; order.ethereumTxHash = result.transactionHash; order.completedAt = new Date().toISOString(); order.updatedAt = order.completedAt;
        await this.repository.saveOrder(order);
      }
      investor.updatedAt = new Date().toISOString();
      action.status = 'EXECUTED'; action.executedAt = investor.updatedAt; action.errorMessage = undefined;
      await this.repository.saveInvestor(investor); await this.repository.saveAction(action);
      await this.audit(checkerId, investor.id, `${action.type}_EXECUTED`, { actionId, transactionHash: action.transactionHash, orderId: action.orderId });
      return action;
    } catch (error) {
      action.status = 'FAILED'; action.errorMessage = error instanceof Error ? error.message.slice(0, 500) : 'Unknown processing error';
      await this.repository.saveAction(action);
      await this.audit(checkerId, investor.id, `${action.type}_FAILED`, { actionId, error: action.errorMessage });
      throw error;
    }
  }

  async getInvestor(id: string): Promise<Investor> { return this.requireInvestor(id); }

  private async createAction(type: AdminAction['type'], investorId: string, makerId: string, amount?: string, orderId?: string): Promise<AdminAction> {
    const active = (await this.repository.listActionsByInvestor(investorId)).find((item) => item.type === type && ['PENDING', 'PROCESSING'].includes(item.status));
    if (active) return active;
    const action: AdminAction = { id: randomUUID(), type, investorId, makerId, amount, orderId, status: 'PENDING', createdAt: new Date().toISOString() };
    await this.repository.saveAction(action); await this.audit(makerId, investorId, `${type}_REQUESTED`, { actionId: action.id, amount, orderId });
    return action;
  }

  private async requireInvestor(id: string): Promise<Investor> {
    const investor = await this.repository.getInvestor(id);
    if (!investor) throw new DomainError('INVESTOR_NOT_FOUND', 'Investor not found');
    return investor;
  }

  private requireStatus(investor: Investor, allowed: Investor['status'][]): void {
    if (!allowed.includes(investor.status)) throw new DomainError('INVALID_STATUS', `Operation is not allowed from ${investor.status}`);
  }

  private async updateStatus(investor: Investor, status: Investor['status'], action: string, actorId: string): Promise<Investor> {
    investor.status = status; investor.updatedAt = new Date().toISOString();
    await this.repository.saveInvestor(investor); await this.audit(actorId, investor.id, action, { status });
    return investor;
  }

  private async audit(actorId: string, investorId: string, action: string, data: Record<string, unknown>): Promise<void> {
    await this.repository.appendAudit({ id: randomUUID(), actorId, investorId, action, data, createdAt: new Date().toISOString() });
  }
}
