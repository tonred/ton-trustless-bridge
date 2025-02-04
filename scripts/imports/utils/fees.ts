import { Cell, fromNano, loadTransaction, TransactionDescriptionGeneric } from '@ton/core';
import { TransactionComputeVm } from '@ton/core/src/types/TransactionComputePhase';
import * as fs from 'node:fs';
import { BlockchainTransaction } from '@ton/sandbox/dist/blockchain/Blockchain';

export class FeesTracker {
    public fees: {
        totalActionFees: bigint;
        totalFwdFees: bigint;
        gasFees: bigint;
        totalFees: bigint;
    };

    constructor(
        public name: string,
        tx?: Cell,
    ) {
        if (tx) {
            const parsedTx = loadTransaction(tx.beginParse());
            const txDescription = parsedTx.description as TransactionDescriptionGeneric;
            this.fees = {
                totalActionFees: txDescription.actionPhase?.totalActionFees ?? 0n,
                totalFwdFees: txDescription.actionPhase?.totalFwdFees ?? 0n,
                gasFees: (txDescription.computePhase as TransactionComputeVm).gasFees,
                totalFees: parsedTx.totalFees.coins,
            };
        } else {
            this.fees = {
                totalActionFees: 0n,
                totalFwdFees: 0n,
                gasFees: 0n,
                totalFees: 0n,
            };
        }
    }

    protected loadSaved(): any {
        fs.readFile('./fees.json', (err) => {
            if (err) {
                console.error(err);
            } else {
            }
        });
    }

    protected saveResults() {
        const content = JSON.stringify({});
        fs.writeFile('./fees.json', content, (err) => {
            if (err) {
                console.error(err);
            } else {
                // file written successfully
            }
        });
    }

    protected p(x: bigint) {
        return ((Number(x) / Number(this.fees.totalFees)) * 100).toFixed(2);
    }

    protected formatRow(v: bigint, name: string): string {
        return `${name} fees:\t${v}(${parseFloat(fromNano(v)).toFixed(3)})\t(${this.p(v)}%)\n`;
    }

    public print() {
        console.log(
            `${this.name} fees:\n` +
                this.formatRow(this.fees.totalFees, 'Total') +
                this.formatRow(this.fees.gasFees, 'Gas') +
                this.formatRow(this.fees.totalFwdFees, 'Fwd') +
                this.formatRow(this.fees.totalActionFees, 'Act.') +
                this.formatRow(
                    this.fees.totalFees - (this.fees.gasFees + this.fees.totalFwdFees + this.fees.totalActionFees),
                    '?',
                ),
        );
    }

    public compare(other: FeesTracker) {}

    public addManyTx(txs: BlockchainTransaction[]) {
        for (let tx of txs) {
            this.addTxRaw(tx.raw);
        }
    }

    public addTxRaw(tx: Cell) {
        const other = new FeesTracker('', tx);
        this.add(other);
    }

    public add(other: FeesTracker) {
        this.fees = {
            totalActionFees: this.fees.totalActionFees + other.fees.totalActionFees,
            totalFwdFees: this.fees.totalFwdFees + other.fees.totalFwdFees,
            gasFees: this.fees.gasFees + other.fees.gasFees,
            totalFees: this.fees.totalFees + other.fees.totalFees,
        };
    }
}
