import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, Cell, toNano } from '@ton/core';

import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { sha256_sync } from '@ton/crypto';
import { LiteClient } from '../wrappers/LiteClient';
import { TransactionCheckerContactless, Opcodes } from '../wrappers/TransactionCheckerContactless';
import { FeesTracker } from '../scripts/imports/utils/fees';
import { calcCellStats, pruneUnusedBranches } from '../scripts/imports/utils/cell';
import { FastnetTestData } from './data';
import {
    getConfigFromBlock,
    getSeqnoFromBlock,
    getTransactionsFromBlock,
    loadShardDescrFromProof,
} from '../scripts/imports/block';
import { parseConfigParamValidators, prepareValidatorsList } from '../scripts/imports/validators';
import { prepareAccountState } from '../scripts/imports/account';

describe('TransactionCheckerContactless', () => {
    let code: Cell;
    let liteClientCode: Cell;
    beforeAll(async () => {
        code = await compile('TransactionCheckerContactless');
        liteClientCode = await compile('LiteClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let transactionChecker: SandboxContract<TransactionCheckerContactless>;
    let liteClient: SandboxContract<LiteClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create({});
        deployer = await blockchain.treasury('deployer');
        const genesysData = FastnetTestData[0];
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
        const liteClientDeployResult = await liteClient.sendDeploy(deployer.getSender(), toNano('0.05'));
        expect(liteClientDeployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: liteClient.address,
            deploy: true,
            success: true,
        });
        transactionChecker = blockchain.openContract(
            TransactionCheckerContactless.createFromConfig(
                {
                    liteClientCode: liteClientCode,
                    // liteClient: liteClient.address,
                    liteClient: Address.parse('0QCwVmB8ETsAyfqWtUm4Z5Adu7s_xzuEef6Xz15TL17PKxpM'),
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

    it('should deploy', async () => {
        const client = await blockchain.treasury('client');
        const nextTestData = FastnetTestData[1];
        const block = Cell.fromBase64(nextTestData.blockBoc);
        // const blockSignatures = nextTestData.signatures;
        const blockFileHash = sha256_sync(Buffer.from(nextTestData.blockBoc, 'base64'));
        const blockTransactions = getTransactionsFromBlock(block);
        // await blockchain.setVerbosityForAddress(transactionChecker.address, 'vm_logs_full');
        let proof = Cell.fromBoc(
            Buffer.from(
                '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',
                'base64',
            ),
        );
        let shardProof = Cell.fromBoc(
            Buffer.from(
                'te6ccgECHQIABQ8BAAlGAyPg/VLXE8Kf1adlRXyLJ3gkLpfhikXrjBkaAP8miGZyAcQCCUYDH13KuTyorsYD4XHys/+01iSdsF2fwnO6qo03v9GjHQYAGBUkW5Ajr+L////9AP////8AAAAAAAAAAAGn0wwAAAAAZ6EvHgAAHCjre1zEAafTBmADBAUGKEgBAdCFPoGrGPHCbERdSPkCpN6GkGsgyFQMzCx7ePm4XYuAAAEoSAEBeDxpBxqO6EtE0QuGztomc0rgJNkPAlNlky1+gcotc0ABwyIzAAAAAAAAAAD//////////4Rc499w4beFaCgHCCRVzCaqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsIzoVdZ5ewGRgkKCwwoSAEBK0Qt8ZDewhk3GSINSL3vbGnbFbl8ibpiQoD8Hgrn0TEAAihIAQFTCpElH43oj6IPqpRbUufKF0uU0c5JE+mQSkLkjWXaoQHAIQPQQA0oSAEBNxTgYahiutf3RM8oVpfBwSNBbk6OpY0pzT2Wxj3ikZoAEiK/AAEKBY7aAAWJPWAAA4UdbYNQiAAA4UdLKnA4DT6XYFk2c6n6fE3wCPPSt/E863Am6PG7Xl7+UGPgypf/4DCt3/KwYgrdricp1chi2Vh+mddvNHWME20M/YgeiSmNXfi+ExQoSAEBuhXzZSQV+R0RsKS3BzR9njH0qDaC/PTa6KHARQMiOPgAAiIBwA4PKEgBATH4Es3EQ0PSZZSoLth5jWkPg962IOZZBvEZLP1dwhBOAAIiAcAQEQHbUA4XJzgNPphgAADhR1tg1AAAAOFHW2DUOUfyojNKf//HI7dHCJdAkRMm3xn7KB9zMmd3YCW9AF8KqYaMtumVmvDhvHvYIQ7+POAcfaEuxXqaFHQ9tdx8SBiAACxanQAAAAAAAAAADT6YSz0JeNISKEgBAfkExnIOaTtE3wy7pXkZYjJXDGqcFzTJigmH7QZna/2VAAEAE0D3LkGCB3NZQCAoSAEBtfRe6Q1sR85TpXIHzMWchKQXOxrTrpWsZJtJbid+FooAGShIAQFT2AZpF+A1Iar3PvTOQkTOmx2wGxMYt1pZlzdU9QtwFgAPJBAR71Wq/////RYXGBkBoJvHqYcAAAAABAEBp9MMAAAAAAD/////AAAAAAAAAABnoS8eAAAcKOt7XMAAABwo63tcxC7e2ywABYk9AafTBgGn0uzEAAAACQAAAAAAAAHuGihIAQEYhFT4yOqBoe1Mxynv+RW3Yj3yWO3D35JEIrp/lUCCfwAEKooEqqAQ3PsV//JlHsFDMlAB/22p+E73/5hk4Ma8qY5y1rIj4P1S1xPCn9WnZUV8iyd4JC6X4YpF64wZGgD/JohmcgHEAcQbHChIAQHHuUzopj/3xxB4aPKga+J5/NBDsVBXTpsdHA5Sl1dBtQAHAJgAABwo62wahAGn0wsmcD0MxIIUlUORTJ/hEUJnKrcMaLdskRMgPr25e/SxocvF+7RorSiHTC3kHQ90t61ZenR7SdmgCZahHfXpbI2caIwBA6qgENz7Ff/yZR7BQzJQAf9tqfhO9/+YZODGvKmOctaywOMnsaJ5tkusyH2/+BtshpX3w/p/LfSLibMbhwVY7MEBxAAWaIwBAyPg/VLXE8Kf1adlRXyLJ3gkLpfhikXrjBkaAP8miGZyoxOrwLPzkjhfhrBIjFKR2DjSmBpbY0PsElzq20J8ygUBxAAW',
                'base64',
            ),
        );
        let accountState = Cell.fromBase64(
            'te6ccgECFgEAAzwAAnHACwVmB8ETsAyfqWtUm4Z5Adu7s/xzuEef6Xz15TL17PKyLIWQQz0JeJgAAHCjrPlPDUKl2P9QE0ABAgEU/wD0pBP0vPLICwMAUQAAFJcpqaMXA+ss/3wBI6i1DGvli9en7i18pJR25U0AjtgC0stT5hhAAgEgBAUCAUgGBwT48oMI1xgg0x/TH9MfAvgju/Jk7UTQ0x/TH9P/9ATRUUO68qFRUbryogX5AVQQZPkQ8qP4ACSkyMsfUkDLH1Iwy/9SEPQAye1U+A8B0wchwACfbFGTINdKltMH1AL7AOgw4CHAAeMAIcAC4wABwAORMOMNA6TIyx8Syx/L/xITFBUC5tAB0NMDIXGwkl8E4CLXScEgkl8E4ALTHyGCEHBsdWe9IoIQZHN0cr2wkl8F4AP6QDAg+kQByMoHy//J0O1E0IEBQNch9AQwXIEBCPQKb6Exs5JfB+AF0z/IJYIQcGx1Z7qSODDjDQOCEGRzdHK6kl8G4w0ICQIBIAoLAHgB+gD0BDD4J28iMFAKoSG+8uBQghBwbHVngx6xcIAYUATLBSbPFlj6Ahn0AMtpF8sfUmDLPyDJgED7AAYAilAEgQEI9Fkw7UTQgQFA1yDIAc8W9ADJ7VQBcrCOI4IQZHN0coMesXCAGFAFywVQA88WI/oCE8tqyx/LP8mAQPsAkl8D4gIBIAwNAFm9JCtvaiaECAoGuQ+gIYRw1AgIR6STfSmRDOaQPp/5g3gSgBt4EBSJhxWfMYQCAVgODwARuMl+1E0NcLH4AD2ynftRNCBAUDXIfQEMALIygfL/8nQAYEBCPQKb6ExgAgEgEBEAGa3OdqJoQCBrkOuF/8AAGa8d9qJoQBBrkOuFj8AAbtIH+gDU1CL5AAXIygcVy//J0Hd0gBjIywXLAiLPFlAF+gIUy2sSzMzJc/sAyEAUgQEI9FHypwIAcIEBCNcY+gDTP8hUIEeBAQj0UfKnghBub3RlcHSAGMjLBcsCUAbPFlAE+gIUy2oSyx/LP8lz+wACAGyBAQjXGPoA0z8wUiSBAQj0WfKnghBkc3RycHSAGMjLBcsCUAXPFlAD+gITy2rLHxLLP8lz+wAACvQAye1U',
        );

        let mcSeqno = getSeqnoFromBlock(proof[0].refs[0]);
        if (shardProof) {
            mcSeqno = getSeqnoFromBlock(shardProof[0].refs[0]);
            shardProof[0] = pruneUnusedBranches(shardProof[0], [shardProof[1].refs[0].hash(0).toString('hex')]).cell;
            let shardDescr = loadShardDescrFromProof(shardProof[1]);
            shardProof[1] = pruneUnusedBranches(shardProof[1], [shardDescr.hash(0).toString('hex')]).cell;
        }
        proof[0] = pruneUnusedBranches(proof[0], [proof[1].refs[0].hash(0).toString('hex')]).cell;
        proof[1] = pruneUnusedBranches(proof[1], [accountState.hash(0).toString('hex')]).cell;
        accountState = prepareAccountState(accountState);

        // for (let tx of blockTransactions.slice(2)) {
        let fees = new FeesTracker('A');
        // let totalFees0 = 0n;
        // let totalFees1 = 0n;
        for (let tx of blockTransactions.slice(0, 1)) {
            // console.log(tx)
            const checkTxResult = await transactionChecker.sendCheckTransaction(client.getSender(), {
                value: toNano('0.05'),
                proof: {
                    mcSeqno: mcSeqno,
                    blockProof: proof[0],
                    stateProof: proof[1],
                    liteClientStateProof: accountState,
                    shardProof: {
                        mcProof: shardProof[0],
                        mcStateProof: shardProof[1],
                    },
                },
                // proof: prepareBlock(block, [tx.id]),
                transaction: tx,
            });
            fees.addManyTx(checkTxResult.transactions);
            // totalFees0 += checkTxResult.transactions[0].totalFees.coins;
            // totalFees1 += checkTxResult.transactions[1].totalFees.coins;
            // totalFees += checkTxResult.transactions[1].totalFees.coins;
            expect(checkTxResult.transactions).toHaveTransaction({
                from: client.address,
                to: transactionChecker.address,
                op: Opcodes.checkTransaction,
                success: true,
            });
            // expect(checkTxResult.transactions).toHaveTransaction({
            //     from: transactionChecker.address,
            //     to: client.address,
            //     success: true,
            //     op: Opcodes.transactionChecked,
            // });
        }
        fees.print();
        // console.log(fromNano(totalFees0));
        // console.log(fromNano(totalFees1));
        // const nextSeqno = getSeqnoFromBlock(nextKeyBlock);
        // const nextConfigCell = getConfigFromBlock(nextKeyBlock).get(34)!;
    });
});
