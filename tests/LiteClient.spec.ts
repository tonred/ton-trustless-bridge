import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { sha256_sync } from '@ton/crypto';
import { beginCell, Cell, convertToMerkleProof, toNano } from '@ton/core';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { ErrorCodes, LiteClient, LiteClientConfig, Opcodes } from '../wrappers/LiteClient';
import { FeesTracker } from '../scripts/imports/utils/fees';
import {
    packSignatures,
    parseConfigParamValidators,
    prepareValidatorsList,
    verifyBlockSignature,
} from '../scripts/imports/validators';
import { getConfigFromBlock, getSeqnoFromBlock, prepareKeyBlock } from '../scripts/imports/block';
import { FastnetTestData, TestData, TestnetnTestData } from './data';

function checkStateToBeEqual(state: LiteClientConfig, seqno: number, configCell: Cell) {
    const config = parseConfigParamValidators(configCell);
    const { cutoffWeight, newValidatorsList } = prepareValidatorsList(config.main, config.validatorsCell);
    expect(state.currentSeqno).toBe(seqno);
    expect(state.currentEpochSince).toBe(config.utimeSince);
    expect(state.currentEpochUntil).toBe(config.utimeUntil);
    expect(state.currentCutoffWeight).toBe(cutoffWeight);
    expect(state.currentValidatorsList).toEqualCell(newValidatorsList);
}

