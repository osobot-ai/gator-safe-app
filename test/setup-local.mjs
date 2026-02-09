#!/usr/bin/env node
/**
 * setup-local.mjs
 * 
 * Sets up the local Anvil environment:
 * 1. Creates a 2/3 Safe multisig using Safe SDK
 * 2. Deploys DeleGatorModuleFactory via forge
 * 3. Deploys DeleGatorModule for the Safe
 * 4. Enables the module on the Safe
 * 
 * Prerequisites: Anvil must be running (npm run test:anvil)
 */

import { createWalletClient, createPublicClient, http, parseAbi, encodeFunctionData, encodeAbiParameters } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Config ────────────────────────────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545'

const DELEGATION_MANAGER = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3'

// DeleGatorModuleFactory creation bytecode (compiled from delegator-safe-module)
// Constructor takes DelegationManager address as argument
const FACTORY_BYTECODE = '0x60c060405234801561001057600080fd5b5060405161151e38038061151e83398101604081905261002f91610096565b6001600160a01b03811660a052604051819061004a90610089565b6001600160a01b039091168152602001604051809103906000f080158015610076573d6000803e3d6000fd5b506001600160a01b0316608052506100c6565b610fb68061056883390190565b6000602082840312156100a857600080fd5b81516001600160a01b03811681146100bf57600080fd5b9392505050565b60805160a05161046a6100fe600039600060df015260008181608d0152818161013a015281816101890152610218015261046a6000f3fe608060405234801561001057600080fd5b506004361061004c5760003560e01c806332c02a14146100515780635c60da1b14610088578063cb193942146100c7578063ea4d3c9b146100da575b600080fd5b61006461005f3660046103fc565b610101565b604080516001600160a01b0390931683529015156020830152015b60405180910390f35b6100af7f000000000000000000000000000000000000000000000000000000000000000081565b6040516001600160a01b03909116815260200161007f565b6100af6100d53660046103fc565b6101e1565b6100af7f000000000000000000000000000000000000000000000000000000000000000081565b60408051606084901b6bffffffffffffffffffffffff1916602082015281516014818303018152603490910190915260009081906101607f00000000000000000000000000000000000000000000000000000000000000008286610247565b604080516001600160a01b038381168252602082018990528415158284015291519296509294507f0000000000000000000000000000000000000000000000000000000000000000811692908816917fbc5571a9926fd80c2a664ae066e34fda5df3819e6992a8fdc1d5b66d68fc2f149181900360600190a3509250929050565b60408051606084901b6bffffffffffffffffffffffff1916602082015281516014818303018152603490910190915260009061023f7f0000000000000000000000000000000000000000000000000000000000000000828530610263565b949350505050565b6000806102576000868686610287565b91509150935093915050565b6000806102708686610360565b905061027d8185856103da565b9695505050505050565b60008060405184518060438301826020890160045afa506e5af43d82803e903d91602b57fd5bf360238301528660148301528060881b74fe61002d3d81600a3d39f3363d3d373d3d3d363d730161ffd2821183015260ff60005360378101600c8301206035523060601b6001528460155260556000209250823b61032a578460378201600c84018af59250826103255763301164256000526004601cfd5b610350565b600193508715610350576000386000388b875af16103505763b12d13eb6000526004601cfd5b5050600060355294509492505050565b6000604051825161ffd281113d3d3e60005b8181101561038f5760208186018101516043858401015201610372565b506e5af43d82803e903d91602b57fd5bf360238301528460148301528060881b7361002d3d81600a3d39f3363d3d373d3d3d363d7301825260378101600c8301209250505092915050565b600060ff60005350603592835260601b60015260155260556000908120915290565b6000806040838503121561040f57600080fd5b82356001600160a01b038116811461042657600080fd5b94602093909301359350505056fea264697066735822122034e240d963d2b15a8b133733c57bcd436a978469ac2bfbad8bc7accecb9a83fa64736f6c6343000817003360c060405234801561001057600080fd5b50604051610fb6380380610fb683398101604081905261002f91610044565b6001600160a01b03166080523060a052610074565b60006020828403121561005657600080fd5b81516001600160a01b038116811461006d57600080fd5b9392505050565b60805160a051610efa6100bc6000396000818161016a01528181610205015281816102d001528181610328015261054701526000818161013c01526103720152610efa6000f3fe6080604052600436106100555760003560e01c806301ffc9a71461005a5780631626ba7e1461008f578063186f0354146100c8578063d691c964146100f5578063e9ae5c5314610115578063ea4d3c9b1461012a575b600080fd5b34801561006657600080fd5b5061007a610075366004610a71565b61015e565b60405190151581526020015b60405180910390f35b34801561009b57600080fd5b506100af6100aa366004610ade565b6101f9565b6040516001600160e01b03199091168152602001610086565b3480156100d457600080fd5b506100dd6102c4565b6040516001600160a01b039091168152602001610086565b610108610103366004610ade565b61031c565b6040516100869190610b4e565b610128610123366004610ade565b61053d565b005b34801561013657600080fd5b506100dd7f000000000000000000000000000000000000000000000000000000000000000081565b60006001600160a01b037f00000000000000000000000000000000000000000000000000000000000000001630036101a9576040516317c62ee960e31b815260040160405180910390fd5b6001600160e01b031982166335a4725960e21b14806101d857506001600160e01b031982166301ffc9a760e01b145b806101f357506001600160e01b03198216630b135d3f60e11b145b92915050565b60006001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000163003610244576040516317c62ee960e31b815260040160405180910390fd5b61024c610660565b6001600160a01b0316631626ba7e8585856040518463ffffffff1660e01b815260040161027b93929190610bf1565b602060405180830381865afa158015610298573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906102bc9190610c14565b949350505050565b60006001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016300361030f576040516317c62ee960e31b815260040160405180910390fd5b610317610660565b905090565b60606001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000163003610367576040516317c62ee960e31b815260040160405180910390fd5b336001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016146103b057604051630692ce8160e21b815260040160405180910390fd5b34156103cf5760405163e320176b60e01b815260040160405180910390fd5b83600881901b6103e382600160f81b61067c565b1561044c573660006103f5878761068e565b909250905061040583600061067c565b1561041b576104148282610727565b9450610445565b6040516308c3ee0360e11b81526001600160f81b0319841660048201526024015b60405180910390fd5b5050610534565b61045782600061067c565b1561050f5760008036600061046c8989610800565b6040805160018082528183019092529498509296509094509250816020015b606081526020019060019003908161048b5790505096506104ad85600061067c565b156104e1576104be84848484610851565b876000815181106104d1576104d1610c47565b6020026020010181905250610506565b6040516308c3ee0360e11b81526001600160f81b03198616600482015260240161043c565b50505050610534565b604051632e5bf3f960e21b81526001600160f81b03198316600482015260240161043c565b50509392505050565b6001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000163003610586576040516317c62ee960e31b815260040160405180910390fd5b61058e610660565b6001600160a01b0316336001600160a01b0316146105bf57604051634ee2123760e11b815260040160405180910390fd5b82600881901b6105d382600160f81b61067c565b1561060c573660006105e5868661068e565b90925090506105f583600061067c565b1561041b5761060482826108ef565b505050610659565b61061782600061067c565b1561050f5760008036600061062c8888610800565b935093509350935061064285600060f81b61067c565b156104e157610653848484846109c0565b50505050505b5050505050565b600061066b306109f6565b61067490610c5d565b60601c905090565b6001600160f81b031990811691161490565b366000833580850160208587010360208201945081359350808460051b8301118360401c17156106c65763ba597e7e6000526004601cfd5b831561071d578392505b6001830392508260051b850135915081850160408101358082018381358201118460408501111782861782351760401c17156107145763ba597e7e6000526004601cfd5b505050826106d0575b5050509250929050565b6060818067ffffffffffffffff81111561074357610743610c31565b60405190808252806020026020018201604052801561077657816020015b60608152602001906001900390816107615790505b50915060005b818110156107f8573685858381811061079757610797610c47565b90506020028101906107a99190610c99565b90506107d26107bb6020830183610cb9565b60208301356107cd6040850185610ce2565b610851565b8483815181106107e4576107e4610c47565b60209081029190910101525060010161077c565b505092915050565b60008036816108126014828789610d29565b61081b91610d53565b60601c935061082e603460148789610d29565b61083791610d86565b92506108468560348189610d29565b949793965094505050565b6060600061085d610660565b6001600160a01b0316635229073f8787878760006040518663ffffffff1660e01b8152600401610891959493929190610da4565b6000604051808303816000875af11580156108b0573d6000803e3d6000fd5b505050506040513d6000823e601f3d908101601f191682016040526108d89190810190610dfc565b925090506108e68183610a25565b50949350505050565b6060818067ffffffffffffffff81111561090b5761090b610c31565b60405190808252806020026020018201604052801561093e57816020015b60608152602001906001900390816109295790505b50915060005b818110156107f8573685858381811061095f5761095f610c47565b90506020028101906109719190610c99565b905061099a6109836020830183610cb9565b60208301356109956040850185610ce2565b6109c0565b8483815181106109ac576109ac610c47565b602090810291909101015250600101610944565b60405181838237600038838387895af16109dd573d6000823e3d81fd5b3d8152602081013d6000823e3d01604052949350505050565b60405164ffffffffff602c19833b0116808252602090810190602d908301843c60408101815101604052919050565b8115610a2f575050565b805115610a3f5780518082602001fd5b604051632b3f6d1160e21b815260040160405180910390fd5b6001600160e01b031981168114610a6e57600080fd5b50565b600060208284031215610a8357600080fd5b8135610a8e81610a58565b9392505050565b60008083601f840112610aa757600080fd5b50813567ffffffffffffffff811115610abf57600080fd5b602083019150836020828501011115610ad757600080fd5b9250929050565b600080600060408486031215610af357600080fd5b83359250602084013567ffffffffffffffff811115610b1157600080fd5b610b1d86828701610a95565b9497909650939450505050565b60005b83811015610b45578181015183820152602001610b2d565b50506000910152565b6000602080830181845280855180835260408601915060408160051b870101925083870160005b82811015610bbb57878503603f1901845281518051808752610b9c818989018a8501610b2a565b601f01601f191695909501860194509285019290850190600101610b75565b5092979650505050505050565b81835281816020850137506000828201602090810191909152601f909101601f19169091010190565b838152604060208201526000610c0b604083018486610bc8565b95945050505050565b600060208284031215610c2657600080fd5b8151610a8e81610a58565b634e487b7160e01b600052604160045260246000fd5b634e487b7160e01b600052603260045260246000fd5b805160208201516bffffffffffffffffffffffff198082169291906014831015610c915780818460140360031b1b83161693505b505050919050565b60008235605e19833603018112610caf57600080fd5b9190910192915050565b600060208284031215610ccb57600080fd5b81356001600160a01b0381168114610a8e57600080fd5b6000808335601e19843603018112610cf957600080fd5b83018035915067ffffffffffffffff821115610d1457600080fd5b602001915036819003821315610ad757600080fd5b60008085851115610d3957600080fd5b83861115610d4657600080fd5b5050820193919092039150565b6bffffffffffffffffffffffff1981358181169160148510156107f85760149490940360031b84901b1690921692915050565b803560208310156101f357600019602084900360031b1b1692915050565b60018060a01b0386168152846020820152608060408201526000610dcc608083018587610bc8565b905060028310610dec57634e487b7160e01b600052602160045260246000fd5b8260608301529695505050505050565b60008060408385031215610e0f57600080fd5b82518015158114610e1f57600080fd5b602084015190925067ffffffffffffffff80821115610e3d57600080fd5b818501915085601f830112610e5157600080fd5b815181811115610e6357610e63610c31565b604051601f8201601f19908116603f01168101908382118183101715610e8b57610e8b610c31565b81604052828152886020848701011115610ea457600080fd5b610eb5836020830160208801610b2a565b8095505050505050925092905056fea2646970667358221220c1937239c783762bb72f4987b2b1f5551fe61a6105494872b32b0d6641fcba7064736f6c63430008170033'

