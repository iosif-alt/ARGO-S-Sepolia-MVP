import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { network } from 'hardhat';
import { deployFullSuiteFixture } from '../test/fixtures/deploy-full-suite.fixture';

async function main() {
  // This deploys the complete T-REX suite with project-specific token metadata.
  // Real investor identities are intentionally not accepted by this testnet script.
  const deployment = await deployFullSuiteFixture({
    tokenName: 'ARGO-S Tokenized Share',
    tokenSymbol: 'ARGOS',
    claimTopicLabel: 'ARGO_KYC_APPROVED',
    aliceInitialBalance: 60_000_000,
    bobInitialBalance: 0,
  });

  const manifest = {
    project: 'ARGO-S',
    network: network.name,
    token: deployment.suite.token.address,
    identityRegistry: deployment.suite.identityRegistry.address,
    identityRegistryStorage: deployment.suite.identityRegistryStorage.address,
    claimTopicsRegistry: deployment.suite.claimTopicsRegistry.address,
    trustedIssuersRegistry: deployment.suite.trustedIssuersRegistry.address,
    compliance: deployment.suite.defaultCompliance.address,
    claimIssuer: deployment.suite.claimIssuerContract.address,
    trexFactory: deployment.factories.trexFactory.address,
    identityFactory: deployment.factories.identityFactory.address,
    deployer: await deployment.accounts.deployer.getAddress(),
    tokenAgent: await deployment.accounts.tokenAgent.getAddress(),
    demoVerifiedInvestor: await deployment.accounts.aliceWallet.getAddress(),
    demoSecondInvestor: await deployment.accounts.bobWallet.getAddress(),
    demoUnverifiedInvestor: await deployment.accounts.charlieWallet.getAddress(),
  };

  const outputDirectory = join(process.cwd(), 'deployments');
  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, `${network.name}.json`);
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8' });

  console.log(JSON.stringify(manifest, null, 2));
  console.log(`Deployment manifest: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
