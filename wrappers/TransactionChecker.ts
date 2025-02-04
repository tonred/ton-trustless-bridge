import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';

export type TransactionCheckerConfig = {
    liteClient: Address;
    id?: number;
};

export const Opcodes = {
    checkTransaction: 0x91d555f7,
    transactionChecked: 0x756adff1,
};

export const ErrorCodes = {
    notExotic: 101,
    notMerkleProof: 102,
    txNotFoundInBlock: 200,
    invalidTxHash: 201,
};

export function transactionCheckerConfigToCell(config: TransactionCheckerConfig): Cell {
    return beginCell()
        .storeAddress(config.liteClient)
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
                proof: Cell;
                accountBlockId: Buffer;
                lt: bigint;
            };
            proof: {
                fileHash: Buffer;
                signatures: Cell;
                blockProof: Cell;
            };
            currentBlock?: {
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
                        .storeRef(opts.transaction.proof)
                        .storeBuffer(opts.transaction.accountBlockId, 32)
                        .storeUint(opts.transaction.lt, 64)
                        .endCell(),
                )
                .storeRef(
                    beginCell()
                        .storeBuffer(opts.proof.fileHash, 32)
                        .storeRef(opts.proof.signatures)
                        .storeRef(opts.proof.blockProof)
                        .endCell(),
                )
                .storeRef(
                    opts.currentBlock
                        ? beginCell()
                              .storeUint(opts.currentBlock.mcSeqno, 32)
                              .storeRef(opts.currentBlock.blockProof)
                              .storeRef(opts.currentBlock.stateProof)
                              .storeRef(opts.currentBlock.liteClientStateProof)
                              .storeMaybeRef(
                                  opts.currentBlock.shardProof
                                      ? beginCell()
                                            .storeRef(opts.currentBlock.shardProof.mcProof)
                                            .storeRef(opts.currentBlock.shardProof.mcStateProof)
                                            .endCell()
                                      : null,
                              )
                              .endCell()
                        : Cell.EMPTY,
                )
                .storeUint(opts.queryID ?? 0, 64)
                .endCell(),
        });
    }

    async getLiteClientAddr(provider: ContractProvider) {
        const state = (await provider.getState()).state;
        if (state.type == 'active') {
            return Cell.fromBoc(state.data!)[0].beginParse().loadAddress();
        }
    }
}