// Safe contracts on Base Sepolia (forked)
const SAFE_PROXY_FACTORY = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67'
const SAFE_SINGLETON_L2 = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762'

// Anvil default accounts
const ACCOUNTS = [
  { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', pk: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' },
  { address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', pk: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' },
  { address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', pk: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' },
]

// ─── ABIs ──────────────────────────────────────────────────────────────────────
const SafeProxyFactoryABI = parseAbi([
  'function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)',
  'event ProxyCreation(address indexed proxy, address singleton)',
])

const SafeABI = parseAbi([
  'function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)',
  'function enableModule(address module)',
  'function isModuleEnabled(address module) view returns (bool)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function nonce() view returns (uint256)',
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool success)',
  'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)',
])

const DeleGatorModuleFactoryABI = parseAbi([
  'function deploy(address _safe, bytes32 _salt) returns (address module_, bool alreadyDeployed_)',
  'function predictAddress(address _safe, bytes32 _salt) view returns (address predicted_)',
  'function delegationManager() view returns (address)',
])

// ─── Clients ───────────────────────────────────────────────────────────────────
const transport = http(RPC_URL)

const publicClient = createPublicClient({
  chain: { ...foundry, id: 84532 }, // forked Base Sepolia chain ID
  transport,
})

function walletClient(pk) {
  return createWalletClient({
    account: privateKeyToAccount(pk),
    chain: { ...foundry, id: 84532 },
    transport,
  })
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function waitForTx(hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`Tx failed: ${hash}`)
  return receipt
}

