import { beginCell, Cell, convertToMerkleProof, CurrencyCollection, Dictionary, Slice } from '@ton/core';
import {
    convertRefsToPrunedBranch,
    smartConvertToPrunedBranch,
} from './utils/cell';
import { AccountBlock, AccountBlockDescr, clearAccountBlocks } from './account';
import { parseConfigParamValidators } from './validators';

export function prepareBlock(block: Cell, transactions: Buffer[]) {
    return _clearBlock(block, (extra) => {
        return beginCell()
            .storeRef(smartConvertToPrunedBranch(extra.loadRef()))
            .storeRef(smartConvertToPrunedBranch(extra.loadRef()))
            .storeRef(clearAccountBlocks(extra.loadRef(), transactions))
            .storeRef(smartConvertToPrunedBranch(extra.loadRef()))
            .storeSlice(extra)
            .endCell();
    });
}

export function prepareKeyBlock(block: Cell) {
    return _clearBlock(block, (extra) => {
        return beginCell()
            .storeRef(smartConvertToPrunedBranch(extra.loadRef()))
            .storeRef(smartConvertToPrunedBranch(extra.loadRef()))
            .storeRef(smartConvertToPrunedBranch(extra.loadRef()))
            .storeRef(clearMcExtra(extra.loadRef()))
            .storeSlice(extra)
            .endCell();
    });
}

export function getTransactionsFromBlock(block: Cell) {
    let txs: {
        id: Buffer;
        lt: bigint;
        accountBlockId: Buffer;
        raw: Cell;
    }[] = [];
    const accountBlocksCell = block.refs[3].refs[2];
    const accountBlocks = accountBlocksCell.beginParse().loadDict<
        Buffer,
        {
            currencyCollection: CurrencyCollection;
            accountBlock: AccountBlock;
        }
    >(Dictionary.Keys.Buffer(32), AccountBlockDescr);
    for (let accountBlockId of accountBlocks.keys()) {
        const { accountBlock } = accountBlocks.get(accountBlockId)!;
        for (let lt of accountBlock.transactions.keys()) {
            let { transaction } = accountBlock.transactions.get(lt)!;
            txs.push({
                lt,
                accountBlockId,
                id: transaction.raw.hash(0),
                raw: transaction.raw,
            });
        }
    }
    return txs;
}

export function getSeqnoFromBlock(block: Cell): number {
    return block.refs[0].beginParse().skip(80).loadUint(32);
}

export function getPrevKeyBlockSeqnoFromBlock(block: Cell): number {
    return block.refs[0].beginParse().skip(504).loadUint(32);
}

export function getConfigFromBlock(block: Cell): Dictionary<number, Cell> {
    const mcBlockExtra = block.refs[3].refs[3];
    return Dictionary.loadDirect(
        Dictionary.Keys.Uint(32),
        Dictionary.Values.Cell(),
        mcBlockExtra.refs.length == 4 ? mcBlockExtra.refs[3] : mcBlockExtra.refs[1],
    );
}

function clearMcExtra(mcExtraCell: Cell) {
    let cs = mcExtraCell.beginParse();
    let newMcExtra = beginCell();

    newMcExtra.storeRef(smartConvertToPrunedBranch(cs.loadRef()));
    if (cs.remainingRefs != 1) {
        newMcExtra.storeRef(smartConvertToPrunedBranch(cs.loadRef()));
        newMcExtra.storeRef(smartConvertToPrunedBranch(cs.loadRef()));
    }
    let config = Dictionary.loadDirect(Dictionary.Keys.Uint(32), Dictionary.Values.Cell(), cs.loadRef());
    const config34 = config.get(34)!;
    const newConfig34 = config34.beginParse();
    newConfig34.loadRef();
    config.set(
        34,
        beginCell().storeSlice(newConfig34).storeRef(parseConfigParamValidators(config34).validatorsCell).endCell(),
    );
    newMcExtra.storeRef(config.generateMerkleProof([34]).refs[0]);
    newMcExtra.storeSlice(cs);
    return newMcExtra.endCell();
}

function _clearBlock(block: Cell, extraFilter: (extra: Slice) => Cell) {
    let cs = block.beginParse();
    const newBlockBuilder = beginCell()
        .storeRef(convertRefsToPrunedBranch(cs.loadRef(), [0, 1, 2, 3]))
        .storeRef(smartConvertToPrunedBranch(cs.loadRef()))
        .storeRef(smartConvertToPrunedBranch(cs.loadRef()));
    const extra = cs.loadRef().beginParse();
    let newBlock = newBlockBuilder.storeRef(extraFilter(extra)).storeSlice(cs).endCell();
    if (!newBlock.hash(0).equals(block.hash())) {
        throw Error('Failed to clean Block');
    }
    return convertToMerkleProof(newBlock);
}

export function loadShardDescrFromProof(proof: Cell) {
    let wc = proof.refs[0].refs[3].refs[0]
        .beginParse()
        .loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell())
        .get(0)!;
    let cs = wc.beginParse();
    while (cs.loadBit()) {
        let left = cs.loadRef();
        cs = left.isExotic ? cs.loadRef().beginParse() : left.beginParse();
    }

    return beginCell().storeBit(false).storeSlice(cs).endCell();
}
