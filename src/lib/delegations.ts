import { type Address, type Hex, keccak256, encodePacked, encodeAbiParameters } from 'viem'
import type { Caveat } from './storage'
import { getAddresses } from '../config/addresses'

// Root authority — used for direct delegations from the delegator
export const ROOT_AUTHORITY: Hex =
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

export interface DelegationStruct {
  delegate: Address
  delegator: Address
  authority: Hex
  caveats: Caveat[]
  salt: Hex
  signature: Hex
}

/**
 * Generate a random salt for delegation uniqueness
 */
export function generateSalt(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return ('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex
}

/**
 * Build the EIP-712 typed data for a delegation
 */
export function buildDelegationTypedData(
  delegation: DelegationStruct,
  chainId: number,
) {
  const addrs = getAddresses(chainId)

  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Delegation: [
        { name: 'delegate', type: 'address' },
        { name: 'delegator', type: 'address' },
        { name: 'authority', type: 'bytes32' },
        { name: 'caveats', type: 'Caveat[]' },
        { name: 'salt', type: 'uint256' },
      ],
      Caveat: [
        { name: 'enforcer', type: 'address' },
        { name: 'terms', type: 'bytes' },
      ],
    },
    domain: {
      name: 'DelegationManager',
      version: '1',
      chainId: chainId,
      verifyingContract: addrs.delegationManager,
    },
    primaryType: 'Delegation' as const,
    message: {
      delegate: delegation.delegate,
      delegator: delegation.delegator,
      authority: delegation.authority,
      caveats: delegation.caveats.map((c) => ({
        enforcer: c.enforcer,
        terms: c.terms,
      })),
      salt: delegation.salt,
    },
  }
}

/**
 * Compute a delegation hash (offline approximation)
 * Note: For exact hash, use the DelegationManager contract's getDelegationHash
 */
export function computeDelegationHash(delegation: DelegationStruct): Hex {
  const caveatHashes = delegation.caveats.map((c) =>
    keccak256(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'bytes' }],
        [c.enforcer, c.terms]
      )
    )
  )

  const caveatsHash = keccak256(
    encodePacked(
      caveatHashes.map(() => 'bytes32'),
      caveatHashes
    )
  )

  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
      ],
      [
        delegation.delegate,
        delegation.delegator,
        delegation.authority,
        caveatsHash,
        BigInt(delegation.salt),
      ]
    )
  )
}
