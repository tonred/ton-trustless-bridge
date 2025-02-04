import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';

export type LiteClientConfig = {
    currentSeqno: number;
    currentEpochSince: number;
    currentEpochUntil: number;
    currentCutoffWeight: bigint;
    currentValidatorsList: Cell;
    id?: number;
};

export function liteClientConfigToCell(config: LiteClientConfig): Cell {
    return beginCell()
        .storeUint(config.currentSeqno, 32)
        .storeUint(config.currentEpochSince, 32)
        .storeUint(config.currentEpochUntil, 32)
        .storeUint(config.currentCutoffWeight, 64)
        .storeUint(config.id ?? 0, 32)
        .storeRef(config.currentValidatorsList)
        .endCell();
}

export const Opcodes = {
    newKeyBlock: 0x11a78ffe,
    checkBlock: 0x8eaa9d76,
    ok: 0xff8ff4e1,
    correct: 0xce02b807,
};

export const ErrorCodes = {
    notExotic: 101,
    notMerkleProof: 102,
    notKeyBlock: 111,
    keyBlockFromSameEpoch: 112,
    keyBlockFromOldEpoch: 113,
    invalidBlockSignature: 114,
    notEnoughSignatures: 115,
    invalidEpoch: 116,
};

export class LiteClient implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new LiteClient(address);
    }

    static createFromConfig(config: LiteClientConfig, code: Cell, workchain = 0) {
        const data = liteClientConfigToCell(config);
        const init = { code, data };
        return new LiteClient(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendNewKeyBlock(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: string | bigint;
            block: {
                fileHash: Buffer;
                blockProof: Cell;
            };
            signatures: Cell;
            queryID?: number;
        },
    ) {
        provider.getState();
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.newKeyBlock, 32)
                .storeRef(beginCell().storeBuffer(opts.block.fileHash, 32).storeRef(opts.block.blockProof).endCell())
                .storeRef(opts.signatures)
                .storeUint(opts.queryID ?? 0, 64)
                .endCell(),
        });
    }

    async sendCheckBlock(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: string | bigint;
            block: {
                fileHash: Buffer;
                rootHash: Buffer;
            };
            signatures: Cell;
            callback?: Cell;
            queryID?: number;
        },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.checkBlock, 32)
                .storeRef(
                    beginCell().storeBuffer(opts.block.fileHash, 32).storeBuffer(opts.block.rootHash, 32).endCell(),
                )
                .storeRef(opts.signatures)
                .storeUint(opts.queryID ?? 0, 64)
                .storeMaybeRef(opts.callback)
                .endCell(),
        });
    }

    async getBalance(provider: ContractProvider) {
        return (await provider.getState()).balance;
    }

    async getState(provider: ContractProvider) {
        const result = await provider.get('get_state', []);
        return {
            currentSeqno: result.stack.readNumber(),
            currentEpochSince: result.stack.readNumber(),
            currentEpochUntil: result.stack.readNumber(),
            currentCutoffWeight: result.stack.readBigNumber(),
            currentValidatorsList: result.stack.readCell(),
        };
    }
}
