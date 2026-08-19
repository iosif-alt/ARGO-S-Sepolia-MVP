import { expect } from 'chai';
import { ethers } from 'ethers';
import { Erc3643BlockchainPort } from '../src/erc3643-blockchain';
import { InMemoryRepository } from '../src/in-memory-repository';
import { OnboardingService } from '../src/onboarding-service';

const runIntegration = process.env.RUN_ERC3643_INTEGRATION === 'true' ? describe : describe.skip;

runIntegration('platform API + local ERC-3643', function () {
  this.timeout(180_000);

  it('creates an identity, verifies the wallet and mints ARGOS', async () => {
    const rpcUrl = process.env.LOCALHOST_RPC_URL ?? 'http://127.0.0.1:8545';
    const operatorPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!operatorPrivateKey) throw new Error('DEPLOYER_PRIVATE_KEY is required');

    const repository = new InMemoryRepository();
    const blockchain = new Erc3643BlockchainPort({
      rpcUrl,
      operatorPrivateKey,
      claimSignerPrivateKey: process.env.CLAIM_SIGNER_PRIVATE_KEY ?? operatorPrivateKey,
      manifestPath: process.env.ARGO_DEPLOYMENT_MANIFEST ?? 'deployments/localhost-v2.json',
      claimTopicLabel: 'ARGO_KYC_APPROVED',
    });
    const service = new OnboardingService(repository, blockchain, {
      walletDomain: 'localhost',
      chainId: 31337,
      walletChallengeTtlSeconds: 300,
      kycWebhookSecret: 'local-integration-secret',
    });

    const wallet = ethers.Wallet.createRandom();
    let investor = await service.registerInvestor('integration@argo-s.test', 'INDIVIDUAL', 804);
    await service.startKyc(investor.id);

    const webhookPayload = JSON.stringify({
      eventId: 'kyc-local-1',
      investorId: investor.id,
      providerCheckId: 'local-provider-check',
      result: 'APPROVED',
      country: 804,
      expiresAt: '2030-12-31T23:59:59.000Z',
    });
    await service.handleKycWebhook(webhookPayload, service.signKycWebhook(webhookPayload));

    const challenge = await service.createWalletChallenge(investor.id, wallet.address);
    await service.verifyWalletSignature(investor.id, await wallet.signMessage(challenge.message));

    const enrollment = await service.requestOnchainEnrollment(investor.id, 'maker-enrollment');
    await service.approveAction(enrollment.id, 'checker-enrollment');
    investor = await service.getInvestor(investor.id);
    expect(investor.status).to.equal('ONCHAIN_VERIFIED');
    expect(investor.onchainIdentity).to.match(/^0x[0-9a-fA-F]{40}$/);

    await service.confirmDocuments(investor.id, 'legal-officer');
    const now = new Date().toISOString();
    await repository.saveOrder({
      id: '22222222-2222-4222-8222-222222222222', investorId: investor.id,
      tronSender: 'TLcVKMx3oh2AZ57g3dDXXZ1TH7cGgoVWjs', tronTreasury: 'TUYfr6A9jtEgoePyewjFKwspVXcx34A4XS',
      tronTokenContract: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf', paymentAmountAtomic: '100000000', paymentDecimals: 6,
      argosAmount: '1000', priceLabel: '1 ARGOS = 0.10 tUSDT', tronTxId: 'b'.repeat(64), status: 'PAYMENT_VERIFIED',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdAt: now, updatedAt: now,
    });
    await service.confirmPayment(investor.id, 'finance-officer');
    const mint = await service.requestMint(investor.id, '1000', 'maker-mint');
    await service.approveAction(mint.id, 'checker-mint');

    investor = await service.getInvestor(investor.id);
    expect(investor.status).to.equal('INVESTED');
    expect(investor.tokenBalance).to.equal('1000');

    const manifest = require('../../../deployments/localhost-v2.json') as { token: string; identityRegistry: string };
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const registry = new ethers.Contract(manifest.identityRegistry, ['function isVerified(address) view returns (bool)'], provider);
    const token = new ethers.Contract(manifest.token, ['function balanceOf(address) view returns (uint256)'], provider);
    expect(await registry.isVerified(wallet.address)).to.equal(true);
    expect((await token.balanceOf(wallet.address)).toString()).to.equal('1000');
  });
});