/**
 * Execute a Safe transaction with 2/3 multisig approval
 */
async function execSafeTx(safeAddress, to, value, data) {
  const nonce = await publicClient.readContract({
    address: safeAddress, abi: SafeABI, functionName: 'nonce'
  })

  const txHash = await publicClient.readContract({
    address: safeAddress, abi: SafeABI, functionName: 'getTransactionHash',
    args: [to, value, data, 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', nonce]
  })

  // Collect signatures from first 2 signers (threshold=2)
  // Safe requires signatures sorted by signer address (ascending)
  const signers = [ACCOUNTS[0], ACCOUNTS[1]].sort((a, b) =>
    a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
  )

  let signatures = '0x'
  for (const signer of signers) {
    const account = privateKeyToAccount(signer.pk)
    const sig = await account.signMessage({ message: { raw: txHash } })
    // eth_sign signature: adjust v (+4 for eth_sign in Safe)
    const r = sig.slice(0, 66)
    const s = '0x' + sig.slice(66, 130)
    let v = parseInt(sig.slice(130, 132), 16)
    v += 4 // Safe's eth_sign convention
    signatures += r.slice(2) + s.slice(2) + v.toString(16).padStart(2, '0')
  }

  const client = walletClient(ACCOUNTS[0].pk)
  const hash = await client.writeContract({
    address: safeAddress,
    abi: SafeABI,
    functionName: 'execTransaction',
    args: [to, value, data, 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', signatures],
  })

  return waitForTx(hash)
}

// ─── Step 1: Create Safe ───────────────────────────────────────────────────────
async function createSafe() {
  console.log('\n📦 Step 1: Creating 2/3 Safe multisig...')

  const owners = ACCOUNTS.map(a => a.address)
  const threshold = 2

  const setupData = encodeFunctionData({
    abi: SafeABI,
    functionName: 'setup',
    args: [
      owners,
      BigInt(threshold),
      '0x0000000000000000000000000000000000000000', // to
      '0x',           // data
      '0x0000000000000000000000000000000000000000', // fallbackHandler
      '0x0000000000000000000000000000000000000000', // paymentToken
      0n,             // payment
      '0x0000000000000000000000000000000000000000', // paymentReceiver
    ],
  })

  const saltNonce = BigInt(Date.now())
  const client = walletClient(ACCOUNTS[0].pk)

  const hash = await client.writeContract({
    address: SAFE_PROXY_FACTORY,
    abi: SafeProxyFactoryABI,
    functionName: 'createProxyWithNonce',
    args: [SAFE_SINGLETON_L2, setupData, saltNonce],
  })

  const receipt = await waitForTx(hash)

  // Parse ProxyCreation event to get Safe address
  // The proxy address is in the logs
  let safeAddress = null
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === SAFE_PROXY_FACTORY.toLowerCase()) {
      // ProxyCreation event topic
      safeAddress = '0x' + log.topics[1].slice(26)
      break
    }
  }

  if (!safeAddress) {
    // Fallback: the Safe address should be the contract created
    // Look for the first contract creation in internal txs
    // Or just decode from logs
    throw new Error('Could not find Safe address in logs')
  }

  // Verify
  const actualOwners = await publicClient.readContract({
    address: safeAddress, abi: SafeABI, functionName: 'getOwners'
  })
  const actualThreshold = await publicClient.readContract({
    address: safeAddress, abi: SafeABI, functionName: 'getThreshold'
  })

  console.log(`  ✅ Safe deployed: ${safeAddress}`)
  console.log(`  Owners: ${actualOwners.join(', ')}`)
  console.log(`  Threshold: ${actualThreshold}/${actualOwners.length}`)

  return safeAddress
}

