# Gator Safe App

ERC-7710 delegation management for Safe multisigs.

Install the MetaMask DeleGatorModule on your Safe and create scoped permissions for delegates — with full multi-sig signing flow.

## Features

- Install Gator (DeleGator) Module on any Safe
- Create ETH spending limit permissions (NativeTokenPeriodTransferEnforcer)
- Create ERC-20 spending limit permissions (ERC20PeriodTransferEnforcer)
- Multi-sig EIP-712 signing flow (propose → collect sigs → threshold)
- Download/copy signed delegations for delegates
- View and revoke active delegations

## Tech Stack

- React + TypeScript + Vite
- Safe Apps SDK + React SDK
- wagmi + viem
- MetaMask Smart Accounts Kit
- Tailwind CSS

## Chains

- Base Sepolia (testing)
- Base (production)

## Development

```bash
npm install
npm run dev
```

## Built by

[Osobot](https://x.com/Osobotai) 🐻 with [Ryan McPeck](https://x.com/McOso)
