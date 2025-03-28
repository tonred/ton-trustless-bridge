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

export type TransactionCheckerConfig = {
    liteClient: Address;
    epochsCounter?: number;
    epochsCache?: Dictionary<number, Cell>;
    id?: number;
};

export const Opcodes = {
    checkTransaction: 0xddab5b88,
    transactionChecked: 0x756adff1,
};


export function transactionCheckerConfigToCell(config: TransactionCheckerConfig): Cell {
    return beginCell()
        .storeAddress(config.liteClient)
        .storeUint(config.epochsCounter ?? 0, 16)
        .storeDict(config.epochsCache ?? Dictionary.empty(Dictionary.Keys.Uint(32), Dictionary.Values.Cell()))
        .storeUint(config.id ?? 0, 32)
        .endCell();
}

export class TransactionChecker implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new TransactionChecker(address);
    }

    static createFromConfig(config: TransactionCheckerConfig, code: Cell, workchain = 0) {
        const data = transactionCheckerConfigToCell(config);
        const init = { code, data };
        return new TransactionChecker(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendCheckTransaction(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: string | bigint;
            transaction: {
                hash: Buffer;
                accountBlockId: Buffer;
                lt: bigint;
            };
            proofChain: Cell;
        },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.checkTransaction, 32)
                .storeRef(opts.proofChain)
                .storeRef(
                    beginCell()
                        .storeBuffer(opts.transaction.accountBlockId, 32)
                        .storeUint(opts.transaction.lt, 64)
                        .storeBuffer(opts.transaction.hash, 32)
                        .endCell(),
                )
                .endCell(),
        });
    }
}
