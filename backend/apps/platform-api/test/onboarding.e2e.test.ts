import { expect } from 'chai';
import { ethers } from 'ethers';
import { DomainError, KycWebhookEvent } from '../src/domain';
import { InMemoryRepository } from '../src/in-memory-repository';
import { MockBlockchainPort } from '../src/mock-blockchain';
import { OnboardingService } from '../src/onboarding-service';

function buildContext() {
  const repository = new InMemoryRepository();
  const blockchain = new MockBlockchainPort();
  const service = new OnboardingService(repository, blockchain, {
    walletDomain: 'invest.localhost', chainId: 31337, walletChallengeTtlSeconds: 300, kycWebhookSecret: 'test-secret',
  });
  return { repository, blockchain, service };
}

async function approveKyc(service: OnboardingService, investorId: string, eventId = 'kyc-event-1') {
  const event: KycWebhookEvent = {
    eventId, investorId, providerCheckId: `check-${eventId}`, result: 'APPROVED', country: 42,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const raw = JSON.stringify(event);
  return service.handleKycWebhook(raw, service.signKycWebhook(raw));
}

describe('ARGO-S platform onboarding', () => {
  it('completes registration, KYC, wallet, enrollment, payment and controlled mint', async () => {
    const { repository, blockchain, service } = buildContext();
    const wallet = ethers.Wallet.createRandom();

    const investor = await service.registerInvestor('Investor@Example.com', 'INDIVIDUAL', 42);
    expect(investor.status).to.equal('REGISTERED');
    await service.startKyc(investor.id);
    expect((await approveKyc(service, investor.id)).status).to.equal('KYC_APPROVED');

    const challenge = await service.createWalletChallenge(investor.id, wallet.address);
    const signature = await wallet.signMessage(challenge.message);
    expect((await service.verifyWalletSignature(investor.id, signature)).status).to.equal('WALLET_VERIFIED');

    const enrollment = await service.requestOnchainEnrollment(investor.id, 'compliance-maker');
    await service.approveAction(enrollment.id, 'compliance-checker');
    expect((await service.getInvestor(investor.id)).status).to.equal('ONCHAIN_VERIFIED');

    await service.confirmDocuments(investor.id, 'legal-checker');
    const now = new Date().toISOString();
    await repository.saveOrder({
      id: '11111111-1111-4111-8111-111111111111', investorId: investor.id,
      tronSender: 'TLcVKMx3oh2AZ57g3dDXXZ1TH7cGgoVWjs', tronTreasury: 'TUYfr6A9jtEgoePyewjFKwspVXcx34A4XS',
      tronTokenContract: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf', paymentAmountAtomic: '100000000', paymentDecimals: 6,
      argosAmount: '1000', priceLabel: '1 ARGOS = 0.10 tUSDT', tronTxId: 'a'.repeat(64), status: 'PAYMENT_VERIFIED',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdAt: now, updatedAt: now,
    });
    await service.confirmPayment(investor.id, 'finance-checker');
    const mint = await service.requestMint(investor.id, '1000', 'token-maker');
    await service.approveAction(mint.id, 'token-checker');

    const completed = await service.getInvestor(investor.id);
    expect(completed.status).to.equal('INVESTED');
    expect(completed.tokenBalance).to.equal('1000');
    expect(blockchain.enrollments).to.have.length(1);
    expect(blockchain.mints).to.deep.equal([{ walletAddress: wallet.address, amount: '1000' }]);
    expect(repository.getAuditEvents().map((event) => event.action)).to.include.members([
      'KYC_APPROVED', 'WALLET_VERIFIED', 'ONCHAIN_ENROLLMENT_EXECUTED', 'PAYMENT_CONFIRMED', 'MINT_EXECUTED',
    ]);
    const completedOrder = await repository.getOrder('11111111-1111-4111-8111-111111111111');
    expect(completedOrder?.status).to.equal('COMPLETED');
    expect(completedOrder?.ethereumTxHash).to.match(/^0x[0-9a-f]{64}$/);
  });

  it('rejects a forged KYC webhook', async () => {
    const { service } = buildContext();
    const investor = await service.registerInvestor('one@example.com', 'INDIVIDUAL', 42);
    await service.startKyc(investor.id);
    const raw = JSON.stringify({ eventId: 'forged', investorId: investor.id });

    try {
      await service.handleKycWebhook(raw, '00');
      expect.fail('Expected invalid webhook signature');
    } catch (error) {
      expect((error as DomainError).code).to.equal('INVALID_WEBHOOK_SIGNATURE');
    }
  });

  it('processes a repeated provider webhook idempotently', async () => {
    const { service } = buildContext();
    const investor = await service.registerInvestor('two@example.com', 'INDIVIDUAL', 42);
    await service.startKyc(investor.id);
    const first = await approveKyc(service, investor.id, 'same-event');
    const second = await approveKyc(service, investor.id, 'same-event');
    expect(second).to.deep.equal(first);
  });

  it('rejects a wallet signature made by another wallet', async () => {
    const { service } = buildContext();
    const investor = await service.registerInvestor('three@example.com', 'INDIVIDUAL', 42);
    await service.startKyc(investor.id); await approveKyc(service, investor.id);
    const requestedWallet = ethers.Wallet.createRandom();
    const attackerWallet = ethers.Wallet.createRandom();
    const challenge = await service.createWalletChallenge(investor.id, requestedWallet.address);

    try {
      await service.verifyWalletSignature(investor.id, await attackerWallet.signMessage(challenge.message));
      expect.fail('Expected wallet signature mismatch');
    } catch (error) {
      expect((error as DomainError).code).to.equal('WALLET_SIGNATURE_MISMATCH');
    }
  });

  it('enforces maker-checker separation', async () => {
    const { service } = buildContext();
    const wallet = ethers.Wallet.createRandom();
    const investor = await service.registerInvestor('four@example.com', 'INDIVIDUAL', 42);
    await service.startKyc(investor.id); await approveKyc(service, investor.id);
    const challenge = await service.createWalletChallenge(investor.id, wallet.address);
    await service.verifyWalletSignature(investor.id, await wallet.signMessage(challenge.message));
    const action = await service.requestOnchainEnrollment(investor.id, 'same-officer');

    try {
      await service.approveAction(action.id, 'same-officer');
      expect.fail('Expected maker-checker conflict');
    } catch (error) {
      expect(error).to.be.instanceOf(DomainError);
      expect((error as DomainError).code).to.equal('MAKER_CHECKER_CONFLICT');
    }
  });

  it('claims an action once when checker approval is submitted concurrently', async () => {
    const { repository, blockchain, service } = buildContext();
    const wallet = ethers.Wallet.createRandom();
    const investor = await service.registerInvestor('concurrent@example.com', 'INDIVIDUAL', 42);
    await service.startKyc(investor.id); await approveKyc(service, investor.id, 'concurrent-kyc');
    const challenge = await service.createWalletChallenge(investor.id, wallet.address);
    await service.verifyWalletSignature(investor.id, await wallet.signMessage(challenge.message));
    const action = await service.requestOnchainEnrollment(investor.id, 'maker');

    const results = await Promise.allSettled([
      service.approveAction(action.id, 'checker'), service.approveAction(action.id, 'checker'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).to.have.length(1);
    expect(blockchain.enrollments).to.have.length(1);
    expect((await repository.getAction(action.id))?.status).to.equal('EXECUTED');
  });
});
