import { randomBytes } from 'crypto';
import { BlockchainEnrollmentResult, BlockchainPort, EnrollmentProgress, Investor } from './domain';

/// Deterministic integration boundary for local onboarding before a persistent
/// Hardhat node is connected. It records operations without holding private keys.
export class MockBlockchainPort implements BlockchainPort {
  readonly enrollments: Array<{ investorId: string; walletAddress?: string }> = [];
  readonly mints: Array<{ walletAddress: string; amount: string }> = [];

  async enrollInvestor(investor: Investor, resume: EnrollmentProgress = {}, onProgress?: (progress: EnrollmentProgress) => Promise<void>): Promise<BlockchainEnrollmentResult> {
    this.enrollments.push({ investorId: investor.id, walletAddress: investor.walletAddress });
    const identityAddress = resume.identityAddress ?? `0x${randomBytes(20).toString('hex')}`;
    await onProgress?.({ identityAddress });
    const result = {
      identityAddress,
      claimTransactionHash: `0x${randomBytes(32).toString('hex')}`,
      registrationTransactionHash: `0x${randomBytes(32).toString('hex')}`,
    };
    await onProgress?.(result);
    return result;
  }

  async mint(walletAddress: string, amount: string, _expectedBalanceAfter: string): Promise<{ transactionHash: string }> {
    this.mints.push({ walletAddress, amount });
    return { transactionHash: `0x${randomBytes(32).toString('hex')}` };
  }

  async health(): Promise<{ chainId: number; blockNumber: number }> { return { chainId: 31337, blockNumber: 1 }; }
  async tokenInfo(): Promise<{ address: string; name: string; symbol: string; decimals: number }> {
    return { address: '0x0000000000000000000000000000000000000001', name: 'ARGO-S', symbol: 'ARGOS', decimals: 0 };
  }
}
