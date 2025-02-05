import { NetworkProvider } from '@ton/blueprint';
import { BRIDGE_CONFIG } from '../../config';

export async function selectNetwork(purpose: string, provider: NetworkProvider) {
    const ui = provider.ui();
    return await ui.choose(`Select network ${purpose}:`, BRIDGE_CONFIG.networks, (v) => v.name);
}

export async function selectWorkchain(provider: NetworkProvider) {
    const ui = provider.ui();
    return parseInt(await ui.input(`Input workchain id to deploy:`));
}
