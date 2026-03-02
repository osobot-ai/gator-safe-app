# AGENTS.md — Custom Delegation + Recipes Feature

## Overview
Add a new delegation type: "Custom Delegation" — generic target + method + calldata scoped delegation. Plus a "Recipes" system with pre-built templates (first recipe: Flaunch Claim Fees).

## What exists already
- `CreateDelegation.tsx` — Supports ethSpendingLimit, erc20SpendingLimit, transferIntent, swapIntent
- `RedeemDelegation.tsx` — Redeems delegations from within Safe UI
- `StandaloneRedeem.tsx` — Standalone page for external delegates to connect wallet and redeem
- `src/lib/enforcers.ts` — Builds caveats for ETH/ERC20 spending
- `src/lib/storage.ts` — localStorage delegation storage with types
- `src/config/addresses.ts` — All enforcer addresses on Base + Base Sepolia

### Key enforcer addresses already available in addresses.ts:
- `allowedTargetsEnforcer` — Restricts which contracts can be called
- `allowedMethodsEnforcer` — Restricts which function selectors can be called
- `argsEqualityCheckEnforcer` — Enforces exact calldata match
- `valueLteEnforcer` — Caps ETH value sent with tx
- `timestampEnforcer` — Time-based expiry
- `limitedCallsEnforcer` — Limits number of calls

## Changes Needed

### 1. Add new scopeType to storage.ts
Add `'custom'` to the `scopeType` union type:
```typescript
scopeType: 'ethSpendingLimit' | 'erc20SpendingLimit' | 'transferIntent' | 'swapIntent' | 'custom'
```

Also add optional meta fields for custom delegations:
```typescript
// In StoredDelegation.meta
targetAddress?: Address    // The allowed contract target
methodSelector?: Hex       // The allowed method (4-byte selector)
calldataArgs?: Hex         // The enforced calldata (full encoded args)
maxValue?: string          // Max ETH value (usually "0")
recipeName?: string        // If created from a recipe, store the recipe name
```

### 2. Add new permission category in CreateDelegation.tsx

Add `'custom'` as a new PermissionCategory alongside existing ones.

In the Step 1 category selection, add a new card:
```
🔧 Custom Action
Delegate a specific contract call with locked parameters
```

When `custom` is selected, Step 2 shows:

**Standard fields (dropdowns/inputs):**
- **Target Address** — The contract to call (address input)
- **Method** — Function selector (text input showing hex, or text input for human-readable like `withdrawFees(address,bool)`)
  - When user types human-readable sig, auto-compute the 4-byte selector
  - Show the computed selector below: "Selector: 0x4c2d94c0"
- **Parameters / Calldata** — The encoded function arguments that will be enforced
  - This should be a dynamic form: user adds parameter rows with type + value
  - Types: address, uint256, bool, bytes32, bytes, string
  - Values: text input
  - Auto-encode using viem's `encodeAbiParameters`
  - Show the full encoded calldata below
- **Value (ETH)** — How much ETH the tx can send (default: "0")
  - Use ValueLteEnforcer with the specified max
- **Max Calls** — Optional, number of times this can be called (uses LimitedCallsEnforcer)
  - Default: unlimited (no enforcer)
  - If set: add LimitedCallsEnforcer with the specified count
- **Expiry** — Optional timestamp (same as existing)

**Caveats built for custom delegations:**
1. `AllowedTargetsEnforcer` — terms: `abi.encodePacked(targetAddress)` — single allowed target
2. `AllowedMethodsEnforcer` — terms: `abi.encodePacked(selector)` — single allowed method
3. `ArgsEqualityCheckEnforcer` — terms: the encoded calldata args (everything after the selector). This enforces the EXACT parameters.
4. `ValueLteEnforcer` — terms: `abi.encodePacked(uint256(maxValue))` — usually 0
5. (Optional) `LimitedCallsEnforcer` — terms: `abi.encodePacked(uint256(maxCalls))`
6. (Optional) `TimestampEnforcer` — same as existing

### 3. Recipes Section

**Above the custom delegation form**, show a "Recipes" section with clickable tiles.

```tsx
<h3>Recipes</h3>
<p>Pre-built delegation templates for common actions</p>
<div className="grid grid-cols-2 gap-3">
  {recipes.map(recipe => (
    <RecipeTile key={recipe.id} recipe={recipe} onClick={() => applyRecipe(recipe)} />
  ))}
</div>
```

**Recipe data structure:**
```typescript
interface Recipe {
  id: string
  name: string
  description: string
  icon: string
  targetAddress: Address
  methodSignature: string      // Human-readable: "withdrawFees(address,bool)"
  methodSelector: Hex          // 4-byte: "0x4c2d94c0"
  params: RecipeParam[]
  defaultValue: string         // ETH value, usually "0"
  defaultMaxCalls?: number     // Optional call limit
}

interface RecipeParam {
  name: string
  type: string                 // "address", "bool", "uint256", etc.
  value: string                // Pre-filled value (can be editable or locked)
  locked: boolean              // If true, user can't change it
  description: string          // Help text
}
```

