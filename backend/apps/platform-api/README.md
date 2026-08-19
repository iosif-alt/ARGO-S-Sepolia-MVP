# ARGO-S platform API foundation

This local service implements the investor onboarding state machine before a
real KYC provider, PostgreSQL driver or ERC-3643 signer is connected.

Implemented controls:

- unique investor registration;
- explicit KYC states;
- HMAC-authenticated and idempotent mock KYC webhooks;
- Ethereum wallet ownership challenge and signature verification;
- one-time challenge expiry/replay protection;
- maker-checker actions for on-chain enrollment and mint;
- append-only audit events;
- integer-only token amounts;
- PostgreSQL production schema;
- blockchain port with a local mock adapter.

Run tests:

```bash
npm run test:platform-api
```

Run local HTTP service:

```bash
KYC_WEBHOOK_SECRET=local-development-secret npm run start:platform-api
```

The HTTP layer currently uses an in-memory repository and mock blockchain. It
must not be exposed to the internet. Authentication, RBAC, PostgreSQL runtime
adapter, EIP-1271 wallet verification and the real ERC-3643 worker are the next
implementation gate.

## Local ERC-3643 mode

After a persistent Hardhat node and the v2 suite are running, set:

```text
ARGO_BLOCKCHAIN_MODE=erc3643
ARGO_RPC_URL=http://127.0.0.1:8545
ARGO_MANIFEST_PATH=deployments/localhost-v2.json
ARGO_OPERATOR_PRIVATE_KEY=<local Hardhat account only>
ARGO_CLAIM_SIGNER_PRIVATE_KEY=<local Hardhat account only>
```

This mode deploys an investor OnchainID, adds the KYC claim, registers the
wallet in IdentityRegistry and sends token mint transactions. The local operator
identity model is intentionally temporary and must not be copied to production.
