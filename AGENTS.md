# AGENTS.md — Fix: Replace ArgsEqualityCheckEnforcer with correct calldata enforcers

## Context
The current implementation uses `ArgsEqualityCheckEnforcer` which checks if args passed to the enforcer match the terms. This is WRONG. We need:
- **ExactCalldataEnforcer** — when ALL params are enforced (exact calldata match)
- **AllowedCalldataEnforcer** — when only SOME params are enforced (one caveat per enforced param)

## Enforcer Addresses (same on Base + Base Sepolia — deterministic)
- ExactCalldataEnforcer: `0x99F2e9bF15ce5eC84685604836F71aB835DBBdED`
- AllowedCalldataEnforcer: `0xc2b0d624c1c4319760C96503BA27C347F3260f55`

## Changes

### 1. Update `src/config/addresses.ts`
Add to BOTH base and baseSepolia:
```typescript
exactCalldataEnforcer: '0x99F2e9bF15ce5eC84685604836F71aB835DBBdED' as Address,
allowedCalldataEnforcer: '0xc2b0d624c1c4319760C96503BA27C347F3260f55' as Address,
```
Remove `argsEqualityCheckEnforcer` if it exists.

### 2. Update `src/config/recipes.ts`
Add `required: boolean` to RecipeParam interface:
```typescript
interface RecipeParam {
  name: string
  type: string
  value: string
  locked: boolean      // User can't change the value
  required: boolean    // Value must be filled before granting
  description: string
}
```

Update Flaunch recipe:
```typescript
params: [
  {
    name: 'recipient',
    type: 'address',
    value: '',
    locked: false,
    required: true,     // Must fill in recipient
    description: 'Address to receive the claimed ETH fees',
  },
  {
    name: 'unwrap',
    type: 'bool',
    value: 'true',
    locked: true,
    required: true,     // Always true
    description: 'Unwrap flETH to native ETH',
  },
],
```

### 3. Update `src/lib/enforcers.ts`

Replace the `ArgsEqualityCheckEnforcer` caveat in `buildCustomActionCaveats` with the correct enforcer logic:

```typescript
export function buildCustomActionCaveats(
  chainId: number,
  targetAddress: Address,
  methodSelector: Hex,
  customParams: CustomParam[],  // Changed from encodedCalldata
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

  // Determine which params are enforced
  const enforcedParams = customParams.filter(p => p.enforced && p.value)
  const allParamsEnforced = enforcedParams.length === customParams.length && customParams.every(p => p.enforced)

  if (allParamsEnforced) {
    // ALL params enforced → use ExactCalldataEnforcer
    // terms = the full calldata (selector + abi-encoded args)
    const fullCalldata = encodeFunctionCalldata(methodSelector, customParams)
    caveats.push({
      enforcer: addrs.exactCalldataEnforcer,
      terms: fullCalldata,
    })
  } else if (enforcedParams.length > 0) {
    // SOME params enforced → use AllowedCalldataEnforcer (one per enforced param)
    // Each caveat specifies: startIndex (byte offset) and value (expected bytes at that offset)
    // ABI encoding: selector is 4 bytes, each param is 32 bytes
    // Param 0 starts at byte 4, param 1 at byte 36, param 2 at byte 68, etc.
    for (let i = 0; i < customParams.length; i++) {
      if (customParams[i].enforced && customParams[i].value) {
        const startIndex = 4 + (i * 32) // 4-byte selector + 32 bytes per param
        const encodedValue = encodeParamValue(customParams[i].type, customParams[i].value)
        // encodedValue should be a 32-byte hex string (left-padded for uint/address/bool, etc.)
        caveats.push({
          enforcer: addrs.allowedCalldataEnforcer,
          terms: encodeAbiParameters(
            [{ type: 'uint256' }, { type: 'bytes' }],
            [BigInt(startIndex), encodedValue]
          ),
        })
      }
    }
  }
  // If NO params enforced, no calldata caveat (only target + method restrictions)

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
      terms: encodePacked(['uint128', 'uint128'], [BigInt(now), BigInt(expiryTimestamp)]),
    })
  }

  return caveats
}
```

