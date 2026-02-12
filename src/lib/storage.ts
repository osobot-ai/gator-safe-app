import { type Address, type Hex } from 'viem'

export interface Caveat {
  enforcer: Address
  terms: Hex
}

export interface StoredDelegation {
  delegation: {
    delegate: Address
    delegator: Address
    authority: Hex
    caveats: Caveat[]
    salt: Hex
    signature: Hex
  }
  meta: {
    label: string
    scopeType: 'ethSpendingLimit' | 'erc20SpendingLimit' | 'transferIntent' | 'swapIntent'
    createdAt: string
    chainId: number
    safeAddress: Address
    moduleAddress: Address
    status: 'pending' | 'signed' | 'revoked'
    delegationHash: Hex
    // Human-readable details
    amount?: string
    period?: string
    tokenAddress?: Address
    expiryDate?: string
  }
}

const STORAGE_KEY = 'gator-delegations'

export function getDelegations(): StoredDelegation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveDelegation(delegation: StoredDelegation): void {
  const existing = getDelegations()
  // Deduplicate by hash
  const filtered = existing.filter(
    (d) => d.meta.delegationHash !== delegation.meta.delegationHash
  )
  filtered.push(delegation)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
}

export function removeDelegation(delegationHash: Hex): void {
  const existing = getDelegations()
  const filtered = existing.filter(
    (d) => d.meta.delegationHash !== delegationHash
  )
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
}

export function updateDelegationStatus(
  delegationHash: Hex,
  status: StoredDelegation['meta']['status']
): void {
  const existing = getDelegations()
  const updated = existing.map((d) =>
    d.meta.delegationHash === delegationHash
      ? { ...d, meta: { ...d.meta, status } }
      : d
  )
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
}

export function exportDelegationsJson(delegations: StoredDelegation[]): string {
  return JSON.stringify(
    {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      delegations,
    },
    null,
    2
  )
}

export function importDelegationsJson(json: string): StoredDelegation[] {
  const parsed = JSON.parse(json)
  if (parsed.version && parsed.delegations) {
    return parsed.delegations
  }
  // Maybe it's a single delegation
  if (parsed.delegation && parsed.meta) {
    return [parsed]
  }
  throw new Error('Invalid delegation JSON format')
}
