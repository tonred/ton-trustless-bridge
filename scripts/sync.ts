import { Cell, CellType, Dictionary, OpenedContract, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { LiteClient } from '../wrappers/LiteClient';
import { Client } from './imports/client';
import { setSignWithGlobalId } from './imports/utils/sign';
import { selectNetwork } from './imports/ui';
import { packEpochData, packSignatures, parseConfigParamValidators, parseEpochData } from './imports/validators';
import { getConfigFromBlock, getPrevKeyBlockSeqnoFromBlock, getSeqnoFromBlock, prepareKeyBlock } from './imports/block';
import deployLibStore from './deployLibStore';
import { sha256 } from '@ton/crypto';

class TimeUtils {
    static delay(seconds: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
}

class LiteClientError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LiteClientError';
    }
}

/**
 * Manages epoch data operations
 */
class EpochManager {
    /**
     * Retrieves and parses the current epoch state from a LiteClient
     */
    static async getCurrentEpochState(liteClient: OpenedContract<LiteClient>, client: Client) {
        try {
            const state = await liteClient.getState();
            console.log('Found LiteClient with state:', state);

            let currentEpochDataRaw;
            if (state.currentEpochData.type == CellType.Library) {
                currentEpochDataRaw = await client.loadLibrary(
                    state.currentEpochData.beginParse(true).skip(8).loadBuffer(32),
                );
            } else {
                currentEpochDataRaw = state.currentEpochData;
            }

            if (!currentEpochDataRaw) {
                throw new LiteClientError('Failed to load current epoch data');
            }

            return parseEpochData(currentEpochDataRaw);
        } catch (error) {
            if (error instanceof LiteClientError) {
                throw error;
            }
            console.log(error);
            throw new LiteClientError(`Error getting epoch state: ${error}`);
        }
    }

    /**
     * Retrieves the current epoch ID
     */
    static async getCurrentEpochId(client: Client): Promise<number> {
        const config = (await client.loadConfig())!;
        const configParam34 = Dictionary.loadDirect(Dictionary.Keys.Uint(32), Dictionary.Values.Cell(), config).get(
            34,
        )!;

        const { utimeSince } = parseConfigParamValidators(configParam34);
        return utimeSince;
    }

    /**
     * Retrieves the epoch ID by key block seqno
     */
    static async getEpochIdByKeyBlock(client: Client, seqno: number): Promise<number> {
        const config = (await client.loadConfig())!;
        const configParam34 = Dictionary.loadDirect(Dictionary.Keys.Uint(32), Dictionary.Values.Cell(), config).get(
            34,
        )!;

        const { utimeSince } = parseConfigParamValidators(configParam34);
        return utimeSince;
    }
}

/**
 * Handles key block synchronization operations
 */
class KeyBlockSynchronizer {
    private provider: NetworkProvider;
    private sourceClient: Client;
    private targetClient: Client;
    private liteClient: OpenedContract<LiteClient>;

    constructor(
        provider: NetworkProvider,
        sourceClient: Client,
        targetClient: Client,
        liteClient: OpenedContract<LiteClient>,
    ) {
        this.provider = provider;
        this.sourceClient = sourceClient;
        this.targetClient = targetClient;
        this.liteClient = liteClient;
    }

    /**
     * Process a new key block
     */
    async processNewKeyBlock(keyBlock: Cell, keyBlockFileHash: Buffer): Promise<void> {
        const isTon = false;
        let { currentEpochSince, currentEpochData } = await this.liteClient.getState();
        const currentEpochDataLoaded = await this.targetClient.loadLibrary(
            currentEpochData.beginParse(true).skip(8).loadBuffer(32),
        );

        if (!currentEpochDataLoaded) {
            throw new LiteClientError('Failed to load current epoch data library');
        }

        const state = parseEpochData(currentEpochDataLoaded);

        const newConfig = getConfigFromBlock(keyBlock);
        const keyBlockSeqno = getSeqnoFromBlock(keyBlock);
        const p32 = newConfig.get(32)!;
        const p34 = newConfig.get(34)!;
        const prevConfig = parseConfigParamValidators(p32);
        const { utimeSince, utimeUntil } = parseConfigParamValidators(p34);

        let withPrevEpoch = prevConfig.utimeUntil != utimeSince;

        if (currentEpochSince == utimeSince) {
            console.log('New epoch is already synced');
            return;
        }
        if (withPrevEpoch) {
            console.log('New epoch sync with prev epoch included: ', withPrevEpoch);
        }
        const epochData = packEpochData(p34);

        console.log('Found new key block: ', keyBlockSeqno, 'epochId: ', utimeSince);

        await deployLibStore(this.provider, isTon ? toNano('0.03') : toNano('10'), epochData);

        const signatures = await this.sourceClient.httpClient.getMasterchainBlockSignatures(keyBlockSeqno);

        await this.liteClient.sendNewKeyBlock(this.provider.sender(), {
            value: isTon ? toNano('0.1') : toNano('5'),
            block: {
                fileHash: keyBlockFileHash,
                blockProof: prepareKeyBlock(keyBlock, withPrevEpoch),
            },
            signatures: packSignatures(signatures, state.cutoffWeight, state.validatorsList),
        });

        await this.waitForEpochSync(utimeSince);
    }

