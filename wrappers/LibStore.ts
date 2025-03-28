import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';

export type LibStoreConfig = {
    owner: Address;
    id?: number;
};

export function libStoreConfigToCell(config: LibStoreConfig): Cell {
    return beginCell()
        .storeAddress(config.owner)
        .storeUint(config.id ?? 0, 32)
        .endCell();
}

export class LibStore implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new LibStore(address);
    }

    static createFromConfig(config: LibStoreConfig, code: Cell, workchain = -1) {
        const data = libStoreConfigToCell(config);
        const init = { code, data };
        return new LibStore(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint, lib?: Cell) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: lib ? beginCell().storeRef(lib).endCell() : Cell.EMPTY,
        });
    }

    async sendNewLib(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: string | bigint;
            lib: Cell;
        },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeRef(opts.lib).endCell(),
        });
    }
}