describe.each([
    [FastnetTestData, 0, 0],
    [TestnetnTestData, 0, 0],
])('LiteClient', (testData: TestData[]) => {
    let code: Cell;
    let totalFees = new FeesTracker('Total');
    let liteClientFees = new FeesTracker('LiteClient');
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let liteClient: SandboxContract<LiteClient>;
    let verbosity = false;

    let setup: () => Promise<void>;

    const syncGenesysBlock = 0;
    afterAll(() => {
        // totalFees.print();
        // liteClientFees.print();
    });
    beforeAll(async () => {
        code = await compile('LiteClient');
        testData.map((data, i) => {
            const block = Cell.fromBase64(data.blockBoc);
            expect(
                verifyBlockSignature(
                    block.hash(),
                    sha256_sync(Buffer.from(data.blockBoc, 'base64')),
                    data.signatures,
                    parseConfigParamValidators(getConfigFromBlock(block).get(32)!)
                        .validators.values()
                        .concat(parseConfigParamValidators(getConfigFromBlock(block).get(34)!).validators.values()),
                ),
            ).toBeTruthy();
        });
        setup = async () => {
            blockchain = await Blockchain.create();
            if (verbosity) {
                blockchain.verbosity = {
                    print: true,
                    blockchainLogs: true,
                    vmLogs: 'vm_logs',
                    debugLogs: true,
                };
            }

            const genesysData = testData[syncGenesysBlock];
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
                    code,
                ),
            );

            deployer = await blockchain.treasury('deployer');

            const deployResult = await liteClient.sendDeploy(deployer.getSender(), toNano('0.05'));
            // await blockchain.setVerbosityForAddress(liteClient.address, 'vm_logs')
            expect(deployResult.transactions).toHaveTransaction({
                from: deployer.address,
                to: liteClient.address,
                deploy: true,
                success: true,
            });
            const stateAfterDeploy = await liteClient.getState();
            checkStateToBeEqual(stateAfterDeploy, genesysSeqno, genesysConfigCell);
        };
    });

    beforeEach(async () => {
        await setup();
    });

    // it('should sync new key block', async () => {
    //
    // });

    it('should sync new key blocks', async () => {
        const syncer = await blockchain.treasury('key block syncer');
        for (let i = 1; i < testData.length; i++) {
            const nextTestData = testData[syncGenesysBlock + i];
            const nextKeyBlock = Cell.fromBase64(nextTestData.blockBoc);
            const nextKeyBlockSignatures = nextTestData.signatures;
            const nextKeyBlockFileHash = sha256_sync(Buffer.from(nextTestData.blockBoc, 'base64'));
            const nextSeqno = getSeqnoFromBlock(nextKeyBlock);
            const nextConfigCell = getConfigFromBlock(nextKeyBlock).get(34)!;
            const stateBefore = await liteClient.getState();
            const checkBlockResult = await liteClient.sendCheckBlock(syncer.getSender(), {
                value: toNano('0.05'),
                block: {
                    fileHash: nextKeyBlockFileHash,
                    rootHash: prepareKeyBlock(nextKeyBlock).refs[0].hash(0),
                },
                signatures: packSignatures(
                    nextKeyBlockSignatures,
                    stateBefore.currentCutoffWeight,
                    stateBefore.currentValidatorsList,
                ),
            });
            totalFees.addManyTx(checkBlockResult.transactions);
            liteClientFees.addTxRaw(checkBlockResult.transactions[1].raw);
            expect(checkBlockResult.transactions).toHaveTransaction({
                from: syncer.address,
                to: liteClient.address,
                op: Opcodes.checkBlock,
                success: true,
            });
            expect(checkBlockResult.transactions).toHaveTransaction({
                from: liteClient.address,
                to: syncer.address,
                success: true,
                op: Opcodes.correct,
            });
            const sendNewKeyBlockResult = await liteClient.sendNewKeyBlock(syncer.getSender(), {
                value: toNano('0.1'),
                block: {
                    fileHash: nextKeyBlockFileHash,
                    blockProof: prepareKeyBlock(nextKeyBlock),
                },
                signatures: packSignatures(
                    nextKeyBlockSignatures,
                    stateBefore.currentCutoffWeight,
                    stateBefore.currentValidatorsList,
                ),
            });
            totalFees.addManyTx(sendNewKeyBlockResult.transactions);
            liteClientFees.addTxRaw(sendNewKeyBlockResult.transactions[1].raw);
            expect(sendNewKeyBlockResult.transactions).toHaveTransaction({
                from: syncer.address,
                to: liteClient.address,
                op: Opcodes.newKeyBlock,
                success: true,
            });
            expect(sendNewKeyBlockResult.transactions).toHaveTransaction({
                from: liteClient.address,
                to: syncer.address,
                success: true,
                op: Opcodes.ok,
            });
            const stateAfter = await liteClient.getState();
            checkStateToBeEqual(stateAfter, nextSeqno, nextConfigCell);
        }
    });
    describe('should handle Merkle Proofs correctly', () => {
        let stateBefore;
        let block: Cell;
        let blockData: {
            fileHash: Buffer;
            rawBlock: Cell;
        };
        let signatures: Cell;
        let syncer: SandboxContract<any>;

        beforeAll(async () => {
            await setup();

            const nextTestData = testData[syncGenesysBlock + 1];
            const nextKeyBlock = Cell.fromBase64(nextTestData.blockBoc);
            block = nextKeyBlock;
            const nextKeyBlockSignatures = nextTestData.signatures;
            const nextKeyBlockFileHash = sha256_sync(Buffer.from(nextTestData.blockBoc, 'base64'));

            stateBefore = await liteClient.getState();
            blockData = {
                fileHash: nextKeyBlockFileHash,
                rawBlock: prepareKeyBlock(nextKeyBlock),
            };
            signatures = packSignatures(
                nextKeyBlockSignatures,
                stateBefore.currentCutoffWeight,
                stateBefore.currentValidatorsList,
            );
        });
        it('should reject non-exotic cell', async () => {
            syncer = await blockchain.treasury('key block syncer');
            const proof = convertToMerkleProof(block).beginParse(true);
            proof.loadRef();
            const sendNewKeyBlockResult = await liteClient.sendNewKeyBlock(syncer.getSender(), {
                value: toNano('0.05'),
                block: {
                    fileHash: blockData.fileHash,
                    blockProof: beginCell().storeSlice(proof).endCell(),
                },
                signatures: signatures,
            });
            expect(sendNewKeyBlockResult.transactions).toHaveTransaction({
                from: syncer.address,
                to: liteClient.address,
                op: Opcodes.newKeyBlock,
                success: false,
                exitCode: ErrorCodes.notExotic,
            });
        });
        it('should reject non Merkle Proof cell', async () => {
            syncer = await blockchain.treasury('key block syncer');
            const libraryRef = beginCell()
                .storeUint(2, 8)
                .storeBuffer(blockData.rawBlock.hash(0))
                .endCell({ exotic: true });

            const sendNewKeyBlockResult = await liteClient.sendNewKeyBlock(syncer.getSender(), {
                value: toNano('0.05'),
                block: {
                    fileHash: blockData.fileHash,
                    blockProof: libraryRef,
                },
                signatures: signatures,
            });
            expect(sendNewKeyBlockResult.transactions).toHaveTransaction({
                from: syncer.address,
                to: liteClient.address,
                op: Opcodes.newKeyBlock,
                success: false,
                exitCode: ErrorCodes.notMerkleProof,
            });
        });
        it.skip('should reject Merkle Proof with invalid hash', async () => {
            syncer = await blockchain.treasury('key block syncer');

            let originalProof = blockData.rawBlock.beginParse(true);
            originalProof.loadRef();
            const fakeProof = beginCell()
                .storeSlice(originalProof)
                .storeRef(blockData.rawBlock.refs[0].asBuilder().storeStringTail('modified').endCell())
                .endCell({ exotic: true });

            let error = '';
            try {
                const sendNewKeyBlockResult = await liteClient.sendNewKeyBlock(syncer.getSender(), {
                    value: toNano('0.05'),
                    block: {
                        fileHash: blockData.fileHash,
                        blockProof: fakeProof,
                    },
                    signatures: signatures,
                });
            } catch (e: any) {
                error = e.toString();
            }
            expect(error).toBe(
                'Error: Error while executing transaction: ' +
                    "Can't deserialize message boc: " +
                    '[Error : 0 : invalid bag-of-cells failed to deserialize cell #4 ' +
                    '[Error : 0 : Hash mismatch in a MerkleProof special cell]]',
            );
        });
    });
});
