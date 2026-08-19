import { readFileSync } from 'fs';
import { ethers } from 'ethers';
import OnchainID from '@onchain-id/solidity';
import { BlockchainEnrollmentResult, BlockchainPort, DomainError, EnrollmentProgress, Investor } from './domain';

interface DeploymentManifest {
  token: string;
  identityRegistry: string;
  claimIssuer: string;
  identityImplementationAuthority: string;
}

export interface Erc3643BlockchainConfig {
  rpcUrl: string;
  operatorPrivateKey: string;
  claimSignerPrivateKey: string;
  manifestPath: string;
  claimTopicLabel: string;
}

/// Local ERC-3643 integration adapter. For the MVP the operator temporarily
/// manages identity creation; production must replace this with a reviewed
/// custody and investor-controlled identity ceremony.
export class Erc3643BlockchainPort implements BlockchainPort {
  private readonly provider: ethers.providers.JsonRpcProvider;
  private readonly operator: ethers.Wallet;
  private readonly claimSigner: ethers.Wallet;
  private readonly manifest: DeploymentManifest;
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(private readonly config: Erc3643BlockchainConfig) {
    this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
    this.operator = new ethers.Wallet(config.operatorPrivateKey, this.provider);
    this.claimSigner = new ethers.Wallet(config.claimSignerPrivateKey);
    this.manifest = JSON.parse(readFileSync(config.manifestPath, 'utf8')) as DeploymentManifest;
  }

  async enrollInvestor(
    investor: Investor,
    resume: EnrollmentProgress = {},
    onProgress?: (progress: EnrollmentProgress) => Promise<void>,
  ): Promise<BlockchainEnrollmentResult> {
    return this.withTransactionLock(() => this.enrollInvestorUnlocked(investor, resume, onProgress));
  }

  private async enrollInvestorUnlocked(
    investor: Investor,
    resume: EnrollmentProgress = {},
    onProgress?: (progress: EnrollmentProgress) => Promise<void>,
  ): Promise<BlockchainEnrollmentResult> {
    if (!investor.walletAddress) throw new DomainError('WALLET_REQUIRED', 'Investor wallet is required');

    const registry = new ethers.Contract(
      this.manifest.identityRegistry,
      [
        'function registerIdentity(address,address,uint16)',
        'function isVerified(address) view returns (bool)',
        'function identity(address) view returns (address)',
      ],
      this.operator,
    );
    const registeredIdentity = await registry.identity(investor.walletAddress);
    let identityAddress = resume.identityAddress ?? (registeredIdentity !== ethers.constants.AddressZero ? registeredIdentity : undefined);
    if (!identityAddress) {
      const proxy = await new ethers.ContractFactory(
        OnchainID.contracts.IdentityProxy.abi,
        OnchainID.contracts.IdentityProxy.bytecode,
        this.operator,
      ).deploy(this.manifest.identityImplementationAuthority, this.operator.address);
      await this.waitSuccessful(proxy.deployTransaction);
      identityAddress = proxy.address;
      await onProgress?.({ identityAddress });
    }

    const identity = new ethers.Contract(identityAddress, OnchainID.contracts.Identity.abi, this.operator);
    const investorManagementKey = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(['address'], [investor.walletAddress]),
    );
    if (!(await identity.keyHasPurpose(investorManagementKey, 1))) {
      await this.waitSuccessful(await identity.addKey(investorManagementKey, 1, 1));
    }

