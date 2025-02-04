# TON Trustless Bridge Challenge

#### Repository: [github.com/tonred/ton-trustless-bridge](https://github.com/tonred/ton-trustless-bridge)

Some method signatures have been slightly modified to allow for more convenient interactions between contracts.

For example:

- The check_transaction method does not include a query_id.
- When calling methods, there is no way to pass callback data (e.g. the recipient of the verification result) without
  saving it in the contract.

See  [bridge.tlb](./bridge.tlb) for the data structures and method signatures.

## Deployed contracts

### Testnet:

- LiteClient: `EQAkoSjJre8IppSBXcaQfXZpOdBPGN2CdcKebq4gsVMb33il`
- TransactionChecker: `EQBc-KmVHKA5Glo6tm-nRYtqVUuB4o6cNU5DR4Qv36YV249J`

### Fastnet:

- LiteClient: `Ef-JQBay-l4MvYA-9rH9rM_RgRhVW_sJAPtZy1wD41tfxGdd`
- TransactionChecker: `Ef_LluiK9bUX7sUyZAatMjQKrWw01JA-F236cibbv_CQKMui`

## Example of transactions

### Fastnet->Testnet

### Valid

- `new_key_block`:  `5368e2128a51f2af4dc37b40dfdf353d508d005c34b914069e9d3d35a56b0c11`
- `check_block`: `d210046721f24f12b836495453c4ed5bd976864c4f1eefa6c649bbc6d57dd52e`
- `check_transaction`: `1b926ecb66cd721588ea368955fe5b80508982260110f386b3df4de213dd3350`

### Fake

- `check_block`: `ef77060cff25edf0a4a4a15ba145b11323fcd5cef28eead6156d32606c022f81` - modified block
- `check_transaction`: `44c2ec4c5f176984632903b0511887693cf31d21a8e8fdd2ccc37fa27816321c` - non exists txt

### Testnet->Fastnet

- `new_key_block`: `TBD`
- `check_block`: `TBD`
- `check_transaction`: `TBD`

# Contracts

## LiteClient

(Details to be added.)

## TransactionChecker

This contract interacts with the LiteClient in the traditional way using messages.

## TransactionCheckerContactless

This contract does not send any messages to the LiteClient. Instead, it verifies the proof of the LiteClient's state and checks the signature itself. This approach enables the construction of a bridge with very high bandwidth. In a single transaction, you can verify the validity of a transaction on another network—where traditionally at least three transactions would be required.

Furthermore, the same method for proving account state can be used in the bridge. This allows you to prove not only transactions but also account states, and it will work for both the masterchain and any shardchain.
> **_NOTE:_** This contract is not ready yet. It is almost complete, but it has not been tested properly on the network.

## Scripts and flow

### Config

Before running scripts update [config.ts](./config.ts) as needed

### Deploy Contracts

`npm run deploy`

### Sync new key blocks

`npm run sync`

### Check transactions

`npm run broadcast`

### Run tests

`npm run test`

### Build

`npm run build`

