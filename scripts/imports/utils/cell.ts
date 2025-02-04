import { beginCell, Cell, Slice } from '@ton/core';

export function calcCellStats(cell: Cell, countRoot: boolean) {
    let cells = 0;
    let bits = 0;
    let visited = new Map<string, undefined>();
    let pruned = 0;
    let update = 0;
    let proof = 0;

    function addStorage(_c: Cell, _countRoot: boolean) {
        if (_countRoot) {
            bits += _c.bits.length;
            cells += 1;
        }
        for (let r of _c.refs) {
            const rh = r.hash().toString();
            if (!visited.has(rh)) {
                visited.set(rh, undefined);
                switch (r.type) {
                    case 1: {
                        pruned += 1;
                        break;
                    }
                    case 3: {
                        proof += 1;
                        break;
                    }
                    case 4: {
                        update += 1;
                        break;
                    }
                }
                addStorage(r, true);
            }
        }
    }

    addStorage(cell, countRoot);
    return { bits, cells, pruned, update, proof };
}

export function estMsgFee(bits: number, cells: number) {
    const mcCost = {
        lumpPrice: 10000000n,
        bitPrice: 655360000n,
        cellPrice: 65536000000n,
        firstFrac: 21845n,
        nextFrac: 21845n,
    };
    const wcCost = {
        lumpPrice: 400000n,
        bitPrice: 26214400n,
        cellPrice: 2621440000n,
        firstFrac: 21845n,
        nextFrac: 21845n,
    };
    return {
        masterchain: estMsgFeeWithConfig(bits, cells, mcCost),
        workchain: estMsgFeeWithConfig(bits, cells, wcCost),
    };
}

export function estMsgFeeWithConfig(
    bits: number,
    cells: number,
    config: {
        lumpPrice: bigint;
        bitPrice: bigint;
        cellPrice: bigint;
        firstFrac: bigint;
        nextFrac: bigint;
    },
) {
    let msgFees = config.lumpPrice + (config.bitPrice * BigInt(bits) + config.cellPrice * BigInt(cells)) / 65536n;
    let actionFee = (msgFees * config.firstFrac) / 65536n;
    let msgFwdFees = msgFees - actionFee;
    return { msgFees, msgFwdFees, actionFee };
}

function maskFromLevel(level: number) {
    switch (level) {
        case 0:
            return 0;
        case 1:
            return 1;
        case 2:
            return 3;
        case 3:
            return 7;
    }
    return 0;
}

export function convertToPrunedBranch(c: Cell, sameLevel: boolean = false): Cell {
    const level = c.level();
    const newLevel = sameLevel && level > 0 ? level : level + 1;
    let b = beginCell().storeUint(1, 8).storeUint(maskFromLevel(newLevel), 8);
    for (let i = 0; i < newLevel; i++) {
        b.storeBuffer(c.hash(i));
    }
    for (let i = 0; i < newLevel; i++) {
        b.storeUint(c.depth(i), 16);
    }
    return b.endCell({ exotic: true });
}

export function convertRefsToPrunedBranch(c: Cell, refs: number[]): Cell {
    let cs = c.beginParse(c.isExotic);
    let b = beginCell();
    for (let i = 0; i < c.refs.length; i++) {
        let ref = cs.loadRef();
        b.storeRef(refs.includes(i) ? smartConvertToPrunedBranch(ref) : ref);
    }
    return b.storeSlice(cs).endCell({ exotic: c.isExotic });
}

export function smartConvertToPrunedBranch(c: Cell, sameLevel: boolean = false): Cell {
    if (c.bits.length < 288) {
        if (c.refs.length == 0) {
            return c;
        }
        const stats = calcCellStats(c, false);
        if (c.bits.length + stats.bits < 288) {
            if (c.bits.length + stats.bits + stats.cells * 100 <= 288) {
                return c;
            }
        }
    }
    return convertToPrunedBranch(c, sameLevel);
}

export function skipRefs(cs: Slice): Slice {
    for (let i = 0; i < cs.remainingRefs; i++) {
        cs.loadRef();
    }
    return cs;
}

export function replaceCellInTree(c: Cell, hashToReplace: Buffer, newValue: Cell): Cell {
    let cs = c.beginParse(true);
    let newCell = beginCell();
    while (cs.remainingRefs) {
        let ref = cs.loadRef();
        if (ref.hash(0).equals(hashToReplace)) {
            ref = newValue;
        } else {
            ref = replaceCellInTree(ref, hashToReplace, newValue);
        }
        newCell.storeRef(ref);
    }
    newCell.storeSlice(cs);
    return newCell.endCell({ exotic: c.isExotic });
}

export function pruneUnusedBranches(cell: Cell, branchesToSaveHex: string[], pruneTargetChild: boolean = false) {
    let isExotic = cell.isExotic;
    let cs = cell.beginParse(true);
    let newCell = beginCell();
    let refs = cs.remainingRefs;
    let keep = false;
    for (let i = 0; i < refs; i++) {
        let ref = cs.loadRef();
        const r = pruneUnusedBranches(ref, branchesToSaveHex);

        if (r.keep || branchesToSaveHex.includes(ref.hash(0).toString('hex'))) {
            keep = true;
        }
        ref = keep ? r.cell : smartConvertToPrunedBranch(ref, true);
        newCell.storeRef(ref);
    }
    newCell.storeSlice(cs);
    cell = newCell.endCell({ exotic: isExotic });
    if (!keep) {
        cell = smartConvertToPrunedBranch(cell, true);
    }
    return { cell, keep };
}
