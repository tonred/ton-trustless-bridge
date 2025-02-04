import { Cell, OpenedContract, toNano } from '@ton/core';
import { TransactionChecker } from '../wrappers/TransactionChecker';
import { compile, NetworkProvider } from '@ton/blueprint';
import { TransactionCheckerContactless } from '../wrappers/TransactionCheckerContactless';
import { selectNetwork } from './imports/ui';
import { LiteClient } from '../wrappers/LiteClient';
import { Client } from './imports/client';
import { getPrevKeyBlockSeqnoFromBlock, getSeqnoFromBlock, prepareKeyBlock } from './imports/block';
import { packSignatures } from './imports/validators';
import { sha256, sha256_sync } from '@ton/crypto';

function delay(s: number) {
    return new Promise((resolve) => setTimeout(resolve, s * 1000));
}

async function getLastKeySeqno(client: Client) {
    const mcInfo = await client.liteClient.getMasterchainInfo();
    let lastId = {
        workchain: mcInfo.last.workchain,
        seqno: mcInfo.last.seqno,
        shard: mcInfo.last.shard,
    };
    const lastBlockHeader = await client.httpClient.getBlockHeader(lastId);
    return lastBlockHeader.prev_key_block_seqno;
}

async function sendNewKeyBlock(
    provider: NetworkProvider,
    client: Client,
    liteClient: OpenedContract<LiteClient>,
    newSeqno: number,
) {
    let state = await liteClient.getState();
    const mcInfo = await client.liteClient.getMasterchainInfo();
    const keyBlockFullId = await client.httpClient.lookUpBlock(mcInfo.last.workchain, mcInfo.last.shard, newSeqno);
    const nextKeyBlockData = (await client.liteClient.getBlock(keyBlockFullId)).data;
    const nextKeyBlockFileHash = await sha256(nextKeyBlockData);
    const nextKeyBlock = Cell.fromBoc(nextKeyBlockData)[0];
    const prevKeyBlockSeqno = getPrevKeyBlockSeqnoFromBlock(nextKeyBlock);
    if (state.currentSeqno < prevKeyBlockSeqno) {
        await sendNewKeyBlock(provider, client, liteClient, prevKeyBlockSeqno);
    }

    state = await liteClient.getState();
    if (state.currentSeqno !== prevKeyBlockSeqno) {
        throw Error('Failed to Sync new key blocks');
    }
    const signatures = await client.httpClient.getMasterchainBlockSignatures(newSeqno);
    await liteClient.sendNewKeyBlock(provider.sender(), {
        value: toNano('0.05'),
        block: {
            fileHash: nextKeyBlockFileHash,
            blockProof: prepareKeyBlock(nextKeyBlock),
        },
        signatures: packSignatures(signatures, state.currentCutoffWeight, state.currentValidatorsList),
    });
    for (let i = 0; i < 10; i++) {
        await delay(2);
        state = await liteClient.getState();
        if (state.currentSeqno == newSeqno) {
            break;
        }
    }
    if (state.currentSeqno == newSeqno) {
        console.log(`New key block ${state.currentSeqno} successfully synced`);
    } else {
        throw Error('Failed to Sync new key blocks');
    }
}

async function syncNewBlock(
    provider: NetworkProvider,
    client: Client,
    liteClient: OpenedContract<LiteClient>,
    stateSeqno: number,
    waitForNew: boolean,
) {
    while (true) {
        const lastKeySeqno = await getLastKeySeqno(client);
        if (stateSeqno == lastKeySeqno) {
            console.log('No new key blocks found');
        } else if (stateSeqno > lastKeySeqno) {
            console.log('LiteClient current key block seqno is grater then in network');
            console.log('May be RPC error or wrong network');
            return false;
        } else {
            console.log(`Found a new key block ${lastKeySeqno}, sending it to LiteClient`);
            await sendNewKeyBlock(provider, client, liteClient, lastKeySeqno);
        }
        if (waitForNew) {
            await delay(60);
        } else {
            break;
        }
    }
    return true;
}

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const liteClientAddress = await ui.inputAddress('Input LiteClient contract address: ');
    const liteClient = provider.open(LiteClient.createFromAddress(liteClientAddress));
    let state;
    try {
        state = await liteClient.getState();
    } catch (e) {
        console.log('LiteClient not found or not valid address');
        return;
    }
    console.log('Found LiteClient with state:', state);
    const network = await selectNetwork('to sync blocks from', provider);
    const client = new Client(network);
    await client.setupLiteClient();
    const r = await syncNewBlock(provider, client, liteClient, state.currentSeqno, false);
    if (!r) {
        return;
    }
    if (await ui.prompt('Wait for new key blocks?')) {
        const r = await syncNewBlock(provider, client, liteClient, state.currentSeqno, true);
    }
}