**First recipe — Flaunch Claim Fees:**
```typescript
{
  id: 'flaunch-claim-fees',
  name: 'Flaunch Claim Fees',
  description: 'Claim accumulated trading fees from Flaunch revenue stream. Fees are unwrapped to ETH and sent to the specified recipient.',
  icon: '💰',
  targetAddress: '0x72e6f7948b1B1A343B477F39aAbd2E35E6D27dde',
  methodSignature: 'withdrawFees(address,bool)',
  methodSelector: '0x4c2d94c0',
  params: [
    {
      name: 'recipient',
      type: 'address',
      value: '',       // User fills in — this should default to the Safe address
      locked: false,
      description: 'Address to receive the claimed ETH fees',
    },
    {
      name: 'unwrap',
      type: 'bool',
      value: 'true',
      locked: true,    // Always unwrap to ETH
      description: 'Unwrap flETH to native ETH',
    },
  ],
  defaultValue: '0',    // No ETH sent with the call
}
```

When user clicks a recipe tile:
1. Auto-populate all the custom delegation fields (target, method, params, value)
2. Locked params are shown but grayed out / non-editable
3. User fills in any unlocked params (e.g., recipient address)
4. User still sets delegate address, expiry, max calls as normal

**Store recipes in `src/config/recipes.ts`** so they're easy to add more later.

### 4. Delegation label for custom type
When saving the delegation, set the label to either:
- Recipe name if from a recipe: e.g., "Flaunch Claim Fees"
- "Custom: {methodSignature} on {targetAddress.slice(0,10)}..." if manually configured

### 5. Update RedeemDelegation.tsx and StandaloneRedeem.tsx
These already handle redemption generically. But for `custom` scope type:
- Display different info: show the target contract, method, and locked params
- The execution construction is different — instead of building a transfer:
  ```typescript
  const execution = createExecution({
    target: delegation.meta.targetAddress,
    value: 0n, // From ValueLteEnforcer
    callData: encodeFunctionData with the locked params
  })
  ```
  Wait — actually for custom delegations with ArgsEqualityCheckEnforcer, the calldata is FIXED. The delegate doesn't need to enter any params at redeem time. They just click "Execute" and the pre-encoded calldata is used.
  
  So for `custom` scope type redemption:
  - No amount/recipient inputs needed
  - Show what the delegation does: "Call withdrawFees(0x782..., true) on 0x72e6..."
  - Single "Execute" button
  - Build execution from the stored meta: target + method selector + encoded args

### 6. Build the correct calldata for ArgsEqualityCheckEnforcer

**IMPORTANT:** The `ArgsEqualityCheckEnforcer` checks the FULL calldata of the execution, NOT just the args. So the terms should be the complete `encodeFunctionData(...)` output (selector + encoded args).

Actually wait — let me re-read the enforcer. The enforcer name says "ArgsEqualityCheck" which implies it checks the arguments portion (after the selector). Need to check.

Looking at the delegation framework source: `ArgsEqualityCheckEnforcer` stores the expected calldata in `terms` and compares it against the `_executionCallData` from the execution. The `_executionCallData` in the delegation framework IS the full calldata (selector + args).

So terms = the full encoded function call data (selector + args).

When building the ArgsEqualityCheckEnforcer terms:
```typescript
import { encodeFunctionData, parseAbi } from 'viem'

const terms = encodeFunctionData({
  abi: parseAbi(['function withdrawFees(address,bool)']),
  functionName: 'withdrawFees',
  args: [recipientAddress, true],
})
// This gives us 0x4c2d94c0 + encoded args
// Use this as the ArgsEqualityCheckEnforcer terms
```

Then at redemption time, the execution callData must be EXACTLY this same value.

### 7. Update enforcers.ts
Add a new function:
```typescript
export function buildCustomActionCaveats(
  chainId: number,
  targetAddress: Address,
  methodSelector: Hex,
  encodedCalldata: Hex,  // Full calldata (selector + args)
  maxValueEth: string,
  maxCalls?: number,
  expiryTimestamp?: number,
): Caveat[] {
  const addrs = getAddresses(chainId)
  const caveats: Caveat[] = []

  // AllowedTargetsEnforcer
  caveats.push({
    enforcer: addrs.allowedTargetsEnforcer,
    terms: encodePacked(['address'], [targetAddress]),
  })

  // AllowedMethodsEnforcer
  caveats.push({
    enforcer: addrs.allowedMethodsEnforcer,
    terms: encodePacked(['bytes4'], [methodSelector as `0x${string}`]),
  })

  // ArgsEqualityCheckEnforcer — lock exact calldata
  caveats.push({
    enforcer: addrs.argsEqualityCheckEnforcer,
    terms: encodedCalldata, // Full calldata that must match
  })

  // ValueLteEnforcer
  caveats.push({
    enforcer: addrs.valueLteEnforcer,
    terms: encodePacked(['uint256'], [parseEther(maxValueEth)]),
  })

  // Optional: LimitedCallsEnforcer
  if (maxCalls !== undefined) {
    caveats.push({
      enforcer: addrs.limitedCallsEnforcer,
      terms: encodePacked(['uint256'], [BigInt(maxCalls)]),
    })
  }

  // Optional: TimestampEnforcer
  if (expiryTimestamp) {
    const now = Math.floor(Date.now() / 1000)
    caveats.push({
      enforcer: addrs.timestampEnforcer,
      terms: encodePacked(['uint256', 'uint256'], [BigInt(now), BigInt(expiryTimestamp)]),
    })
  }

  return caveats
}
```

## UI Style
Match the existing dark theme with amber/gold accent colors. The Recipes section should feel like a card grid similar to how the permission types are shown. Each recipe tile has:
- Icon (emoji)
- Name (bold)
- Short description (gray text)
- Arrow or indicator that it's clickable

## Build Verification
1. `npm run build` must pass
2. No TypeScript errors
3. No console errors

## Branch
You are on `feat/custom-delegation-recipes`. Commit to THIS branch.
