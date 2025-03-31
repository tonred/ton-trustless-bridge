export interface Config {
    networks: Network[];
}

export interface Network {
    name: string;
    networkId: number;
    httpApiEndpoint: string;
    rpcApiEndpoint?: string;
    httpApiKey?: string;
    globalConfig?: string | NetworkGlobalConfig;
    valueMultiplier?: number;
    isTycho?: boolean;
    proofChainApi?: string;
}

interface NetworkGlobalConfig {
    liteservers: { ip: number; port: number; id: { '@type': 'pub.ed25519'; key: string } }[];
}
