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