import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';

export type TransactionCheckerConfig = {
    liteClient: Address;
    liteClientCode: Cell;
};

export const Opcodes = {
    checkTransaction: 0x91d555f7,
    transactionChecked: 0x756adff1,
};

export const ErrorCodes = {
    notExotic: 101,
    notMerkleProof: 102,
};

export function transactionCheckerConfigToCell(config: TransactionCheckerConfig): Cell {
    return beginCell().storeAddress(config.liteClient).storeRef(config.liteClientCode).endCell();
}

export class TransactionCheckerContactless implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new TransactionCheckerContactless(address);
    }

    static createFromConfig(config: TransactionCheckerConfig, code: Cell, workchain = 0) {
        const data = transactionCheckerConfigToCell(config);
        const init = { code, data };
        return new TransactionCheckerContactless(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    // check_transaction#91d555f7 transaction:^Cell proof:^Cell current_block:^Cell = InternalMsgBody;
    // transaction {
    // }
    // proof {

    // }
    async sendCheckTransaction(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: string | bigint;
            transaction: {
                id: Buffer;
                accountBlockId: Buffer;
                lt: bigint;
            };
            proof: {
                mcSeqno: number;
                blockProof: Cell;
                stateProof: Cell;
                liteClientStateProof: Cell;
                shardProof?: {
                    mcProof: Cell;
                    mcStateProof: Cell;
                };
            };
            queryID?: number;
        },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.checkTransaction, 32)
                .storeRef(
                    beginCell()
                        .storeBuffer(opts.transaction.id, 32)
                        .storeBuffer(opts.transaction.accountBlockId, 32)
                        .storeUint(opts.transaction.lt, 64)
                        .endCell(),
                )
                .storeRef(
                    beginCell()
                        .storeUint(opts.proof.mcSeqno, 32)
                        .storeRef(opts.proof.blockProof)
                        .storeRef(opts.proof.stateProof)
                        .storeRef(opts.proof.liteClientStateProof)
                        .storeMaybeRef(
                            opts.proof.shardProof
                                ? beginCell()
                                      .storeRef(opts.proof.shardProof.mcProof)
                                      .storeRef(opts.proof.shardProof.mcStateProof)
                                      .endCell()
                                : null,
                        )
                        .endCell(),
                )
                .storeUint(opts.queryID ?? 0, 64)
                .endCell(),
        });
    }
}
