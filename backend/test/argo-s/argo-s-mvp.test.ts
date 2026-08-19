import { expect } from 'chai';
import { deployFullSuiteFixture } from '../fixtures/deploy-full-suite.fixture';

describe('ARGO-S testnet MVP', () => {
  it('deploys the tokenized share with indivisible units', async () => {
    const { suite } = await deployFullSuiteFixture({
      tokenName: 'ARGO-S Tokenized Share',
      tokenSymbol: 'ARGOS',
      claimTopicLabel: 'ARGO_KYC_APPROVED',
      aliceInitialBalance: 60_000_000,
      bobInitialBalance: 0,
    });

    expect(await suite.token.name()).to.equal('ARGO-S Tokenized Share');
    expect(await suite.token.symbol()).to.equal('ARGOS');
    expect(await suite.token.decimals()).to.equal(0);
    expect(await suite.token.totalSupply()).to.equal(60_000_000);
  });

  it('allows a transfer between verified investors', async () => {
    const { suite, accounts } = await deployFullSuiteFixture({
      tokenName: 'ARGO-S Tokenized Share',
      tokenSymbol: 'ARGOS',
      claimTopicLabel: 'ARGO_KYC_APPROVED',
      aliceInitialBalance: 1_000,
      bobInitialBalance: 0,
    });

    await expect(suite.token.connect(accounts.aliceWallet).transfer(accounts.bobWallet.address, 100))
      .to.emit(suite.token, 'Transfer')
      .withArgs(accounts.aliceWallet.address, accounts.bobWallet.address, 100);

    expect(await suite.token.balanceOf(accounts.bobWallet.address)).to.equal(100);
  });

  it('rejects a transfer to a wallet without a verified identity', async () => {
    const { suite, accounts } = await deployFullSuiteFixture({
      tokenName: 'ARGO-S Tokenized Share',
      tokenSymbol: 'ARGOS',
      claimTopicLabel: 'ARGO_KYC_APPROVED',
      aliceInitialBalance: 1_000,
      bobInitialBalance: 0,
    });

    await expect(suite.token.connect(accounts.aliceWallet).transfer(accounts.charlieWallet.address, 100)).to.be.revertedWith(
      'Transfer not possible',
    );
  });

  it('lets the token agent freeze and unfreeze an investor wallet', async () => {
    const { suite, accounts } = await deployFullSuiteFixture({
      tokenName: 'ARGO-S Tokenized Share',
      tokenSymbol: 'ARGOS',
      claimTopicLabel: 'ARGO_KYC_APPROVED',
      aliceInitialBalance: 1_000,
      bobInitialBalance: 0,
    });

    await suite.token.connect(accounts.tokenAgent).setAddressFrozen(accounts.aliceWallet.address, true);
    await expect(suite.token.connect(accounts.aliceWallet).transfer(accounts.bobWallet.address, 100)).to.be.revertedWith('wallet is frozen');

    await suite.token.connect(accounts.tokenAgent).setAddressFrozen(accounts.aliceWallet.address, false);
    await expect(suite.token.connect(accounts.aliceWallet).transfer(accounts.bobWallet.address, 100)).to.emit(suite.token, 'Transfer');
  });
});
