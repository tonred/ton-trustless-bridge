import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, convertToMerkleProof, fromNano, toNano } from '@ton/core';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { sha256_sync } from '@ton/crypto';
import { ErrorCodes, Opcodes, TransactionChecker } from '../wrappers/TransactionChecker';
import { Opcodes as LiteClientOpcodes, ErrorCodes as LiteClientErrorCodes, LiteClient } from '../wrappers/LiteClient';
import { FastnetTestData, TestData, TestnetnTestData } from './data';
import {
    getConfigFromBlock,
    getSeqnoFromBlock,
    getTransactionsFromBlock,
    prepareBlock,
} from '../scripts/imports/block';
import { packSignatures, parseConfigParamValidators, prepareValidatorsList } from '../scripts/imports/validators';
import { convertToPrunedBranch } from '../scripts/imports/utils/cell';

describe.each([
    [FastnetTestData, 0, 0],
    [TestnetnTestData, 0, 0],
])('TransactionChecker', (testData: TestData[]) => {
    let code: Cell;
    let liteClientCode: Cell;
    beforeAll(async () => {
        code = await compile('TransactionChecker');
        liteClientCode = await compile('LiteClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let transactionChecker: SandboxContract<TransactionChecker>;
    let liteClient: SandboxContract<LiteClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        const genesysData = testData[0];
        const genesysBlock = Cell.fromBase64(genesysData.blockBoc);
        const genesysSeqno = getSeqnoFromBlock(genesysBlock);
        const genesysConfigCell = getConfigFromBlock(genesysBlock).get(34)!;
        const genesysConfig = parseConfigParamValidators(genesysConfigCell);
        const { cutoffWeight, newValidatorsList } = prepareValidatorsList(
            genesysConfig.main,
            genesysConfig.validatorsCell,
        );
        liteClient = blockchain.openContract(
            LiteClient.createFromConfig(
                {
                    currentSeqno: genesysSeqno,
                    currentEpochSince: genesysConfig.utimeSince,
                    currentEpochUntil: genesysConfig.utimeUntil,
                    currentCutoffWeight: cutoffWeight,
                    currentValidatorsList: newValidatorsList,
                },
                liteClientCode,
            ),
        );
        const liteClientDeployResult = await liteClient.sendDeploy(deployer.getSender(), toNano('0.05'));
        expect(liteClientDeployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: liteClient.address,
            deploy: true,
            success: true,
        });
        transactionChecker = blockchain.openContract(
            TransactionChecker.createFromConfig(
                {
                    liteClient: liteClient.address,
                },
                code,
            ),
        );
        const deployResult = await transactionChecker.sendDeploy(deployer.getSender(), toNano('0.05'));
        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: transactionChecker.address,
            deploy: true,
            success: true,
        });
    });

    it('should check transactions', async () => {
        const client = await blockchain.treasury('client');
        const nextTestData = testData[1];
        const block = Cell.fromBase64(nextTestData.blockBoc);
        const blockSignatures = nextTestData.signatures;
        const blockFileHash = sha256_sync(Buffer.from(nextTestData.blockBoc, 'base64'));
        const blockTransactions = getTransactionsFromBlock(block);
        const stateBefore = await liteClient.getState();
        for (let tx of blockTransactions) {
            let signatures = packSignatures(
                blockSignatures,
                stateBefore.currentCutoffWeight,
                stateBefore.currentValidatorsList,
            );
            const checkTxResult = await transactionChecker.sendCheckTransaction(client.getSender(), {
                value: toNano('0.05'),
                proof: {
                    fileHash: blockFileHash,
                    signatures: signatures,
                    blockProof: prepareBlock(block, [tx.id]),
                },
                transaction: {
                    accountBlockId: tx.accountBlockId,
                    lt: tx.lt,
                    proof: convertToMerkleProof(convertToPrunedBranch(tx.raw)),
                },
            });
            expect(checkTxResult.transactions).toHaveTransaction({
                from: client.address,
                to: transactionChecker.address,
                op: Opcodes.checkTransaction,
                success: true,
            });
            expect(checkTxResult.transactions).toHaveTransaction({
                from: transactionChecker.address,
                to: liteClient.address,
                op: LiteClientOpcodes.checkBlock,
                success: true,
            });
            expect(checkTxResult.transactions).toHaveTransaction({
                from: liteClient.address,
                to: transactionChecker.address,
                op: LiteClientOpcodes.correct,
                success: true,
            });
            expect(checkTxResult.transactions).toHaveTransaction({
                from: transactionChecker.address,
                to: client.address,
                success: true,
                op: Opcodes.transactionChecked,
            });
        }
    });
    it('should not check non exists transactions', async () => {
        const client = await blockchain.treasury('client');
        const nextTestData = testData[1];
        const block = Cell.fromBase64(nextTestData.blockBoc);
        const blockSignatures = nextTestData.signatures;
        const blockFileHash = sha256_sync(Buffer.from(nextTestData.blockBoc, 'base64'));
        const blockTransactions = getTransactionsFromBlock(block);
        const stateBefore = await liteClient.getState();
        for (let tx of blockTransactions) {
            let signatures = packSignatures(
                blockSignatures,
                stateBefore.currentCutoffWeight,
                stateBefore.currentValidatorsList,
            );
            const checkTxResult = await transactionChecker.sendCheckTransaction(client.getSender(), {
                value: toNano('0.05'),
                proof: {
                    fileHash: blockFileHash,
                    signatures: signatures,
                    blockProof: prepareBlock(block, [tx.id]),
                },
                transaction: {
                    accountBlockId: tx.accountBlockId,
                    lt: tx.lt,
                    proof: convertToMerkleProof(convertToPrunedBranch(Cell.EMPTY)),
                },
            });
            expect(checkTxResult.transactions).toHaveTransaction({
                from: client.address,
                to: transactionChecker.address,
                op: Opcodes.checkTransaction,
                success: false,
                exitCode: ErrorCodes.invalidTxHash,
            });
        }
    });
    it('should not check transactions with modified block', async () => {
        const client = await blockchain.treasury('client');
        const nextTestData = testData[1];
        const block = Cell.fromBase64(nextTestData.blockBoc);
        const blockSignatures = nextTestData.signatures;
        const blockFileHash = sha256_sync(Buffer.from(nextTestData.blockBoc, 'base64'));
        const blockTransactions = getTransactionsFromBlock(block);
        const stateBefore = await liteClient.getState();
        for (let tx of blockTransactions) {
            let signatures = packSignatures(
                blockSignatures,
                stateBefore.currentCutoffWeight,
                stateBefore.currentValidatorsList,
            );
            let cs = block.asSlice();
            cs.loadUint(32);
            let fakeBlock = beginCell().storeUint(123, 32).storeSlice(block.asSlice()).endCell();
            const checkTxResult = await transactionChecker.sendCheckTransaction(client.getSender(), {
                value: toNano('0.05'),
                proof: {
                    fileHash: blockFileHash,
                    signatures: signatures,
                    blockProof: prepareBlock(fakeBlock, [tx.id]),
                },
                transaction: {
                    accountBlockId: tx.accountBlockId,
                    lt: tx.lt,
                    proof: convertToMerkleProof(convertToPrunedBranch(tx.raw)),
                },
            });
            expect(checkTxResult.transactions).toHaveTransaction({
                from: client.address,
                to: transactionChecker.address,
                op: Opcodes.checkTransaction,
                success: true,
            });
            expect(checkTxResult.transactions).toHaveTransaction({
                from: transactionChecker.address,
                to: liteClient.address,
                op: LiteClientOpcodes.checkBlock,
                success: false,
                exitCode: LiteClientErrorCodes.invalidBlockSignature,
            });
        }
    });
});
