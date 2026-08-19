# ARGO-S hardened MVP upgrade

This upgrade does not redeploy ARGOS or change existing token balances.

## Implemented

- Atomic `PENDING → PROCESSING` Checker claim prevents double execution.
- `FAILED` actions retain a safe error and can be resumed by Checker.
- Successful same-call Ethereum replacement transactions are accepted.
- OnchainID progress is persisted and enrollment can resume from the saved identity.
- Repeated enrollment checks the ERC-3643 Identity Registry before creating another identity.
- Mint amount must equal a confirmed investment order.
- Mint action and investment order are linked.
- Completed order stores the Ethereum transaction hash and completion time.
- Direct TRON txID event lookup avoids the 200-transfer account-history limitation.
- Deep health response checks PostgreSQL and Ethereum RPC.
- API emits structured request status and latency logs.
- Docker services restart automatically and the web waits for a healthy API.
- Investor, Maker and Checker views auto-refresh every eight seconds.
- Operator UI exposes only the valid next action, action queue, failures, orders and audit trail.
- Investor UI shows a four-stage order timeline, explorer links, copy controls and MetaMask token import.

## Safe update

```bash
cd ~/Downloads/ARGO-S-Sepolia-MVP

docker compose --env-file .env.runtime exec -T postgres \
  pg_dump -U argos -d argos > argo-s-before-upgrade.sql

docker compose --env-file .env.runtime up -d --build postgres api web

docker compose --env-file .env.runtime ps -a
curl http://localhost:3001/health
```

Expected health response includes `status: ok`, PostgreSQL `ok`, chain ID `11155111` and the latest Sepolia block.

## Production boundaries

The following require external organizational decisions and cannot be safely simulated as production controls:

- Replace demo-KYC with a contracted KYC/AML provider and signed webhooks.
- Move operator, issuer and deployment authority from one hot key to separate HSM/MPC or multisig policies.
- Add an independent security audit, incident response, backups and regulated legal documentation.
- Use dedicated authenticated Ethereum and TronGrid providers with monitoring and rate-limit alerts.
- Run the platform behind TLS, a secret manager, WAF/rate limiting and managed PostgreSQL.

Do not accept real investor funds until these controls and the applicable securities-law structure are approved.