    const topic = ethers.utils.id(this.config.claimTopicLabel);
    const data = ethers.utils.hexlify(
      ethers.utils.toUtf8Bytes(JSON.stringify({ investorId: investor.id, country: investor.country, expiresAt: investor.kycExpiresAt })),
    );
    const digest = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(['address', 'uint256', 'bytes'], [identity.address, topic, data]),
    );
    const signature = await this.claimSigner.signMessage(ethers.utils.arrayify(digest));
    let claimTransactionHash = resume.claimTransactionHash ?? ethers.constants.HashZero;
    const claimIds: string[] = await identity.getClaimIdsByTopic(topic);
    let issuerClaimExists = false;
    for (const claimId of claimIds) {
      const claim = await identity.getClaim(claimId);
      if (String(claim.issuer).toLowerCase() === this.manifest.claimIssuer.toLowerCase()) issuerClaimExists = true;
    }
    if (!issuerClaimExists) {
      const claimReceipt = await this.waitSuccessful(await identity.addClaim(topic, 1, this.manifest.claimIssuer, signature, data, ''));
      claimTransactionHash = claimReceipt.transactionHash;
      await onProgress?.({ identityAddress, claimTransactionHash });
    }

    let registrationTransactionHash = resume.registrationTransactionHash ?? ethers.constants.HashZero;
    if (!(await registry.isVerified(investor.walletAddress))) {
      const registrationReceipt = await this.waitSuccessful(
        await registry.registerIdentity(investor.walletAddress, identity.address, investor.country),
      );
      registrationTransactionHash = registrationReceipt.transactionHash;
      await onProgress?.({ identityAddress, claimTransactionHash, registrationTransactionHash });
    }
    if (!(await registry.isVerified(investor.walletAddress))) {
      throw new DomainError('ONCHAIN_VERIFICATION_FAILED', 'Identity registration did not produce a verified investor');
    }

    return {
      identityAddress: identity.address,
      claimTransactionHash,
      registrationTransactionHash,
    };
  }

  async mint(walletAddress: string, amount: string, expectedBalanceAfter: string): Promise<{ transactionHash: string; alreadyApplied?: boolean }> {
    return this.withTransactionLock(() => this.mintUnlocked(walletAddress, amount, expectedBalanceAfter));
  }

  private async mintUnlocked(walletAddress: string, amount: string, expectedBalanceAfter: string): Promise<{ transactionHash: string; alreadyApplied?: boolean }> {
    const token = new ethers.Contract(
      this.manifest.token,
      ['function mint(address,uint256)', 'function balanceOf(address) view returns (uint256)'],
      this.operator,
    );
    const currentBalance = await token.balanceOf(walletAddress);
    if (currentBalance.gte(expectedBalanceAfter)) {
      return { transactionHash: ethers.constants.HashZero, alreadyApplied: true };
    }
    const receipt = await this.waitSuccessful(await token.mint(walletAddress, amount));
    return { transactionHash: receipt.transactionHash };
  }

  async health(): Promise<{ chainId: number; blockNumber: number }> {
    const [network, blockNumber] = await Promise.all([this.provider.getNetwork(), this.provider.getBlockNumber()]);
    return { chainId: network.chainId, blockNumber };
  }

  async tokenInfo(): Promise<{ address: string; name: string; symbol: string; decimals: number }> {
    const token = new ethers.Contract(
      this.manifest.token,
      ['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)'],
      this.provider,
    );
    const [name, symbol, decimals] = await Promise.all([token.name(), token.symbol(), token.decimals()]);
    return { address: this.manifest.token, name, symbol, decimals };
  }

  /// Serializes every transaction sequence emitted by the shared MVP operator.
  /// Production should move this boundary to a distributed signer/HSM queue.
  private async withTransactionLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  /// Accepts a mined replacement only when it carries the same destination,
  /// calldata and value. A speed-up is therefore successful, while a cancel
  /// or unrelated nonce replacement remains an error.
  private async waitSuccessful(transaction: ethers.providers.TransactionResponse): Promise<ethers.providers.TransactionReceipt> {
    try {
      return await transaction.wait();
    } catch (error) {
      const replacementError = error as any;
      const replacement = replacementError.replacement as ethers.providers.TransactionResponse | undefined;
      const receipt = replacementError.receipt as ethers.providers.TransactionReceipt | undefined;
      const sameCall = replacement
        && (replacement.to ?? '').toLowerCase() === (transaction.to ?? '').toLowerCase()
        && replacement.data === transaction.data
        && replacement.value.eq(transaction.value);
      if (replacementError.code === 'TRANSACTION_REPLACED' && sameCall && receipt?.status === 1) return receipt;
      throw error;
    }
  }
}