    /**
     * Waits for epoch synchronization to complete
     */
    private async waitForEpochSync(expectedEpochId: number, maxAttempts = 10): Promise<void> {
        for (let i = 0; i < maxAttempts; i++) {
            await TimeUtils.delay(2);
            const { currentEpochSince } = await this.liteClient.getState();

            if (currentEpochSince == expectedEpochId) {
                console.log(`New epoch ${currentEpochSince} successfully synced`);
                return;
            }
        }

        throw new LiteClientError('Failed to sync new key blocks within timeout period');
    }

    /**
     * Synchronizes with new blocks, optionally waiting for future blocks
     */
    async syncNewBlock(waitForNew: boolean): Promise<boolean> {
        try {
            while (true) {
                const currentEpochData = await EpochManager.getCurrentEpochState(this.liteClient, this.targetClient);
                const currentEpochId = currentEpochData.utimeSince;

                let blocksToProcess = [];
                let keyBlockSeqno = undefined;
                for (let i = 0; i < 100; i++) {
                    let keyBlock = await this.sourceClient.getKeyBlock(keyBlockSeqno);
                    if (!keyBlock) {
                        break;
                    }
                    keyBlockSeqno = getPrevKeyBlockSeqnoFromBlock(
                        keyBlock.block,
                        this.sourceClient.networkConfig.isTycho,
                    );
                    const newConfig = getConfigFromBlock(keyBlock.block);
                    const p34 = newConfig.get(34)!;
                    const epochId = parseConfigParamValidators(p34).utimeSince;
                    if (currentEpochId == epochId) {
                        break;
                    } else if (currentEpochId > epochId) {
                        console.log("LiteClient's current epoch ID is greater than the one in the network.");
                        console.log('This could be due to an RPC error or an incorrect network configuration.');
                        return false;
                    }
                    blocksToProcess.push(keyBlock);
                }
                console.log('Found new ', blocksToProcess.length, 'epochs to sync');
                for (let block of blocksToProcess.reverse()) {
                    await this.processNewKeyBlock(block.block, block.fileHash);
                }
                if (waitForNew) {
                    await TimeUtils.delay(60);
                } else {
                    break;
                }
            }

            return true;
        } catch (error) {
            console.log(error);
            console.error(`Block synchronization failed: ${error}`);
            return false;
        }
    }
}

/**
 * Main application orchestrator
 */
class LiteClientSynchronizer {
    private provider: NetworkProvider;

    constructor(provider: NetworkProvider) {
        this.provider = provider;
    }

    /**
     * Initializes clients and LiteClient
     */
    private async initialize() {
        const ui = this.provider.ui();

        // Set global ID if provided
        if (process.env.GLOBAL_ID) {
            setSignWithGlobalId(parseInt(process.env.GLOBAL_ID));
        }

        // Initialize clients
        const sourceClient = new Client(await selectNetwork('to sync blocks from(source)', this.provider));
        const targetClient = new Client(await selectNetwork('to sync blocks to(target)', this.provider));

        // Get LiteClient address and create instance
        const liteClientAddress = await ui.inputAddress('Input LiteClient contract address: ');
        const liteClient = this.provider.open(LiteClient.createFromAddress(liteClientAddress));

        return { sourceClient, targetClient, liteClient, ui };
    }

    /**
     * Main entry point
     */
    async run() {
        try {
            const { sourceClient, targetClient, liteClient, ui } = await this.initialize();

            // Verify LiteClient state
            try {
                await liteClient.getState();
            } catch (error) {
                console.log('LiteClient not found or not valid address:', error);
                return;
            }
            // Set up clients and synchronize
            await targetClient.setupLiteClient();
            await sourceClient.setupLiteClient();

            // Get current epoch data
            const currentEpochData = await EpochManager.getCurrentEpochState(liteClient, targetClient);
            console.log('Current epoch data:', currentEpochData);

            const synchronizer = new KeyBlockSynchronizer(this.provider, sourceClient, targetClient, liteClient);

            // First sync
            const syncResult = await synchronizer.syncNewBlock(false);
            if (!syncResult) {
                return;
            }

            // Optional continuous sync
            if (await ui.prompt('Wait for new key blocks?')) {
                const currentEpochData = await EpochManager.getCurrentEpochState(liteClient, targetClient);
                await synchronizer.syncNewBlock(true);
            }
        } catch (error) {
            console.error(`Synchronization failed: ${error}`);
        }
    }
}

/**
 * Main entry point
 */
export async function run(provider: NetworkProvider) {
    const synchronizer = new LiteClientSynchronizer(provider);
    await synchronizer.run();
}
