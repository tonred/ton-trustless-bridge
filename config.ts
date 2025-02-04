import { Config, Network } from './scripts/imports/config';

export const TESTNET = {
    name: 'Testnet',
    networkId: 0,
    httpApiEndpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
    // global_config: 'https://ton-blockchain.github.io/testnet-global.config.json',
    globalConfig: {
        liteservers: [
            {
                ip: 822907680,
                port: 27842,
                provided: 'Beavis',
                id: {
                    '@type': 'pub.ed25519',
                    key: 'sU7QavX2F964iI9oToP9gffQpCQIoOLppeqL/pdPvpM=',
                },
            },
            {
                ip: -1468571697,
                port: 27787,
                provided: 'Beavis',
                id: {
                    '@type': 'pub.ed25519',
                    key: 'Y/QVf6G5VDiKTZOKitbFVm067WsuocTN8Vg036A4zGk=',
                },
            },
            {
                ip: -1468575011,
                port: 51088,
                provided: 'Beavis',
                id: {
                    '@type': 'pub.ed25519',
                    key: 'Sy5ghr3EahQd/1rDayzZXt5+inlfF+7kLfkZDJcU/ek=',
                },
            },
            {
                ip: 1844203537,
                port: 37537,
                provided: 'Neo',
                id: {
                    '@type': 'pub.ed25519',
                    key: 'K1F7zEe0ETf+SwkefLS56hJE8x42sjCVsBJJuaY7nEA=',
                },
            },
            {
                ip: 1844203589,
                port: 34411,
                provided: 'Neo',
                id: {
                    '@type': 'pub.ed25519',
                    key: 'pOpRRpIxDuMRm1qFUPpvVjD62vo8azkO0npw4FPcW/I=',
                },
            },
            {
                ip: 1047529523,
                port: 37649,
                provided: 'Neo',
                id: {
                    '@type': 'pub.ed25519',
                    key: 'pRf2sAa7d+Chl8gDclWOMtthtxjKnLYeAIzk869mMvA=',
                },
            },
            {
                ip: 1592601963,
                port: 13833,
                id: {
                    '@type': 'pub.ed25519',
                    key: 'QpVqQiv1u3nCHuBR3cg3fT6NqaFLlnLGbEgtBRukDpU=',
                },
            },
            {
                ip: 1162057690,
                port: 35939,
                id: {
                    '@type': 'pub.ed25519',
                    key: '97y55AkdzXWyyVuOAn+WX6p66XTNs2hEGG0jFUOkCIo=',
                },
            },
            {
                ip: -1304477830,
                port: 20700,
                id: {
                    '@type': 'pub.ed25519',
                    key: 'dGLlRRai3K9FGkI0dhABmFHMv+92QEVrvmTrFf5fbqA=',
                },
            },
            {
                ip: 1959453117,
                port: 20700,
                id: {
                    '@type': 'pub.ed25519',
                    key: '24RL7iVI20qcG+j//URfd/XFeEG9qtezW2wqaYQgVKw=',
                },
            },
            {
                ip: -809760973,
                port: 20700,
                id: {
                    '@type': 'pub.ed25519',
                    key: 'vunMV7K35yPlTQPx/Fqk6s+4/h5lpcbP+ao0Cy3M2hw=',
                },
            },
            {
                ip: 1097633201,
                port: 17439,
                id: {
                    '@type': 'pub.ed25519',
                    key: '0MIADpLH4VQn+INHfm0FxGiuZZAA8JfTujRqQugkkA8=',
                },
            },
            {
                ip: 1091956407,
                port: 16351,
                id: {
                    '@type': 'pub.ed25519',
                    key: 'Mf/JGvcWAvcrN3oheze8RF/ps6p7oL6ifrIzFmGQFQ8=',
                },
            },
        ],
    },
} as Network;

export const FASTNET = {
    name: 'Fastnet',
    networkId: -217,
    httpApiEndpoint: 'http://109.236.91.95:8081/jsonRPC',
    globalConfig: {
        liteservers: [
            {
                ip: 1482896250,
                port: 22603,
                id: {
                    '@type': 'pub.ed25519',
                    key: 'M6z0tzBLejE9LSAEQiLNZ4iC+u9hGv7q0gc6m0Io2rk=',
                },
            },
        ],
    },
} as Network;

export const BRIDGE_CONFIG = {
    networks: [TESTNET, FASTNET],
} as Config;
