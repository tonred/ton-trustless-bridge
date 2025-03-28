import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    Sender,
    SendMode,
} from '@ton/core';

export type LiteClientConfig = {
    currentEpochId: number;
    pastEpochs: Dictionary<number, Cell>;
    pastEpochsCounter?: number;

    id?: number;
};

export function liteClientConfigToCell(config: LiteClientConfig): Cell {
    return beginCell()
        .storeUint(config.currentEpochId, 32)
        .storeUint(config.pastEpochsCounter ?? 1, 16)
        .storeUint(config.id ?? 0, 32)
        .storeDict(config.pastEpochs)
        .endCell();
}

export const Opcodes = {
    newKeyBlock: 0x11a78ffe,
    ok: 0xff8ff4e1,
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
        console.log(opts);
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

    async getBalance(provider: ContractProvider) {
        return (await provider.getState()).balance;
    }

    async getState(provider: ContractProvider) {
        const result = await provider.get('get_state', []);
        return {
            currentEpochSince: result.stack.readNumber(),
            pastEpochs: result.stack.readCell(),
            currentEpochData: result.stack.readCell(),
        };
    }
}
