import { LiteClient, LiteEngine, LiteRoundRobinEngine, LiteSingleEngine } from 'ton-lite-client';
import { Functions, tonNode_blockIdExt } from 'ton-lite-client/dist/schema';
import { CacheMap } from 'ton-lite-client/dist/types';
import { HttpApi, TonClient, TonClientParameters } from '@ton/ton';
import { z } from 'zod';
import axios from 'axios';

import { intToIP } from './utils/ip';
import { Network } from './config';

interface BlockId {
    workchain: number;
    shard: string;
    seqno: number;
    root_hash?: string;
    file_hash?: string;
}

interface BlockHeader {
    id: BlockId;
    global_id: number;
    version: number;
    flags: number;
    after_merge: boolean;
    after_split: boolean;
    before_split: boolean;
    want_merge: boolean;
    want_split: boolean;
    validator_list_hash_short: number;
    catchain_seqno: number;
    min_ref_mc_seqno: number;
    is_key_block: boolean;
    prev_key_block_seqno: number;
    start_lt: string;
    end_lt: string;
    gen_utime: number;
    prev_blocks: BlockId[];
}

class CustomHttpApi extends HttpApi {
    async getMasterchainBlockSignatures(seqno: number): Promise<
        {
            '@type': string;
            node_id_short: string;
            signature: string;
        }[]
    > {
        // @ts-ignore
        let res = await this.doCall(
            'getMasterchainBlockSignatures',
            { seqno },
            z.object({
                signatures: z.array(
                    z.object({
                        '@type': z.string(),
                        node_id_short: z.string(),
                        signature: z.string(),
                    }),
                ),
            }),
        );
        return res.signatures;
    }

    async getBlockHeader(id: BlockId): Promise<BlockHeader> {
        // @ts-ignore
        let res = await this.doCall('getBlockHeader', id, z.any({}));
        return res;
    }

    async lookupBlock(params: {
        workchain: number;
        shard: string;
        seqno?: number;
        lt?: number;
        unixtime?: number;
    }): Promise<BlockId> {
        // @ts-ignore
        let res = await this.doCall('lookupBlock', params, z.any({}));
        return res;
    }
}

class CustomTonClient extends TonClient {
    protected api: CustomHttpApi;

    constructor(parameters: TonClientParameters) {
        super(parameters);
        this.api = new CustomHttpApi(parameters.endpoint, {
            timeout: parameters.timeout,
            apiKey: parameters.apiKey,
            adapter: parameters.httpAdapter,
        });
    }

    /**
     * Get Masterchain Block Signatures
     * @param seqno seqno of masterchain block
     * @returns signatures
     */
    async getMasterchainBlockSignatures(seqno: number) {
        let res = await this.api.getMasterchainBlockSignatures(seqno);
        return res;
    }

    /**
     * Get metadata of a given block.
     * @param id Block id
     * @returns BlockHeader
     */
    async getBlockHeader(id: BlockId) {
        let res = await this.api.getBlockHeader(id);
        return res;
    }

    /**
     * Look up block by either seqno, lt or unixtime.
     * @returns BlockId
     * @param workchain Workchain id to look up block in
     * @param shard Shard id to look up block in
     * @param seqno Block's height
     * @param lt Block's logical time
     * @param unixtime Block's unixtime
     */
    async lookUpBlock(workchain: number, shard: string, seqno?: number, lt?: number, unixtime?: number) {
        let res = await this.api.lookupBlock({ workchain, shard, seqno, lt, unixtime });
        return res;
    }
}

class CustomLiteClient extends LiteClient {
    constructor(opts: {
        engine: LiteEngine;
        batchSize?: number | undefined | null;
        cacheMap?: number | ((mapKind: 'block' | 'header' | 'shard' | 'account') => CacheMap);
    }) {
        super(opts);
    }

    public async getBlock(id: BlockId) {
        const convertedId = {
            kind: 'tonNode.blockIdExt' as 'tonNode.blockIdExt',
            workchain: id.workchain,
            shard: id.shard,
            seqno: id.seqno,
            rootHash: Buffer.from(id.root_hash!, 'base64'),
            fileHash: Buffer.from(id.file_hash!, 'base64'),
        };
        return this._getBlock(convertedId);
    }

    public async _getBlock(id: tonNode_blockIdExt) {
        return await this.engine.query(
            Functions.liteServer_getBlock,
            {
                kind: 'liteServer.getBlock',
                id: id,
            },
            {},
        );
    }
}

export class Client {
    public liteClient: CustomLiteClient;
    public httpClient;
    protected networkConfig;

    constructor(network: Network) {
        this.networkConfig = network;
        const engine: LiteEngine = new LiteRoundRobinEngine([]);
        this.httpClient = new CustomTonClient({
            endpoint: network.httpApiEndpoint,
            apiKey: network.httpApiKey,
        });
        this.liteClient = new CustomLiteClient({ engine });
    }

    async setupLiteClient() {
        let globalConfig = this.networkConfig.globalConfig;

        if (typeof globalConfig == 'string') {
            const r = await axios.get(globalConfig);
            this.networkConfig.globalConfig = JSON.parse(r.data);
        }
        if (typeof globalConfig == 'string') {
            return;
        }
        const engines: LiteEngine[] = [];
        for (let server of globalConfig.liteservers) {
            engines.push(
                new LiteSingleEngine({
                    host: `tcp://${intToIP(server.ip)}:${server.port}`,
                    publicKey: Buffer.from(server.id.key, 'base64'),
                }),
            );
        }

        const engine: LiteEngine = new LiteRoundRobinEngine(engines);

        this.liteClient = new CustomLiteClient({ engine });
    }
}
