# ARGO-S ERC-3643 MVP v2 foundation

## Scope

MVP v2 preserves the upstream ERC-3643 contracts and adds project-owned
compliance policy modules. It is a testnet foundation, not an investment
offering or a Mainnet release.

## Project-owned contracts

### `ARGOSupplyLimitModule`

The module stores an immutable authorized supply limit. A mint is accepted only
when `current totalSupply + mint amount <= authorized supply`. A post-mint check
provides defense in depth and reverts the complete mint transaction if the
invariant is violated.

### `ARGOAllowedCountriesModule`

The module uses the investor country stored in `IdentityRegistry`. Its policy is
default-deny: a recipient country must be explicitly enabled through the owning
`ModularCompliance` contract.

The numeric country value is only a technical attribute. Legal counsel must
define the authoritative coding system and the countries/investor categories
allowed for a real offering.

## Deployment safety

The v2 public deployment:

- deploys `ModularComplianceProxy` instead of `DefaultCompliance`;
- binds both ARGO-S modules;
- starts paused with zero supply;
- writes implementation addresses into a v2 manifest;
- supports a separate governance owner address;
- does not create or onboard investors;
- does not mint tokens.

Environment variables:

```text
GOVERNANCE_OWNER_ADDRESS=<testnet Safe>
ARGO_AUTHORIZED_SUPPLY=60000000
ARGO_ALLOWED_COUNTRIES=
```

An empty `ARGO_ALLOWED_COUNTRIES` value intentionally blocks every mint and
transfer until the policy is configured.

## Validation

```bash
npm run build
npm run test:argo:v2
```

The v2 tests cover:

- transfers inside allowed countries;
- rejection after a country becomes disallowed;
- explicit country approval;
- minting exactly to the authorized limit;
- rejection one unit above the limit;
- preservation of the supply invariant across mint, transfer and burn cycles.

## Known limits

- The modules have not received an independent security audit.
- Country eligibility alone is not sufficient for EU securities compliance.
- Claim expiry, investor class, lockups, holder limits and approved-venue rules
  are not yet implemented.
- Production roles must be separate multisig or controlled service identities.
- The deployment manifest still needs transaction receipts and bytecode hashes.
