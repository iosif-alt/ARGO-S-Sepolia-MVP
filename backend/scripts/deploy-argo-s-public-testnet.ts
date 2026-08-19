import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { BigNumber, Contract, Signer } from 'ethers';
import { ethers, network } from 'hardhat';
import OnchainID from '@onchain-id/solidity';

async function waitForDeployment<T extends Contract>(contract: T, label: string): Promise<T> {
  // Public RPC endpoints may return a stale pending nonce if deployments are
  // broadcast too quickly. Waiting here guarantees strictly sequential nonces.
  console.log(`Waiting for ${label}: ${contract.deployTransaction.hash}`);
  await contract.deployed();
  console.log(`Deployed ${label}: ${contract.address}`);
  return contract;
}

async function deployIdentityProxy(implementationAuthority: Contract['address'], managementKey: string, signer: Signer) {
  // Each identity proxy points to the shared audited OnchainID implementation.
  const proxy = await new ethers.ContractFactory(
    OnchainID.contracts.IdentityProxy.abi,
    OnchainID.contracts.IdentityProxy.bytecode,
    signer,
  ).deploy(implementationAuthority, managementKey);
  await proxy.deployed();
  return ethers.getContractAt('Identity', proxy.address, signer);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error('DEPLOYER_PRIVATE_KEY is required for a public testnet deployment');
  }

  const deployerAddress = await deployer.getAddress();
  if (!deployer.provider) {
    throw new Error('The deployer is not connected to an RPC provider');
  }

  // Refuse to start while the wallet already has a pending transaction. This
  // avoids accidental nonce replacement and duplicate partial deployments.
  const latestNonce = await deployer.provider.getTransactionCount(deployerAddress, 'latest');
  const pendingNonce = await deployer.provider.getTransactionCount(deployerAddress, 'pending');
  const balance = await deployer.getBalance();
  console.log(`Deployer: ${deployerAddress}`);
  console.log(`Balance: ${ethers.utils.formatEther(balance)} ETH`);
  console.log(`Nonce: latest=${latestNonce}, pending=${pendingNonce}`);
  if (pendingNonce !== latestNonce) {
    throw new Error('The deployer has a pending transaction. Wait for confirmation or replace/cancel it before retrying.');
  }

  const tokenAgentAddress = process.env.TOKEN_AGENT_ADDRESS ?? deployerAddress;
  const identityAdminAddress = process.env.IDENTITY_ADMIN_ADDRESS ?? deployerAddress;
  const claimSignerAddress = process.env.CLAIM_SIGNER_ADDRESS ?? deployerAddress;
  const governanceOwnerAddress = process.env.GOVERNANCE_OWNER_ADDRESS ?? deployerAddress;
  const authorizedSupply = BigNumber.from(process.env.ARGO_AUTHORIZED_SUPPLY ?? '60000000');
  const allowedCountries = (process.env.ARGO_ALLOWED_COUNTRIES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const country = Number(value);
      if (!Number.isInteger(country) || country < 0 || country > 65_535) {
        throw new Error(`Invalid uint16 country code: ${value}`);
      }
      return country;
    });

  if (authorizedSupply.lte(0)) {
    throw new Error('ARGO_AUTHORIZED_SUPPLY must be greater than zero');
  }

  // Deploy shared T-REX and OnchainID implementations.
  const claimTopicsRegistryImplementation = await waitForDeployment(
    await ethers.deployContract('ClaimTopicsRegistry', deployer),
    'ClaimTopicsRegistry implementation',
  );
  const trustedIssuersRegistryImplementation = await waitForDeployment(
    await ethers.deployContract('TrustedIssuersRegistry', deployer),
    'TrustedIssuersRegistry implementation',
  );
  const identityRegistryStorageImplementation = await waitForDeployment(
    await ethers.deployContract('IdentityRegistryStorage', deployer),
    'IdentityRegistryStorage implementation',
  );
  const identityRegistryImplementation = await waitForDeployment(
    await ethers.deployContract('IdentityRegistry', deployer),
    'IdentityRegistry implementation',
  );
  const modularComplianceImplementation = await waitForDeployment(
    await ethers.deployContract('ModularCompliance', deployer),
    'ModularCompliance implementation',
  );
  const tokenImplementation = await waitForDeployment(await ethers.deployContract('Token', deployer), 'Token implementation');
  const identityImplementation = await waitForDeployment(
    await new ethers.ContractFactory(OnchainID.contracts.Identity.abi, OnchainID.contracts.Identity.bytecode, deployer).deploy(
      deployerAddress,
      true,
    ),
    'OnchainID implementation',
  );

  const identityImplementationAuthority = await waitForDeployment(
    await new ethers.ContractFactory(
      OnchainID.contracts.ImplementationAuthority.abi,
      OnchainID.contracts.ImplementationAuthority.bytecode,
      deployer,
    ).deploy(identityImplementation.address),
    'OnchainID implementation authority',
  );

  const identityFactory = await waitForDeployment(
    await new ethers.ContractFactory(OnchainID.contracts.Factory.abi, OnchainID.contracts.Factory.bytecode, deployer).deploy(
      identityImplementationAuthority.address,
    ),
    'OnchainID factory',
  );

  const trexImplementationAuthority = await waitForDeployment(
    await ethers.deployContract(
      'TREXImplementationAuthority',
      [true, ethers.constants.AddressZero, ethers.constants.AddressZero],
      deployer,
    ),
    'T-REX implementation authority',
  );

  await (
    await trexImplementationAuthority.addAndUseTREXVersion(
      { major: 4, minor: 0, patch: 0 },
      {
        tokenImplementation: tokenImplementation.address,
        ctrImplementation: claimTopicsRegistryImplementation.address,
        irImplementation: identityRegistryImplementation.address,
        irsImplementation: identityRegistryStorageImplementation.address,
        tirImplementation: trustedIssuersRegistryImplementation.address,
        mcImplementation: modularComplianceImplementation.address,
      },
    )
  ).wait();

  const trexFactory = await waitForDeployment(
    await ethers.deployContract('TREXFactory', [trexImplementationAuthority.address, identityFactory.address], deployer),
    'T-REX factory',
  );
  await (await identityFactory.addTokenFactory(trexFactory.address)).wait();

  // Deploy the ARGO-S proxy suite.
  const claimTopicsRegistryProxy = await waitForDeployment(
    await ethers.deployContract('ClaimTopicsRegistryProxy', [trexImplementationAuthority.address], deployer),
    'ClaimTopicsRegistry proxy',
  );
  const claimTopicsRegistry = await ethers.getContractAt('ClaimTopicsRegistry', claimTopicsRegistryProxy.address, deployer);
  const trustedIssuersRegistryProxy = await waitForDeployment(
    await ethers.deployContract('TrustedIssuersRegistryProxy', [trexImplementationAuthority.address], deployer),
    'TrustedIssuersRegistry proxy',
  );
  const trustedIssuersRegistry = await ethers.getContractAt('TrustedIssuersRegistry', trustedIssuersRegistryProxy.address, deployer);
  const identityRegistryStorageProxy = await waitForDeployment(
    await ethers.deployContract('IdentityRegistryStorageProxy', [trexImplementationAuthority.address], deployer),
    'IdentityRegistryStorage proxy',
  );
  const identityRegistryStorage = await ethers.getContractAt('IdentityRegistryStorage', identityRegistryStorageProxy.address, deployer);
  const modularComplianceProxy = await waitForDeployment(
    await ethers.deployContract('ModularComplianceProxy', [trexImplementationAuthority.address], deployer),
    'ModularCompliance proxy',
  );
  const modularCompliance = await ethers.getContractAt('ModularCompliance', modularComplianceProxy.address, deployer);
  const identityRegistryProxy = await waitForDeployment(
    await ethers.deployContract(
      'IdentityRegistryProxy',
      [trexImplementationAuthority.address, trustedIssuersRegistry.address, claimTopicsRegistry.address, identityRegistryStorage.address],
      deployer,
    ),
    'IdentityRegistry proxy',
  );
  const identityRegistry = await ethers.getContractAt('IdentityRegistry', identityRegistryProxy.address, deployer);

  const tokenIdentity = await deployIdentityProxy(identityImplementationAuthority.address, deployerAddress, deployer);
  const tokenProxy = await waitForDeployment(
    await ethers.deployContract(
      'TokenProxy',
      [
        trexImplementationAuthority.address,
        identityRegistry.address,
        modularCompliance.address,
        'ARGO-S Tokenized Share',
        'ARGOS',
        BigNumber.from(0),
        tokenIdentity.address,
      ],
      deployer,
    ),
    'ARGO-S token proxy',
  );
  const token = await ethers.getContractAt('Token', tokenProxy.address, deployer);

  // ARGO-S policy modules are bound only after Token.init has linked the token
  // to ModularCompliance. The country policy starts in default-deny mode.
  const supplyLimitModule = await waitForDeployment(
    await ethers.deployContract('ARGOSupplyLimitModule', [authorizedSupply], deployer),
    'ARGO-S supply limit module',
  );
  const allowedCountriesModule = await waitForDeployment(
    await ethers.deployContract('ARGOAllowedCountriesModule', deployer),
    'ARGO-S allowed countries module',
  );
  await (await modularCompliance.addModule(supplyLimitModule.address)).wait();
  await (await modularCompliance.addModule(allowedCountriesModule.address)).wait();
  if (allowedCountries.length > 0) {
    const policyCall = allowedCountriesModule.interface.encodeFunctionData('batchSetCountriesAllowed', [allowedCountries, true]);
    await (await modularCompliance.callModuleFunction(policyCall, allowedCountriesModule.address)).wait();
  }

  // Configure the registry and one KYC claim type. The token remains paused and
  // has zero supply until investor onboarding is implemented and reviewed.
  await (await identityRegistryStorage.bindIdentityRegistry(identityRegistry.address)).wait();
  await (await token.addAgent(tokenAgentAddress)).wait();
  await (await identityRegistry.addAgent(identityAdminAddress)).wait();
  await (await identityRegistry.addAgent(token.address)).wait();

  const kycClaimTopic = ethers.utils.id('ARGO_KYC_APPROVED');
  await (await claimTopicsRegistry.addClaimTopic(kycClaimTopic)).wait();
  const claimIssuer = await waitForDeployment(
    await ethers.deployContract('ClaimIssuer', [deployerAddress], deployer),
    'KYC claim issuer',
  );
  const claimSignerKey = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['address'], [claimSignerAddress]));
  await (await claimIssuer.addKey(claimSignerKey, 3, 1)).wait();
  await (await trustedIssuersRegistry.addTrustedIssuer(claimIssuer.address, [kycClaimTopic])).wait();

  // Ownership is handed to the configured governance address only after the
  // suite is fully initialized. Test deployments may intentionally use the deployer.
  const governedContracts = [
    token,
    identityRegistry,
    identityRegistryStorage,
    claimTopicsRegistry,
    trustedIssuersRegistry,
    modularCompliance,
    trexImplementationAuthority,
    identityImplementationAuthority,
    trexFactory,
    identityFactory,
  ];
  if (governanceOwnerAddress.toLowerCase() !== deployerAddress.toLowerCase()) {
    for (const governedContract of governedContracts) {
      await (await governedContract.transferOwnership(governanceOwnerAddress)).wait();
    }
  }

  const manifest = {
    project: 'ARGO-S',
    deploymentVersion: 'MVP_V2_MODULAR_COMPLIANCE',
    network: network.name,
    chainId: network.config.chainId,
    status: 'PAUSED_ZERO_SUPPLY',
    token: token.address,
    tokenIdentity: tokenIdentity.address,
    identityRegistry: identityRegistry.address,
    identityRegistryStorage: identityRegistryStorage.address,
    claimTopicsRegistry: claimTopicsRegistry.address,
    trustedIssuersRegistry: trustedIssuersRegistry.address,
    compliance: modularCompliance.address,
    supplyLimitModule: supplyLimitModule.address,
    allowedCountriesModule: allowedCountriesModule.address,
    authorizedSupply: authorizedSupply.toString(),
    allowedCountries,
    claimIssuer: claimIssuer.address,
    trexImplementationAuthority: trexImplementationAuthority.address,
    identityImplementationAuthority: identityImplementationAuthority.address,
    trexFactory: trexFactory.address,
    identityFactory: identityFactory.address,
    implementations: {
      token: tokenImplementation.address,
      claimTopicsRegistry: claimTopicsRegistryImplementation.address,
      trustedIssuersRegistry: trustedIssuersRegistryImplementation.address,
      identityRegistryStorage: identityRegistryStorageImplementation.address,
      identityRegistry: identityRegistryImplementation.address,
      modularCompliance: modularComplianceImplementation.address,
      onchainIdentity: identityImplementation.address,
    },
    deployer: deployerAddress,
    tokenAgent: tokenAgentAddress,
    identityAdmin: identityAdminAddress,
    claimSigner: claimSignerAddress,
    governanceOwner: governanceOwnerAddress,
  };

  const outputDirectory = join(process.cwd(), 'deployments');
  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, `${network.name}-v2.json`);
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8' });
  console.log(JSON.stringify(manifest, null, 2));
  console.log(`Deployment manifest: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
