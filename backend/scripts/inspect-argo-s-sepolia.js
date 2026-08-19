const { ethers } = require('ethers');

const rpc = process.env.ETHEREUM_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const provider = new ethers.providers.JsonRpcProvider(rpc);
const manifest = require('../../upload/ethereumSepolia.json');

const ownable = ['function owner() view returns (address)'];
const agent = [...ownable, 'function isAgent(address) view returns (bool)'];
const tokenAbi = [
  ...agent,
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function paused() view returns (bool)',
  'function identityRegistry() view returns (address)',
  'function compliance() view returns (address)',
  'function onchainID() view returns (address)',
];

async function safe(label, fn) {
  try { return [label, await fn()]; } catch (error) { return [label, `ERROR: ${error.reason || error.message}`]; }
}

async function inspectOwnable(label, address, abi = ownable) {
  const contract = new ethers.Contract(address, abi, provider);
  const entries = [await safe('codeBytes', async () => (await provider.getCode(address)).length / 2 - 1)];
  if (abi.some((item) => item.includes('owner()'))) entries.push(await safe('owner', () => contract.owner()));
  if (abi.some((item) => item.includes('isAgent'))) entries.push(await safe('deployerIsAgent', () => contract.isAgent(manifest.deployer)));
  return [label, Object.fromEntries(entries)];
}

async function main() {
  const token = new ethers.Contract(manifest.token, tokenAbi, provider);
  const tokenEntries = await Promise.all([
    safe('codeBytes', async () => (await provider.getCode(manifest.token)).length / 2 - 1),
    safe('owner', () => token.owner()),
    safe('deployerIsAgent', () => token.isAgent(manifest.deployer)),
    safe('name', () => token.name()), safe('symbol', () => token.symbol()),
    safe('decimals', () => token.decimals()), safe('totalSupply', async () => (await token.totalSupply()).toString()),
    safe('paused', () => token.paused()), safe('identityRegistry', () => token.identityRegistry()),
    safe('compliance', () => token.compliance()), safe('onchainID', () => token.onchainID()),
  ]);
  const results = [
    ['chain', { chainId: (await provider.getNetwork()).chainId, block: await provider.getBlockNumber() }],
    ['token', Object.fromEntries(tokenEntries)],
    await inspectOwnable('identityRegistry', manifest.identityRegistry, agent),
    await inspectOwnable('identityRegistryStorage', manifest.identityRegistryStorage, agent),
    await inspectOwnable('claimTopicsRegistry', manifest.claimTopicsRegistry),
    await inspectOwnable('trustedIssuersRegistry', manifest.trustedIssuersRegistry),
    await inspectOwnable('compliance', manifest.compliance),
    await inspectOwnable('claimIssuer', manifest.claimIssuer),
    await inspectOwnable('trexImplementationAuthority', manifest.trexImplementationAuthority),
    await inspectOwnable('identityImplementationAuthority', manifest.identityImplementationAuthority),
    await inspectOwnable('trexFactory', manifest.trexFactory),
    await inspectOwnable('identityFactory', manifest.identityFactory),
  ];
  console.log(JSON.stringify(Object.fromEntries(results), null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