// ─── Step 2: Deploy DeleGatorModuleFactory ─────────────────────────────────────
async function deployFactoryViem() {
  console.log('\n🏭 Step 2: Deploying DeleGatorModuleFactory...')

  const client = walletClient(ACCOUNTS[0].pk)

  // Encode constructor args: DelegationManager address
  const constructorArgs = encodeAbiParameters(
    [{ type: 'address' }],
    [DELEGATION_MANAGER]
  )

  // Deploy: bytecode + constructor args
  const deployData = FACTORY_BYTECODE + constructorArgs.slice(2)

  const hash = await client.sendTransaction({
    data: deployData,
  })

  const receipt = await waitForTx(hash)
  const factoryAddress = receipt.contractAddress

  if (!factoryAddress) {
    throw new Error('Factory deployment failed — no contract address in receipt')
  }

  // Verify the factory's delegationManager matches
  const dm = await publicClient.readContract({
    address: factoryAddress,
    abi: DeleGatorModuleFactoryABI,
    functionName: 'delegationManager',
  })

  if (dm.toLowerCase() !== DELEGATION_MANAGER.toLowerCase()) {
    throw new Error(`DelegationManager mismatch: expected ${DELEGATION_MANAGER}, got ${dm}`)
  }

  console.log(`  ✅ Factory deployed: ${factoryAddress}`)
  return factoryAddress
}

