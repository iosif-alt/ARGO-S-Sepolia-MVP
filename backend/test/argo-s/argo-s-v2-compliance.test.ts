import { expect } from 'chai';
import { ethers } from 'hardhat';
import { deployFullSuiteFixture } from '../fixtures/deploy-full-suite.fixture';

async function deployV2Compliance(supplyLimit = 1_600) {
  const context = await deployFullSuiteFixture();
  const { token } = context.suite;

  // The compliance is bound before modules are added because both ARGO modules
  // validate that they can resolve the governed token.
  const compliance = await ethers.deployContract('ModularCompliance');
  await compliance.init();
  await token.connect(context.accounts.deployer).setCompliance(compliance.address);

  const supplyModule = await ethers.deployContract('ARGOSupplyLimitModule', [supplyLimit]);
  const countriesModule = await ethers.deployContract('ARGOAllowedCountriesModule');
  await compliance.addModule(supplyModule.address);
  await compliance.addModule(countriesModule.address);

  // Module configuration goes through ModularCompliance, which keeps the policy
  // administration surface under one owner and emits a ModuleInteraction event.
  const policyCall = countriesModule.interface.encodeFunctionData('batchSetCountriesAllowed', [[42, 666], true]);
  await compliance.callModuleFunction(policyCall, countriesModule.address);

  return { ...context, compliance, supplyModule, countriesModule };
}

describe('ARGO-S v2 compliance foundation', () => {
  it('keeps ordinary transfers within allowed countries working', async () => {
    const { suite, accounts } = await deployV2Compliance();

    await expect(suite.token.connect(accounts.aliceWallet).transfer(accounts.bobWallet.address, 100))
      .to.emit(suite.token, 'Transfer')
      .withArgs(accounts.aliceWallet.address, accounts.bobWallet.address, 100);
  });

  it('blocks a recipient after the registered country becomes disallowed', async () => {
    const { suite, accounts } = await deployV2Compliance();

    await suite.identityRegistry.connect(accounts.tokenAgent).updateCountry(accounts.bobWallet.address, 840);

    await expect(suite.token.connect(accounts.aliceWallet).transfer(accounts.bobWallet.address, 100)).to.be.revertedWith(
      'Transfer not possible',
    );
  });

  it('allows an explicitly approved country after a policy update', async () => {
    const { suite, accounts, compliance, countriesModule } = await deployV2Compliance();
    await suite.identityRegistry.connect(accounts.tokenAgent).updateCountry(accounts.bobWallet.address, 840);

    const allowCountryCall = countriesModule.interface.encodeFunctionData('setCountryAllowed', [840, true]);
    await compliance.callModuleFunction(allowCountryCall, countriesModule.address);

    await expect(suite.token.connect(accounts.aliceWallet).transfer(accounts.bobWallet.address, 100)).to.emit(suite.token, 'Transfer');
  });

  it('allows minting up to the authorized supply limit', async () => {
    const { suite, accounts } = await deployV2Compliance();

    await expect(suite.token.connect(accounts.tokenAgent).mint(accounts.bobWallet.address, 100))
      .to.emit(suite.token, 'Transfer')
      .withArgs(ethers.constants.AddressZero, accounts.bobWallet.address, 100);

    expect(await suite.token.totalSupply()).to.equal(1_600);
  });

  it('rejects minting even one unit above the authorized supply limit', async () => {
    const { suite, accounts } = await deployV2Compliance();
    await suite.token.connect(accounts.tokenAgent).mint(accounts.bobWallet.address, 100);

    await expect(suite.token.connect(accounts.tokenAgent).mint(accounts.bobWallet.address, 1)).to.be.revertedWith(
      'Compliance not followed',
    );
    expect(await suite.token.totalSupply()).to.equal(1_600);
  });

  it('keeps the supply invariant across mint, transfer and burn operations', async () => {
    const { suite, accounts } = await deployV2Compliance();
    const operations = [25, 10, 40, 5, 20];

    for (const amount of operations) {
      await suite.token.connect(accounts.tokenAgent).mint(accounts.bobWallet.address, amount);
      await suite.token.connect(accounts.bobWallet).transfer(accounts.aliceWallet.address, amount);
      await suite.token.connect(accounts.tokenAgent).burn(accounts.aliceWallet.address, amount);
      expect(await suite.token.totalSupply()).to.be.lte(1_600);
    }
  });
});
