import { LiteClient, LiteEngine, LiteRoundRobinEngine, LiteSingleEngine } from 'ton-lite-client';
import { Functions, tonNode_blockIdExt } from 'ton-lite-client/dist/schema';
import { CacheMap } from 'ton-lite-client/dist/types';
import { HttpApi, TonClient, TonClientParameters } from '@ton/ton';
import { z } from 'zod';
import axios from 'axios';

import { intToIP } from './utils/ip';
import { Network } from './config';
import { Address, beginCell, Cell } from '@ton/core';
import { getPrevKeyBlockSeqnoFromBlock, getSeqnoFromBlock, isKeyBlock } from './block';
import { sha256 } from '@ton/crypto';

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

export class RpcClient {
    constructor(public endpoint: string) {}

    async makeRequest<T>(method: string, params: any): Promise<any> {
        let headers: Record<string, any> = {
            'Content-Type': 'application/json',
        };
        let res = await axios.post<{ ok: boolean; result: T }>(
            this.endpoint,
            JSON.stringify({
                id: 1,
                jsonrpc: '2.0',
                method: method,
                params,
            }),
            { headers },
        );

        if (res.status !== 200) {
            throw Error('Received error: ' + JSON.stringify(res.data));
        }
        return res.data.result;
    }

    async getBlockchainConfig<T = { globalId: number; seqno: number; config: string }>(): Promise<T> {
        return this.makeRequest<T>('getBlockchainConfig', {});
    }

    async getLatestKeyBlock<T = { block: string }>(): Promise<T> {
        return await this.makeRequest<T>('getLatestKeyBlock', {});
    }

    async getLibraryCell<T = { cell: string | null }>(hash: string): Promise<T> {
        return this.makeRequest<T>('getLibraryCell', { hash });
    }


    async getKeyBlockProof<T = { proof: string }>(seqno: number): Promise<T> {
        return this.makeRequest<T>('getKeyBlockProof', { seqno });
    }

    async getBlockData<T = { data: string }>(id: BlockId): Promise<T> {
        const blockId = `${id.workchain}:8000000000000000:${id.seqno}:${id.root_hash ?? '0'.repeat(64)}:${id.file_hash ?? '0'.repeat(64)}`;
        return this.makeRequest<T>('getBlockData', { blockId });
    }
}

export class Client {
    public httpClient;
    public liteClient?: CustomLiteClient;
    public rpcClient?: RpcClient;
    public networkConfig;

    constructor(network: Network) {
        this.networkConfig = network;
        if (network.globalConfig) {
            const engine: LiteEngine = new LiteRoundRobinEngine([]);
            this.liteClient = new CustomLiteClient({ engine });
        }
        if (network.rpcApiEndpoint) {
            this.rpcClient = new RpcClient(network.rpcApiEndpoint);
        }
        this.httpClient = new CustomTonClient({
            endpoint: network.httpApiEndpoint,
            apiKey: network.httpApiKey,
        });
    }

    async setupLiteClient() {
        let globalConfig = this.networkConfig.globalConfig;
        if (!this.liteClient || !globalConfig) {
            return;
        }

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

    async getKeyBlock(seqno?: number): Promise<{ block: Cell; fileHash: Buffer } | null> {
        console.log('getKeyBlock: ', seqno);
        if (!seqno) {
            if (this.rpcClient) {
                const blockDataRaw = await this.rpcClient.getLatestKeyBlock();
                seqno = getSeqnoFromBlock(Cell.fromBase64(blockDataRaw.block));
            }
            if (this.liteClient) {
                const r = await this.liteClient.getMasterchainInfo();
                const block = Cell.fromBase64((await this.liteClient._getBlock(r.last)).data.toString('base64'));
                if (isKeyBlock(block)) {
                    seqno = r.last.seqno;
                } else {
                    seqno = getPrevKeyBlockSeqnoFromBlock(block);
                }
            }
        }

        if (this.rpcClient) {
            const proofDataRaw = await this.rpcClient.getKeyBlockProof(seqno!);
            let proof = Cell.fromBase64(proofDataRaw.proof).beginParse();
            proof.skip(8); // tag
            proof.skip(104); //shardIdent
            const blockId = {
                workchain: -1,
                seqno: proof.loadUint(32),
                shard: '',
                root_hash: proof.loadBuffer(32).toString('hex'),
                file_hash: proof.loadBuffer(32).toString('hex'),
            };
            const block = await this.rpcClient.getBlockData(blockId);
            return { block: Cell.fromBase64(block.data), fileHash: Buffer.from(blockId.file_hash, 'hex') };
        }
        if (this.liteClient) {
            let blockIdShort = { workchain: -1, seqno, shard: '-9223372036854775808' } as BlockId;
            const blockId = await this.liteClient.lookupBlockByID(blockIdShort);
            const blockDataRaw = await this.liteClient._getBlock(blockId.id);
            return {
                block: Cell.fromBase64(blockDataRaw.data.toString('base64')),
                fileHash: await sha256(blockDataRaw.data),
            };
        }

        return null;
    }

    async loadConfig(): Promise<Cell | null> {
        try {
            if (this.rpcClient) {
                const { config } = await this.rpcClient.getBlockchainConfig();
                return Cell.fromBase64(config);
            }

            if (this.liteClient) {
                const { config } = await this.liteClient.getConfig((await this.liteClient.getMasterchainInfo()).last);
                return beginCell().storeDictDirect(config).endCell();
            }

            return null;
        } catch (error) {
            console.error('Error loading config:', error);
            return null;
        }
    }

    async loadLibrary(hash: Buffer): Promise<Cell | null> {
        try {
            if (this.rpcClient) {
                const hexHash = hash.toString('hex');
                const { cell } = await this.rpcClient.getLibraryCell(hexHash);
                return cell ? Cell.fromBase64(cell) : null;
            }

            if (this.liteClient) {
                const { result } = await this.liteClient.getLibraries([hash]);
                if (result && result.length > 0) {
                    return Cell.fromBase64(result[0].data.toString('base64'));
                }
            }

            return null;
        } catch (error) {
            console.error('Error loading library:', error);
            return null;
        }
    }

    async getTxProof(address: Address, lt: bigint): Promise<Cell> {
        const query = new URL(this.networkConfig.proofChainApi!);
        query.pathname = `/v1/proof_chain/${address.toRawString()}/${lt}`;

        let res = await axios.get<{ proofChain: string }>(query.toString());

        if (res.status !== 200) {
            throw Error('Received error: ' + res.data);
        }
        return Cell.fromBase64(res.data.proofChain);
    }

    async getTxProofTon(address: Address, lt: bigint, hash: Buffer): Promise<Cell> {
        const query = new URL(this.networkConfig.proofChainApi!);
        query.pathname = `/v1/proof_chain/${address.toString()}/${lt}/${hash.toString('hex')}`;

        let res = await axios.get<{ proofChain: string }>(query.toString());

        if (res.status !== 200) {
            throw Error('Received error: ' + res.data);
        }
        return Cell.fromBase64(res.data.proofChain);
    }
}