// ─── Step 3: Deploy Module ─────────────────────────────────────────────────────
async function deployModule(factoryAddress, safeAddress) {
  console.log('\n🧩 Step 3: Deploying DeleGatorModule for Safe...')

  const salt = '0x0000000000000000000000000000000000000000000000000000000000000001'

  // Predict address first
  const predicted = await publicClient.readContract({
    address: factoryAddress,
    abi: DeleGatorModuleFactoryABI,
    functionName: 'predictAddress',
    args: [safeAddress, salt],
  })
  console.log(`  Predicted module address: ${predicted}`)

  // Deploy via factory
  const client = walletClient(ACCOUNTS[0].pk)
  const hash = await client.writeContract({
    address: factoryAddress,
    abi: DeleGatorModuleFactoryABI,
    functionName: 'deploy',
    args: [safeAddress, salt],
  })
  await waitForTx(hash)
  console.log(`  ✅ Module deployed: ${predicted}`)

  return predicted
}

// ─── Step 4: Enable Module on Safe ─────────────────────────────────────────────
async function enableModule(safeAddress, moduleAddress) {
  console.log('\n🔓 Step 4: Enabling module on Safe (2/3 multisig tx)...')

  const data = encodeFunctionData({
    abi: SafeABI,
    functionName: 'enableModule',
    args: [moduleAddress],
  })

  await execSafeTx(safeAddress, safeAddress, 0n, data)

  // Verify
  const enabled = await publicClient.readContract({
    address: safeAddress, abi: SafeABI, functionName: 'isModuleEnabled',
    args: [moduleAddress],
  })

  if (enabled) {
    console.log(`  ✅ Module enabled on Safe!`)
  } else {
    throw new Error('Module not enabled after tx')
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🐊 Gator Safe App — Local Test Setup')
  console.log('=====================================')
  console.log(`RPC: ${RPC_URL}`)

  // Check Anvil is running
  try {
    const blockNum = await publicClient.getBlockNumber()
    console.log(`Anvil block: ${blockNum}`)
  } catch (e) {
    console.error('❌ Cannot connect to Anvil. Start it first: npm run test:anvil')
    process.exit(1)
  }

  // Step 1: Create Safe
  const safeAddress = await createSafe()

  // Fund the Safe with some ETH
  const funder = walletClient(ACCOUNTS[0].pk)
  const fundHash = await funder.sendTransaction({
    to: safeAddress,
    value: 10000000000000000000n, // 10 ETH
  })
  await waitForTx(fundHash)
  console.log('  💰 Funded Safe with 10 ETH')

  // Step 2: Deploy Factory
  const factoryAddress = await deployFactoryViem()

  // Step 3: Deploy Module
  const moduleAddress = await deployModule(factoryAddress, safeAddress)

  // Step 4: Enable Module
  await enableModule(safeAddress, moduleAddress)

  // Save deployment info
  const deployInfo = {
    rpcUrl: RPC_URL,
    chainId: 84532,
    safe: {
      address: safeAddress,
      owners: ACCOUNTS.map(a => a.address),
      threshold: 2,
    },
    factory: factoryAddress,
    module: moduleAddress,
    delegationManager: DELEGATION_MANAGER,
    enforcers: {
      nativeTokenPeriodTransfer: '0x9BC0FAf4Aca5AE429F4c06aEEaC517520CB16BD9',
      erc20PeriodTransfer: '0x474e3Ae7E169e940607cC624Da8A15Eb120139aB',
      valueLte: '0x92Bf12322527cAA612fd31a0e810472BBB106A8F',
      timestamp: '0x1046bb45C8d673d4ea75321280DB34899413c069',
      allowedTargets: '0x7F20f61b1f09b08D970938F6fa563634d65c4EeB',
      allowedMethods: '0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5',
      limitedCalls: '0x04658B29F6b82ed55274221a06Fc97D318E25416',
    },
    accounts: ACCOUNTS.map(a => ({ address: a.address })),
    timestamp: new Date().toISOString(),
  }

  const outPath = join(__dirname, 'deployment.json')
  writeFileSync(outPath, JSON.stringify(deployInfo, null, 2))
  console.log(`\n📄 Deployment info saved to ${outPath}`)
  console.log('\n✅ Setup complete! Run: npm run test:flow')
}

main().catch(e => {
  console.error('\n❌ Setup failed:', e.message)
  process.exit(1)
})
