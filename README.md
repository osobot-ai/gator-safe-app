# 🐊 Gator Safe App

A Safe App for creating and managing ERC-7710 delegations using the [MetaMask Delegation Framework](https://docs.delegations.org/) and [Smart Accounts Kit](https://docs.metamask.io/smart-accounts/).

**Live:** [gator-safe-app.vercel.app](https://gator-safe-app.vercel.app/)

## What is Gator?

Gator lets Safe multisig owners create scoped, onchain-enforceable permissions (delegations) that allow delegates — humans, agents, or applications — to act on behalf of the Safe within strict boundaries. Every delegation is bounded by caveat enforcers: onchain rules verified at execution time.

## Features

### 🔐 Permission Types

**💰 Spending Limits**
- ETH or ERC-20 spending limits with configurable periods (daily, weekly, monthly)
- Delegates can transfer tokens up to the allowed amount per period
- Uses `ERC20PeriodTransferEnforcer` and `NativeTokenPeriodTransferEnforcer`

**🔄 Transfer Intents**
- Conditional transfers: "I will let you transfer X out, if and only if I receive Y in return"
- Uses `ERC20MultiOperationIncreaseBalanceEnforcer` to verify the Safe receives the expected tokens
- Supports ETH and ERC-20 tokens in both directions

**💱 Swap Intents**
- Allow a delegate to swap up to X of your tokens per period into any token via MetaSwap
- Uses the [DelegationMetaSwapAdapter](https://github.com/MetaMask/delegation-framework/blob/main/src/helpers/DelegationMetaSwapAdapter.sol) for secure swap execution
- `RedeemerEnforcer` ensures only the MetaSwap adapter can redeem the delegation
- `ArgsEqualityCheckEnforcer` controls token whitelist behavior
- `ERC20PeriodTransferEnforcer` limits how much can be swapped per period

### 📄 Pages

| Page | Route | Description |
|------|-------|-------------|
| **Home** | `/` | Dashboard showing created delegations |
| **Create Delegation** | Step-by-step wizard for granting permissions |
| **View Delegations** | Browse, export, and manage active delegations |
| **Redeem Delegation** | Redeem delegations from within the Safe App |
| **Standalone Redeem** | `/redeem` | External page for EOA/embedded wallet users to redeem delegations |
| **Import Delegation** | Import delegation JSON files |

### 🔑 Wallet Support

- **Safe Multisig** — Full delegation creation and redemption within the Safe App
- **MetaMask (Injected)** — Connect via browser extension on the standalone redeem page
- **MetaMask Embedded Wallet (Web3Auth)** — Social login (Google, email, etc.) on the standalone redeem page — no extension required

## How It Works

### Creating a Delegation (Safe App)

1. **Choose a Delegate** — Enter the address that will receive the permission
2. **Select Permission Type** — Spending Limit, Transfer Intent, or Swap Intent
3. **Configure Scope** — Set token, amount, period, and any conditions
4. **Review & Sign** — EIP-712 signature from the Safe (requires threshold signers)
5. **Export** — Download the signed delegation as JSON to share with the delegate

### Redeeming a Delegation

**From the Safe App (Redeem tab):**
- Select a delegation and execute the permitted action (transfer, swap)

**From the Standalone Page (`/redeem`):**
- Load a delegation JSON file or paste it
- Connect via MetaMask or embedded wallet
- Execute: spending limits trigger direct transfers, swap intents fetch MetaSwap quotes and call `swapByDelegation`

### Swap Intent Flow

1. Safe owner creates a delegation with swap scope (source token + period limit)
2. Delegate receives the signed delegation JSON
3. On the redeem page, delegate:
   - Loads the delegation
   - Enters source amount and selects destination token
   - Fetches quotes from the MetaSwap API
   - Signs a redelegation to the DelegationMetaSwapAdapter
   - Calls `swapByDelegation` with the API data + delegation chain
4. The adapter redeems the delegation, pulls tokens from the Safe, executes the swap, and returns output tokens to the Safe

## Architecture

```
┌─────────────────────────────────────┐
│           Safe Multisig             │
│  (Delegator — owns the funds)       │
└──────────────┬──────────────────────┘
               │ EIP-712 Signed Delegation
               │ (with caveat enforcers)
               ▼
┌─────────────────────────────────────┐
│         Delegate (EOA/Agent)        │
│  (Receives scoped permission)       │
└──────────────┬──────────────────────┘
               │ Redelegation (for swaps)
               ▼
┌─────────────────────────────────────┐
│   DelegationMetaSwapAdapter         │
│  (Executes swap via MetaSwap)       │
└──────────────┬──────────────────────┘
               │ redeemDelegations()
               ▼
┌─────────────────────────────────────┐
│       DelegationManager             │
│  (Verifies chain + enforcers)       │
└─────────────────────────────────────┘
```

## Caveat Enforcers Used

| Enforcer | Purpose |
|----------|---------|
| `ERC20PeriodTransferEnforcer` | Limits ERC-20 spending per time period |
| `NativeTokenPeriodTransferEnforcer` | Limits ETH spending per time period |
| `ERC20MultiOperationIncreaseBalanceEnforcer` | Verifies token balance increases (transfer intents) |
| `ArgsEqualityCheckEnforcer` | Controls token whitelist for swap intents |
| `RedeemerEnforcer` | Restricts who can redeem (e.g., only MetaSwap adapter) |

## Tech Stack

- **React + TypeScript + Vite**
- **[@metamask/smart-accounts-kit](https://www.npmjs.com/package/@metamask/smart-accounts-kit)** — Delegation creation, signing, redemption
- **[@safe-global/safe-apps-react-sdk](https://www.npmjs.com/package/@safe-global/safe-apps-react-sdk)** — Safe App integration
- **[wagmi](https://wagmi.sh/)** + **[viem](https://viem.sh/)** — Wallet connection and onchain interactions
- **[@web3auth/modal](https://www.npmjs.com/package/@web3auth/modal)** — Embedded wallet (social login)
- **[Tailwind CSS](https://tailwindcss.com/)** — Styling

## Getting Started

```bash
# Clone
git clone https://github.com/osobot-ai/gator-safe-app.git
cd gator-safe-app

# Install
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your VITE_WEB3AUTH_CLIENT_ID

# Run
npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_WEB3AUTH_CLIENT_ID` | Web3Auth client ID from the [Embedded Wallets Dashboard](https://dashboard.web3auth.io/) |

## Contract Addresses (Base)

| Contract | Address |
|----------|---------|
| DelegationManager | `0x0` (from SDK environment) |
| DelegationMetaSwapAdapter | `0x5e4b49156D23D890e7DC264c378a443C2d22A80E` |
| ArgsEqualityCheckEnforcer | `0x44B8C6ae3C304213c3e298495e12497Ed3E56E41` |
| RedeemerEnforcer | `0xE144b0b2618071B4E56f746313528a669c7E65c5` |
| ERC20PeriodTransferEnforcer | `0x474e3ae7e169e940607cc624da8a15eb120139ab` |

## Built By

Built by [Osobot](https://x.com/Osobotai) 🐻 — an AI agent working for [@McOso_](https://x.com/McOso_) at MetaMask.

⚠️ The smart contracts are all audited, but this app was built by an AI agent — use at your own risk.

## Links

- [ERC-7710 Delegation Framework Docs](https://docs.delegations.org/)
- [MetaMask Smart Accounts Kit](https://docs.metamask.io/smart-accounts/)
- [DelegationMetaSwapAdapter](https://github.com/MetaMask/delegation-framework/blob/main/src/helpers/DelegationMetaSwapAdapter.sol)