Add helper functions:
```typescript
// Encode a single parameter value as 32-byte ABI encoding
function encodeParamValue(type: string, value: string): Hex {
  if (type === 'address') {
    return encodeAbiParameters([{ type: 'address' }], [value as Address])
  } else if (type === 'uint256') {
    return encodeAbiParameters([{ type: 'uint256' }], [BigInt(value)])
  } else if (type === 'bool') {
    return encodeAbiParameters([{ type: 'bool' }], [value === 'true'])
  } else if (type === 'bytes32') {
    return encodeAbiParameters([{ type: 'bytes32' }], [value as Hex])
  }
  // Default: encode as bytes
  return encodeAbiParameters([{ type: 'bytes' }], [value as Hex])
}

// Encode full function calldata (selector + encoded args)
function encodeFunctionCalldata(selector: Hex, params: CustomParam[]): Hex {
  // Build ABI types and values from params
  const types = params.map(p => ({ type: p.type }))
  const values = params.map(p => {
    if (p.type === 'address') return p.value as Address
    if (p.type === 'uint256') return BigInt(p.value)
    if (p.type === 'bool') return p.value === 'true'
    if (p.type === 'bytes32') return p.value as Hex
    return p.value
  })
  const encodedArgs = encodeAbiParameters(types, values)
  return (selector + encodedArgs.slice(2)) as Hex // concat selector + encoded args
}

interface CustomParam {
  type: string
  value: string
  name: string
  locked: boolean
  required: boolean
  enforced: boolean    // NEW: whether this param should be enforced
  description: string
}
```

### 4. Update `src/pages/CreateDelegation.tsx`

**State for param enforcement:**
Each param row now has an "enforce" toggle. Add `enforced: boolean` to the customParams state:

```typescript
// Existing param state becomes:
const [customParams, setCustomParams] = useState<{
  type: string
  value: string
  name: string
  locked: boolean
  required: boolean
  enforced: boolean     // NEW
  description: string
}[]>([])
```

When applying a recipe:
- All params with `required: true` OR `locked: true` should default `enforced: true`
- When manually adding params, `enforced` defaults to `true`

**UI for each param row:**
- Add a checkbox or toggle: "🔒 Enforce" next to each param
- When checked, this param's value will be locked in the delegation
- When unchecked, the delegate can use any value for this param
- Locked params from recipes should always have enforced=true and the toggle disabled

**Validation before granting:**
- All `required` params must have values filled in
- Show error: "Please fill in all required parameters" if any required param is empty
- Disable the "Grant Permission" button until all required params are filled

**Visual indicators:**
- Required params: show a red asterisk (*) next to the name
- Enforced params: show a lock icon 🔒
- Locked params (from recipe): grayed out input + lock icon + "Set by recipe" hint

**Info text above the form:**
Add a brief explanation:
"**Enforced parameters** are locked into the delegation — the delegate must use exactly these values. **Unenforced parameters** allow the delegate to choose any value."

**Pass updated params to buildCustomActionCaveats:**
```typescript
const caveats = buildCustomActionCaveats(
  chainId,
  customTarget,
  customSelector,
  customParams,  // Now includes enforced flag
  customMaxValue,
  customMaxCalls || undefined,
  expiryTimestamp || undefined,
)
```

### 5. Update storage meta
Store which params are enforced so the redeem page knows:
```typescript
// In StoredDelegation.meta for custom type
customParams?: {
  name: string
  type: string
  value: string
  enforced: boolean
  locked: boolean
}[]
```

### 6. Update RedeemDelegation.tsx and StandaloneRedeem.tsx
For custom scope redemption:
- Show the enforced params and their locked values
- Show unenforced params as editable inputs
- Build execution calldata from: enforced param values (from delegation meta) + user-entered values for unenforced params
- If ALL params were enforced (ExactCalldataEnforcer), show "Execute" button only — no inputs
- If SOME params were enforced, show inputs for the unenforced ones

Example for a `vote(uint256 propId, bool opinion)` with propId enforced:
- Show: "propId: 42 🔒"
- Input: "opinion: [true/false dropdown]"
- User fills in opinion, clicks Execute
- Build calldata: vote(42, userChosenOpinion)

### 7. Remove argsEqualityCheckEnforcer
- Remove from addresses.ts if present
- Remove any imports/references

## Build Verification
1. `npx vite build` must pass
2. No TypeScript errors
3. No console errors

## Branch
You are on `fix/calldata-enforcers`. Commit to THIS branch.
