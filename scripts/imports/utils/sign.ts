import * as tonCrypto from '@ton/crypto';

export function setSignWithGlobalId(globalId: number) {
    const originalTonCrypto = { ...tonCrypto };
    let globalIdBytes = Buffer.alloc(4);
    globalIdBytes.writeInt32BE(globalId);

    Object.defineProperty(tonCrypto, 'sign', {
        get: function () {
            return function (...args: any[]) {
                args[0] = Buffer.concat([globalIdBytes, args[0]]);
                // @ts-ignore
                return originalTonCrypto.sign.apply(this, args);
            };
        },
    });
}