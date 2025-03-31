import { Cell, toNano } from '@ton/core';
import { compile, NetworkProvider } from '@ton/blueprint';
import { LibStore } from '../wrappers/LibStore';

async function run(provider: NetworkProvider, value?: bigint, lib?: Cell) {
    const libStore = provider.open(
        LibStore.createFromConfig(
            {
                owner: provider.sender().address!,
                id: Math.floor(Math.random() * 10000),
            },
            await compile('LibStore'),
            -1,
        ),
    );
    console.log(`Deploying LibStore with address: ${libStore.address} and hash: ${lib!.hash().toString('hex')}`);
    await libStore.sendDeploy(provider.sender(), value ? value : toNano('0.03'), lib);
    await provider.waitForDeploy(libStore.address);
}

export default run;
