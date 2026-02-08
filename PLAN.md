# Gator Safe App — Build Plan

## Overview

A Safe App that enables ERC-7710 delegation management from Safe multisigs using MetaMask's DeleGatorModule.

## Target Chains

- **Testing:** Base Sepolia
- **Production:** Base Mainnet

## User Flows

### Flow 1: Install Gator Module

```
Open Safe App → "Your Safe doesn't have ERC-7710 permissions yet"
→ [Install Gator Module]
→ Proposes deployDeleGatorModule tx to Safe queue
→ All signers approve
→ DeleGatorModule deployed as Safe module ✅
```

### Flow 2: Create ETH Spending Limit Permission

```
"Create New Permission" →
  Step 1: Delegate address (who gets the permission)
  Step 2: Permission type → "ETH Spending Limit"
  Step 3: Configure:
    - Amount per period (e.g., 1 ETH)
    - Period duration (e.g., daily, weekly)
    - Optional: Expiry date (TimestampEnforcer)
  Step 4: Review summary
  [Grant Permission] →
  → Asks current user for EIP-712 signature
  → Queues signTypedData for other multisig signers
  → Once threshold met → Delegation is fully signed ✅
  → User can download JSON or copy signed delegation
  → Give signed delegation to the delegate
```

### Flow 3: Create ERC-20 Spending Limit Permission

```
Same wizard but:
  - Select token (ERC-20 address)
  - Amount per period
  - Period duration
  - Uses ERC20PeriodTransferEnforcer
  - PLUS ValueLteEnforcer set to 0 (prevent ETH transfers with this permission)
  - Optional: TimestampEnforcer for expiry
```

## Enforcer Stack

### ETH Spending Limit
```
Caveats:
  1. NativeTokenPeriodTransferEnforcer — recurring ETH spending limit
     - amount: max ETH per period
     - period: duration in seconds (86400 = daily)
  2. TimestampEnforcer (optional) — absolute expiry
     - afterThreshold: now
     - beforeThreshold: expiry date
```

### ERC-20 Spending Limit
```
Caveats:
  1. ERC20PeriodTransferEnforcer — recurring token spending limit
     - token: ERC-20 address
     - amount: max tokens per period
     - period: duration in seconds
  2. ValueLteEnforcer — set to 0 (no ETH transfers allowed)
  3. TimestampEnforcer (optional) — absolute expiry
```

## EIP-712 Signing Flow (Multi-sig)

1. User clicks "Grant Permission"
2. App constructs the Delegation struct with caveats
3. App calls `sdk.txs.signTypedMessage()` with the EIP-712 typed data
4. Current user's signature is collected
5. Safe queues the signTypedData request for other signers
6. Other signers open the Safe App and see pending signature request
7. Once threshold (e.g., 2/3) is met, combined signature is valid
8. App shows "Delegation Ready" with download/copy options

## Delegation Storage & Sharing

- **Download:** JSON file with full signed delegation
- **Copy:** Copy to clipboard (JSON string)
- **Upload/Import:** Drag-and-drop or paste JSON to import delegations
- **Local Storage:** Browser localStorage for viewing active delegations
- **Format:** Standard delegation JSON (delegate, delegator, authority, caveats, salt, signature)

## Tech Stack

- **Framework:** Vite + React + TypeScript
- **Styling:** Tailwind CSS
- **Safe Integration:** @safe-global/safe-apps-sdk, @safe-global/safe-apps-react-sdk, @safe-global/safe-apps-provider
- **Web3:** wagmi + viem (wagmi has built-in safe() connector)
- **Delegations:** @metamask/smart-accounts-kit
- **Smart Contracts:** DeleGatorModule from https://github.com/MetaMask/delegator-safe-module

## Pages / Components

```
src/
├── App.tsx                    # SafeProvider + Router
├── pages/
│   ├── Home.tsx               # Module status check + install
│   ├── CreateDelegation.tsx   # Wizard form
│   ├── Delegations.tsx        # View active delegations
│   └── ImportDelegation.tsx   # Upload/paste JSON
├── components/
│   ├── ModuleInstaller.tsx    # Install Gator Module flow
│   ├── DelegationWizard/
│   │   ├── StepDelegate.tsx   # Who (address/ENS)
│   │   ├── StepType.tsx       # What (ETH/ERC-20)
│   │   ├── StepLimits.tsx     # How much (amount, period)
│   │   └── StepReview.tsx     # Review + Grant
│   ├── DelegationCard.tsx     # Display a delegation
│   ├── DelegationExport.tsx   # Download/copy buttons
│   └── SignatureStatus.tsx    # Multi-sig progress (2/3 signed)
├── lib/
│   ├── delegations.ts         # Create delegation helpers
│   ├── enforcers.ts           # Enforcer config builders
│   ├── module.ts              # DeleGatorModule interaction
│   └── storage.ts             # Local storage helpers
└── config/
    └── chains.ts              # Base Sepolia + Base mainnet
```

## Development Phases

### Phase 1: MVP (Build Now)
- Vite + React + Safe SDK setup
- Module detection + installation flow
- ETH spending limit wizard (NativeTokenPeriodTransferEnforcer)
- EIP-712 signing via Safe SDK
- Download/copy signed delegation

### Phase 2: ERC-20 Support
- Token selector
- ERC20PeriodTransferEnforcer + ValueLteEnforcer(0)
- Token balance display

### Phase 3: Management
- View active delegations
- Revoke delegations
- Import delegations (JSON upload/paste)
- Delegation history

### Phase 4: Polish + Listing
- ENS resolution for delegate addresses
- Mobile responsive
- Safe App store listing submission

## Contract Addresses (Needed)

- DeleGatorModuleFactory — Base Sepolia
- DeleGatorModuleFactory — Base Mainnet
- NativeTokenPeriodTransferEnforcer — Base Sepolia / Mainnet
- ERC20PeriodTransferEnforcer — Base Sepolia / Mainnet
- ValueLteEnforcer — Base Sepolia / Mainnet
- TimestampEnforcer — Base Sepolia / Mainnet
- DelegationManager — Base Sepolia / Mainnet

## References

- DeleGatorModule: https://github.com/MetaMask/delegator-safe-module
- Safe Apps SDK: https://github.com/safe-global/safe-apps-sdk
- Smart Accounts Kit: https://docs.metamask.io/smart-accounts-kit
- Delegation Framework: https://github.com/MetaMask/delegation-framework
- Safe App Guide: https://help.safe.global/en/articles/145503-how-to-build-a-safe-app-and-get-it-listed-in-safe-wallet
