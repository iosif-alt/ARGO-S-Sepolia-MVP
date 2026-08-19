# ARGO-S testnet MVP

## Purpose

ARGO-S is a technical prototype of a permissioned tokenized share. It has no
legal effect, carries no investment promise, and must not receive real money.

## Fixed testnet parameters

| Parameter | Value |
| --- | --- |
| Display name | ARGO-S Tokenized Share |
| On-chain symbol | ARGOS |
| Decimals | 0 |
| Initial issued supply | 60,000,000 |
| Required claim | `ARGO_KYC_APPROVED` |
| Preferred target network | Ethereum Sepolia (`11155111`) |
| Alternative target network | Base Sepolia (`84532`) |

## MVP trust model

- The deployer configures the T-REX implementation authority and factories.
- The token agent may mint, pause, freeze, recover, and unfreeze shares.
- The identity registry accepts wallets registered by an authorised agent.
- A trusted claim issuer signs the KYC claim stored in an investor OnchainID.
- The token rejects transfers when either side is not eligible.

The generated Hardhat accounts are demonstration identities only. Production
roles must be assigned to separate Safe multisignature accounts.

## Local validation

```bash
npm install --ignore-scripts
npm run test:argo
npm run deploy:local
```

The deployment command writes public contract addresses to
`deployments/hardhat.json`. A plain `hardhat run` network is ephemeral; use a
persistent `hardhat node` plus `--network localhost` when the addresses must
remain usable after the script exits.

## Ethereum Sepolia deployment

1. Create a dedicated testnet-only wallet.
2. Obtain Ethereum Sepolia ETH from a reputable faucet.
3. Copy `.env.example` to `.env` and load the variables into the shell.
4. Run `npm run deploy:ethereum-sepolia`.
5. Record and independently verify every deployed address.
6. Move privileged roles to a Safe before allowing external testers.

Never commit a private key. The deployment is not production-ready until the
contracts, configuration, operational controls, and legal share-register link
have been independently reviewed.

The public-network deployment intentionally creates zero shares and leaves the
token paused. It does not create demo investors or embed their keys. Investor
onboarding, initial minting, and unpausing are separate controlled operations.
