import { beginCell, Builder, Cell, Dictionary, Slice } from '@ton/core';
import { sha256_sync } from '@ton/crypto';

import { signVerify } from '@ton/crypto';

export function verifyBlockSignature(
    rootHash: Buffer,
    fileHash: Buffer,
    signatures: {
        node_id_short: string;
        signature: string;
    }[],
    pubKeys: { pubkey: string; nodeIdShort: string }[],
) {
    let to_sign = new Uint8Array(68);
    to_sign.set([0x70, 0x6e, 0x0b, 0xc5], 0);
    to_sign.set(new Uint8Array(rootHash), 4);
    to_sign.set(new Uint8Array(fileHash), 36);

    for (let signature of signatures) {
        const pubkey = Buffer.from(pubKeys.find((i) => i.nodeIdShort == signature.node_id_short)!.pubkey, 'base64');
        if (!signVerify(Buffer.from(to_sign), Buffer.from(signature.signature, 'base64'), pubkey)) {
            return false;
        }
    }
    return true;
}

export function prepareValidatorsList(mainValidators: number, validatorsCell: Cell) {
    const newValidatorsList = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Buffer(32 + 8));
    const validators = Dictionary.loadDirect(
        Dictionary.Keys.Uint(16),
        Dictionary.Values.Buffer(5 + 32 + 8),
        validatorsCell,
    );
    let totalWeight = 0n;
    for (let k = 0; k < mainValidators; k++) {
        let value = validators.get(k)!;
        value = value.subarray(5);
        totalWeight += value.readBigInt64BE(32);
        newValidatorsList.set(k, value);
    }
    const cutoffWeight = calculateCutoffWeight(totalWeight);
    if (newValidatorsList.keys().length != mainValidators) {
        throw Error('Failed to rebuild validators list');
    }
    return { newValidatorsList: beginCell().storeDictDirect(newValidatorsList).endCell(), cutoffWeight };
}

export function parseConfigParamValidators(configCell: Cell, stripNonMainValidators: boolean = true) {
    const ValidatorDescr = {
        serialize(src: any, builder: Builder) {
            builder.storeUint(src.adnlAddress ? 0x73 : 0x53, 8);
            builder.storeUint(0x8e81278a, 32);
            builder.storeBuffer(Buffer.from(src.pubkey, 'base64'));
            builder.storeUint(src.weight, 64);
            if (src.adnlAddress) {
                builder.storeBuffer(src.adnlAddress);
            }
        },
        parse(src: Slice) {
            const header = src.loadUint(8);

            const pubkey = readPublicKey(src);
            const nodeIdShort = _computeNodeIdShort(pubkey).toString('base64');
            const weight = src.loadUintBig(64);
            let adnlAddress = null;
            if (header === 0x73) {
                adnlAddress = src.loadBuffer(32);
            }
            return { pubkey: pubkey.toString('base64'), nodeIdShort, weight, adnlAddress };
        },
    };
    let cs = configCell.beginParse();
    if (cs.loadUint(8) !== 18) {
        throw Error('unknown ValidatorSetExt tag');
    }
    const utimeSince = cs.loadUint(32);
    const utimeUntil = cs.loadUint(32);
    const total = cs.loadUint(16);
    const main = cs.loadUint(16);
    const totalWeight = cs.loadUintBig(64);
    let validatorsCell = cs.loadRef();
    let validators = validatorsCell.beginParse().loadDictDirect<
        number,
        {
            pubkey: string;
            nodeIdShort: string;
            weight: bigint;
        }
    >(Dictionary.Keys.Uint(16), ValidatorDescr);
    if (stripNonMainValidators) {
        validatorsCell = validators.generateMerkleProof([...Array(main).keys()]).refs[0];
    }
    return { utimeSince, utimeUntil, total, main, totalWeight, validators, validatorsCell };
}

export function packSignatures(
    rawSignatures: { node_id_short: string; signature: string }[],
    cutoffWeight: bigint,
    validatorsCell: Cell,
): Cell {
    let signatures = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Buffer(64));
    let validators = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Buffer(40), validatorsCell);
    let totalWeight = 0n;
    for (let i = 0; i < validators.size; i++) {
        const validator = validators.get(i)!;
        let signature = rawSignatures.find(
            (s) => s.node_id_short == _computeNodeIdShort(validator.subarray(0, 32)).toString('base64'),
        );
        if (signature) {
            signatures.set(i, Buffer.from(signature.signature, 'base64'));
            totalWeight += validator.readBigInt64BE(32);
        }
        if (totalWeight >= cutoffWeight) {
            break;
        }
    }
    if (signatures.size == 0) {
        throw Error('No matching validators signatures found');
    }

    return beginCell().storeDictDirect(signatures).endCell();
}

function readPublicKey(slice: Slice) {
    if (slice.loadUint(32) !== 0x8e81278a) {
        throw Error('Invalid config');
    }
    return slice.loadBuffer(32);
}

function calculateCutoffWeight(total: bigint) {
    return (total * 2n) / 3n + 1n;
}

function _computeNodeIdShort(pubkey: Buffer) {
    let pk = new Uint8Array(36);
    pk.set([0xc6, 0xb4, 0x13, 0x48], 0);
    pk.set(pubkey, 4);
    return sha256_sync(Buffer.from(pk));
}
