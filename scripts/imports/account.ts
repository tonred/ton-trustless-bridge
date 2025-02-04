import {
    Builder,
    Cell,
    convertToMerkleProof,
    CurrencyCollection,
    Dictionary,
    loadAccount,
    loadCurrencyCollection,
    loadTransaction,
    Slice,
    storeCurrencyCollection,
    Transaction,
} from '@ton/core';
import { pruneUnusedBranches, smartConvertToPrunedBranch } from './utils/cell';

export function prepareAccountState(state: Cell) {
    const cs = state.asSlice();
    cs.loadBit();

    const parsedAccount = loadAccount(cs);
    if (parsedAccount.storage.state.type == 'active') {
        state = pruneUnusedBranches(state, [parsedAccount.storage.state.state.data!.hash(0).toString('hex')]).cell;
    }
    return convertToMerkleProof(state);
}

export interface AccountBlock {
    accountAddr: bigint;
    transactions: Dictionary<bigint, { transaction: Transaction; currencyCollection: CurrencyCollection }>;
    hashUpdate: Cell;
}

export const TransactionDescr = {
    serialize(src: any, builder: Builder) {
        storeCurrencyCollection(src.currencyCollection)(builder);
        builder.storeRef(src.rawTx);
    },
    parse(src: Slice) {
        const currencyCollection = loadCurrencyCollection(src);
        const rawTx = src.loadRef();
        const transaction = loadTransaction(rawTx.beginParse());
        return { transaction, currencyCollection, rawTx };
    },
};

export const AccountBlockDescr = {
    serialize(src: any, builder: Builder) {
        storeCurrencyCollection(src.currencyCollection)(builder);
        storeAccountBlock(src.accountBlock, builder);
        builder.storeSlice(src.accountBlock._rest);
    },
    parse(src: Slice) {
        const currencyCollection = loadCurrencyCollection(src);
        const accountBlock = loadAccountBlock(src);
        return { currencyCollection, accountBlock };
    },
};

function loadAccountBlock(slice: Slice) {
    if (slice.loadUint(4) !== 5) {
        throw Error('Invalid data');
    }
    const accountAddr = slice.loadUintBig(256);
    const transactions = slice.loadDictDirect<
        bigint,
        {
            transaction: Transaction;
            currencyCollection: CurrencyCollection;
        }
    >(Dictionary.Keys.BigUint(64), TransactionDescr);
    const hashUpdate = slice.loadRef();
    const _rest = slice;
    return { accountAddr, transactions, hashUpdate, _rest };
}

function storeAccountBlock(accountBlock: AccountBlock, builder: Builder) {
    builder.storeUint(5, 4);
    builder.storeUint(accountBlock.accountAddr, 256);
    if (accountBlock.transactions instanceof Cell) {
        builder.storeSlice(accountBlock.transactions.beginParse(true));
    } else {
        builder.storeDictDirect(accountBlock.transactions);
    }
    builder.storeRef(smartConvertToPrunedBranch(accountBlock.hashUpdate));
    return builder;
}

export function clearAccountBlocks(accountBlocksCell: Cell, transactions: Buffer[]) {
    const r = pruneUnusedBranches(
        accountBlocksCell,
        transactions.map((t) => t.toString('hex')),
        true,
    );
    return r.cell;
}
