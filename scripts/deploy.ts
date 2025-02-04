import { Cell, toNano } from '@ton/core';
import { LiteClient } from '../wrappers/LiteClient';
import { compile, NetworkProvider } from '@ton/blueprint';
import { getConfigFromBlock, getSeqnoFromBlock } from './imports/block';
import { parseConfigParamValidators, prepareValidatorsList } from './imports/validators';
import { selectNetwork } from './imports/ui';
import { Client } from './imports/client';
import { TransactionChecker } from '../wrappers/TransactionChecker';

async function deployTransactionChecker(provider: NetworkProvider) {
    const ui = provider.ui();

    const type = await ui.choose(
        'Select type (see description of differences in README)',
        [
            {
                contract: TransactionChecker,
                name: 'TransactionChecker',
            },
            // {
            //     contract: TransactionCheckerContactless,
            //     name: 'TransactionCheckerContactless',
            // },
        ],
        (v) => v.name,
    );
    const liteClientAddress = await ui.inputAddress('Input LiteClient address');
    const transactionChecker = provider.open(
        type.contract.createFromConfig(
            {
                liteClient: liteClientAddress,
                id: Math.floor(Math.random() * 10000),
            },
            await compile(type.name),
        ),
    );
    console.log(`Deploying ${type.name} `);

    await transactionChecker.sendDeploy(provider.sender(), toNano('0.01'));

    await provider.waitForDeploy(transactionChecker.address);

    console.log(type.name, 'address:', transactionChecker.address);
}

async function deployLiteClient(provider: NetworkProvider) {
    const networkForDeploy = await selectNetwork('to sync blocks from', provider);
    // const networkForBridge = await selectNetwork('bridge', provider);

    const client = new Client(networkForDeploy);
    await client.setupLiteClient();
    const mcInfo = await client.liteClient.getMasterchainInfo();

    let lastId = {
        workchain: mcInfo.last.workchain,
        seqno: mcInfo.last.seqno,
        shard: mcInfo.last.shard,
    };
    const lastBlockHeader = await client.httpClient.getBlockHeader(lastId);
    const keyBlockFullId = await client.httpClient.lookUpBlock(
        mcInfo.last.workchain,
        mcInfo.last.shard,
        lastBlockHeader.prev_key_block_seqno,
    );

    const genesysBlock = Cell.fromBoc((await client.liteClient.getBlock(keyBlockFullId)).data)[0];
    //
    // const genesysData = testData[syncGenesysBlock];
    // const genesysBlock = Cell.fromBase64(genesysData.blockBoc);
    const genesysSeqno = getSeqnoFromBlock(genesysBlock);
    const genesysConfigCell = getConfigFromBlock(genesysBlock).get(34)!;
    const genesysConfig = parseConfigParamValidators(genesysConfigCell);
    const { cutoffWeight, newValidatorsList } = prepareValidatorsList(genesysConfig.main, genesysConfig.validatorsCell);
    const config = {
        currentSeqno: genesysSeqno,
        currentEpochSince: genesysConfig.utimeSince,
        currentEpochUntil: genesysConfig.utimeUntil,
        currentCutoffWeight: cutoffWeight,
        currentValidatorsList: newValidatorsList,
        id: Math.floor(Math.random() * 10000),
    };
    console.log(`Deploying LiteClient with genesys config: `, config);

    const liteClient = provider.open(LiteClient.createFromConfig(config, await compile('LiteClient')));

    await liteClient.sendDeploy(provider.sender(), toNano('0.01'));

    await provider.waitForDeploy(liteClient.address);

    console.log('LiteClient: ', liteClient.address);
}

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const type = await ui.choose(
        'Select contract to deploy:',
        [
            {
                inner: deployLiteClient,
                name: 'LiteClient',
            },
            {
                inner: deployTransactionChecker,
                name: 'TransactionChecker',
            },
        ],
        (v) => v.name,
    );
    await type.inner(provider);
}
