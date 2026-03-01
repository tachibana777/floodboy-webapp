import { createPublicClient, http, defineChain } from 'viem';
import FactoryABI from './abis/CatLabFactory.json';
import StoreABI from './abis/CatLabSecureSensorStore.json';

// JIBCHAIN L1 Configuration
export const jibchain = defineChain({
    id: 8899,
    name: 'JIBCHAIN L1',
    nativeCurrency: {
        decimals: 18,
        name: 'JBC',
        symbol: 'JBC',
    },
    rpcUrls: {
        default: {
            http: ['https://rpc-l1.jibchain.net']
        }
    },
    blockExplorers: {
        default: { name: 'Jibchain Explorer', url: 'https://exp.jibchain.net' },
    }
});

export const client = createPublicClient({
    chain: jibchain,
    transport: http()
});

// Constants
export const FACTORY_ADDRESS = '0x63bB41b79b5aAc6e98C7b35Dcb0fE941b85Ba5Bb' as const;
export const FLOODBOY016_STORE = '0x0994Bc66b2863f8D58C8185b1ed6147895632812' as const;
export const UNIVERSAL_SIGNER = '0xcB0e58b011924e049ce4b4D62298Edf43dFF0BDd' as const;

export interface StoreInfo {
    nickname: string;
    owner: string;
    authorizedSensorCount: number;
    deployedBlock: number;
    description: string;
}

export interface FieldDef {
    name: string;
    unit: string;
    dtype: string;
}

export async function getStoreInfo(storeAddress: `0x${string}`): Promise<StoreInfo> {
    const [nickname, owner, sensorCount, deployedBlock, description] = await client.readContract({
        address: FACTORY_ADDRESS,
        abi: FactoryABI,
        functionName: 'getStoreInfo',
        args: [storeAddress]
    }) as [string, string, bigint, bigint, string];

    return {
        nickname,
        owner,
        authorizedSensorCount: Number(sensorCount),
        deployedBlock: Number(deployedBlock),
        description
    };
}

export async function getFields(storeAddress: `0x${string}`): Promise<FieldDef[]> {
    return await client.readContract({
        address: storeAddress,
        abi: StoreABI,
        functionName: 'getAllFields'
    }) as FieldDef[];
}

export async function getLatestRecord(storeAddress: `0x${string}`): Promise<{ timestamp: number; values: number[] }> {
    const [timestamp, values] = await client.readContract({
        address: storeAddress,
        abi: StoreABI,
        functionName: 'getLatestRecord',
        args: [UNIVERSAL_SIGNER]
    }) as [bigint, bigint[]];

    return {
        timestamp: Number(timestamp) * 1000,
        values: values.map(Number)
    };
}

export async function getHistoricalEvents(storeAddress: `0x${string}`) {
    const currentBlockNumber = await client.getBlockNumber();
    const fromBlock = currentBlockNumber - BigInt(28800); // ~24 hours

    return await client.getContractEvents({
        address: storeAddress,
        abi: StoreABI,
        eventName: 'RecordStored',
        fromBlock: fromBlock,
        toBlock: 'latest',
        args: {
            sensor: UNIVERSAL_SIGNER
        }
    });
}

// Data processing function with CORRECT unit conversions
export function processValue(value: number | string, unit: string) {
    const baseUnit = unit.replace(/ x\d+/, '');

    if (unit.includes('x10000')) {
        return (Number(value) / 10000).toFixed(4) + ' ' + baseUnit;
    }
    if (unit.includes('x1000')) {
        return (Number(value) / 1000).toFixed(3) + ' ' + baseUnit;
    }
    if (unit.includes('x100')) {
        return (Number(value) / 100).toFixed(3) + ' ' + baseUnit;
    }

    return value + ' ' + baseUnit;
}

// Field name formatting
export function formatFieldName(fieldName: string) {
    return fieldName
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}
