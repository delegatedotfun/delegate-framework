import { TxVersion } from "@raydium-io/raydium-sdk-v2";
import { BaseTask } from "../types";
import { DELEGATE_TYPES } from "./constants";
import { Keypair } from "@solana/web3.js";

const BN = require("bn.js");

// Base interfaces for the framework
export interface BaseDelegateOptions {
    type: string;
    [key: string]: any; // Allow additional properties
}

export interface BaseDelegateResult {
    success: boolean;
    signatures?: string[];
    error?: string;
    [key: string]: any; // Allow additional properties
}

// Generic metadata interface
export interface TokenMetadata {
    name: string;
    symbol: string;
    description?: string;
    image?: string;
    externalUrl?: string;
    twitter?: string;
    telegram?: string;
    discord?: string;
    github?: string;
    [key: string]: any; // Allow additional metadata properties
}

// Raydium-specific types
export type RaydiumLaunchpadMigrateType = "amm" | "cpmm";

export interface DeployerTask extends BaseTask {
    type: typeof DELEGATE_TYPES.DEPLOYER;
}

export interface DeployerDelegateOptions extends BaseDelegateOptions {
    type: typeof DELEGATE_TYPES.DEPLOYER;
    platformId: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDescription?: string;
    tokenMigrateType: RaydiumLaunchpadMigrateType;
    buyAmount: number;
    buySlippageBps?: number;
    extraSigners?: Keypair[];
    tokenImage?: string;
    tokenWebsite?: string;
    tokenTwitter?: string;
    tokenTelegram?: string;
    tokenDiscord?: string;
    tokenGithub?: string;
}

export interface RaydiumLaunchpadTokenParams {
    name: string;
    symbol: string;
    decimals: number;
    supply: number;
    migrateType: RaydiumLaunchpadMigrateType;
    uri: string;
    txVersion: TxVersion;
    buyAmount: typeof BN;
    createOnly: boolean;
    extraSigners: Keypair[];
    platformId: string;
    slippageBps: number;
}

export interface RaydiumLaunchpadTokenComputeBudgetConfig {
    units: number;
    microLamports: number;
}

export interface DeployerDelegateResult extends BaseDelegateResult {
    signatures: string[];
    tokenMint?: string;
    metadataUri?: string;
}

// Burner-specific types
export interface BurnerTask extends BaseTask {
    type: typeof DELEGATE_TYPES.BURNER;
}

export interface BurnerDelegateOptions extends BaseDelegateOptions {
    type: typeof DELEGATE_TYPES.BURNER;
    tokenAddress: string;
    numTokens: number;
    privateKey: string;
}

export interface BurnerDelegateResult extends BaseDelegateResult {
    signatures: string[];
    burnedAmount: string;
    tokenMint: string;
}

// Allocator-specific types
export interface AllocatorTask extends BaseTask {
    type: typeof DELEGATE_TYPES.ALLOCATOR;
}

export interface Allocation {
    contractAddress: string;
    percentage: number;
}

export interface AllocatorDelegateOptions extends BaseDelegateOptions {
    type: typeof DELEGATE_TYPES.ALLOCATOR;
    allocations: Allocation[];
    slippageBps?: number;
    costBuffer?: number;
}

export interface AllocatorDelegateResult extends BaseDelegateResult {
    signatures: string[];
    allocations: {
        contractAddress: string;
        percentage: number;
        amountAllocated: number;
        signature: string;
    }[];
}

// Distributor-specific types
export interface DistributorTask extends BaseTask {
    type: typeof DELEGATE_TYPES.DISTRIBUTOR;
}

export type DistributionType = 'single' | 'multi' | 'holders';
export type DistributionMethod = 'topx' | 'all';

export interface DistributorDelegateOptions extends BaseDelegateOptions {
    type: typeof DELEGATE_TYPES.DISTRIBUTOR;
    distributionType: DistributionType;
    distributionMethod?: DistributionMethod;
    numTokens: number;
    tokenAddress?: string;
    singleAddress?: string;
    multipleAddresses?: string[];
    topX?: number;
    holderOfWhichToken?: string;
}

export interface DistributorDelegateResult extends BaseDelegateResult {
    signatures: string[];
    recipients: {
        address: string;
        amount: number;
        signature: string;
    }[];
}