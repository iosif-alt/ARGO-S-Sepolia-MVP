# ARGO-S V2 — Nile payment and Sepolia issuance

## 1. Configuration

Copy `.env.runtime.example` to `.env.runtime` and fill the RPC URL, private keys, Google Client ID and the three role emails locally. Never commit or send `.env.runtime`.

Google OAuth Web Client must allow `http://localhost:3000` as an authorized JavaScript origin.

## 2. Preflight

The deployment wallet must resolve to `0x7379F90005c21c7E93Dae59c7e0c9d769036C501`, have no pending transaction and have enough Sepolia ETH. Confirm the configured addresses before continuing.

## 3. Deploy ARGOS V2 once

```bash
docker compose --env-file .env.runtime --profile deploy run --rm deployer
```

The command must create `backend/deployments/ethereumSepolia-v2.json`. Preserve this manifest. Do not run deployment again after success.

## 4. Start the local platform

```bash
docker compose --env-file .env.runtime up --build postgres api web
```

Open `http://localhost:3000`.

## 5. Test scenario

1. Investor signs in with the assigned Google account.
2. Investor completes demo-KYC and signs the MetaMask challenge using the intended Sepolia account. The completed reference test used `0xdBe644F34b46cf1e3E74B4D96085C88cc19E52FF`.
3. Investor creates the fixed order: 100 Nile tUSDT for 1,000 ARGOS.
4. Investor transfers exactly 100 tUSDT from `TLcVKMx3oh2AZ57g3dDXXZ1TH7cGgoVWjs` to `TUYfr6A9jtEgoePyewjFKwspVXcx34A4XS` using token `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`.
5. Investor submits the 64-character TRON txID. Backend accepts only a confirmed matching transfer and prevents txID reuse.
6. Maker signs in and requests on-chain enrollment for the investor UUID.
7. Checker signs in and approves the request.
8. Maker confirms documents and payment, then creates a mint request for 1,000 ARGOS.
9. Checker approves the mint request.
10. Investor cabinet refreshes automatically and shows `INVESTED`, the linked order as `COMPLETED`, 1,000 ARGOS and the Ethereum transaction.

## Upgrade an existing local installation

The API applies additive PostgreSQL migrations automatically during startup. The existing deployment manifest, OnchainID records and ARGOS balances remain unchanged; do not redeploy the token.

```bash
docker compose --env-file .env.runtime exec -T postgres \
  pg_dump -U argos -d argos > argo-s-before-upgrade.sql

docker compose --env-file .env.runtime up -d --build postgres api web
docker compose --env-file .env.runtime ps -a
curl http://localhost:3001/health
```

The hardened workflow links every mint request to one verified payment order, blocks concurrent Checker execution, records processing failures and stores the Ethereum mint hash on the completed order.

## Safety

This is a testnet system with demo-KYC and test assets. Do not accept real money, expose ports to the internet, reuse the test keys on mainnet, or describe tUSDT/ARGOS as having guaranteed monetary value.
