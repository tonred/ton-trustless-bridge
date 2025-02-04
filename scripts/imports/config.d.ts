export interface Config {
    networks: Network[];
}

export interface Network {
    name: string;
    networkId: number;
    httpApiEndpoint: string;
    httpApiKey?: string;
    globalConfig: string | NetworkGlobalConfig;
}

interface NetworkGlobalConfig {
    liteservers: { ip: number; port: number; id: { '@type': 'pub.ed25519'; key: string } }[];
}
