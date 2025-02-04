import { Cell, convertToMerkleProof, toNano } from '@ton/core';
import { TransactionChecker } from '../wrappers/TransactionChecker';
import { NetworkProvider } from '@ton/blueprint';
import { getTransactionsFromBlock, prepareBlock } from './imports/block';
import { selectNetwork } from './imports/ui';
import { Client } from './imports/client';
import { sha256 } from '@ton/crypto';
import { convertToPrunedBranch } from './imports/utils/cell';
import { packSignatures } from './imports/validators';
import { LiteClient } from '../wrappers/LiteClient';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const transactionCheckerAddress = await ui.inputAddress('Input TransactionChecker address:');
    let transactionChecker = provider.open(TransactionChecker.createFromAddress(transactionCheckerAddress));
    const network = await selectNetwork('with which you need to prove the transaction', provider);
    const client = new Client(network);
    await client.setupLiteClient();
    const mcSeqnoWithTx = parseInt(await ui.input('Input masterchain block seqno where tx is located'));
    const mcInfo = await client.liteClient.getMasterchainInfo();
    const keyBlockFullId = await client.httpClient.lookUpBlock(mcInfo.last.workchain, mcInfo.last.shard, mcSeqnoWithTx);

    const blockData = (await client.liteClient.getBlock(keyBlockFullId)).data;
    const block = Cell.fromBoc(blockData)[0];
    const blockTransactions = getTransactionsFromBlock(block);
    const tx = await ui.choose('Select transaction to broadcast', blockTransactions, (t) => {
        return `lt: ${t.lt} hash: ${t.id.toString('hex')}`;
    });
    const liteClient = provider.open(LiteClient.createFromAddress((await transactionChecker.getLiteClientAddr())!));
    const liteClientState = await liteClient.getState();
    const signatures = await client.httpClient.getMasterchainBlockSignatures(mcSeqnoWithTx);
    const blockSignatures = packSignatures(
        signatures,
        liteClientState.currentCutoffWeight,
        liteClientState.currentValidatorsList,
    );
    const blockFileHash = await sha256(blockData);
    await transactionChecker.sendCheckTransaction(provider.sender(), {
        value: transactionChecker.address.workChain == 0 ? toNano('0.05') : toNano('0.5'),
        proof: {
            fileHash: blockFileHash,
            signatures: blockSignatures,
            blockProof: prepareBlock(block, [tx.id]),
        },
        transaction: {
            accountBlockId: tx.accountBlockId,
            lt: tx.lt,
            proof: convertToMerkleProof(convertToPrunedBranch(tx.raw)),
        },
    });
    console.log('Broadcast sent');
}
