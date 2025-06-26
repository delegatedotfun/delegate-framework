import { Keypair } from "@solana/web3.js";
import { 
    BaseDelegateOptions, 
    BaseDelegateResult, 
    DeployerDelegateOptions, 
    DeployerDelegateResult,
    TokenMetadata,
    RaydiumLaunchpadTokenParams,
    RaydiumLaunchpadTokenComputeBudgetConfig
} from "../types";
import { DELEGATE_TYPES } from "../constants";

describe('Delegate Types', () => {
    describe('BaseDelegateOptions', () => {
        it('should allow type property and additional properties', () => {
            const options: BaseDelegateOptions = {
                type: 'test',
                customField: 'customValue',
                numberField: 123
            };
            
            expect(options.type).toBe('test');
            expect(options['customField']).toBe('customValue');
            expect(options['numberField']).toBe(123);
        });
    });

    describe('BaseDelegateResult', () => {
        it('should have required success property', () => {
            const result: BaseDelegateResult = {
                success: true,
                signatures: ['sig1', 'sig2'],
                error: undefined
            };
            
            expect(result.success).toBe(true);
            expect(result.signatures).toEqual(['sig1', 'sig2']);
        });

        it('should allow additional properties', () => {
            const result: BaseDelegateResult = {
                success: false,
                error: 'Something went wrong',
                customField: 'customValue',
                metadata: { key: 'value' }
            };
            
            expect(result.success).toBe(false);
            expect(result.error).toBe('Something went wrong');
            expect(result['customField']).toBe('customValue');
            expect(result['metadata']).toEqual({ key: 'value' });
        });
    });

    describe('TokenMetadata', () => {
        it('should have required name and symbol properties', () => {
            const metadata: TokenMetadata = {
                name: 'Test Token',
                symbol: 'TEST',
                description: 'A test token',
                image: 'https://example.com/image.png',
                externalUrl: 'https://example.com',
                twitter: 'https://twitter.com/test',
                telegram: 'https://t.me/test',
                discord: 'https://discord.gg/test',
                github: 'https://github.com/test'
            };
            
            expect(metadata.name).toBe('Test Token');
            expect(metadata.symbol).toBe('TEST');
            expect(metadata.description).toBe('A test token');
        });

        it('should allow optional properties', () => {
            const minimalMetadata: TokenMetadata = {
                name: 'Test Token',
                symbol: 'TEST'
            };
            
            expect(minimalMetadata.name).toBe('Test Token');
            expect(minimalMetadata.symbol).toBe('TEST');
            expect(minimalMetadata.description).toBeUndefined();
        });

        it('should allow additional properties', () => {
            const extendedMetadata: TokenMetadata = {
                name: 'Test Token',
                symbol: 'TEST',
                customField: 'customValue',
                tags: ['tag1', 'tag2']
            };
            
            expect(extendedMetadata['customField']).toBe('customValue');
            expect(extendedMetadata['tags']).toEqual(['tag1', 'tag2']);
        });
    });

    describe('DeployerDelegateOptions', () => {
        it('should extend BaseDelegateOptions with deployer-specific fields', () => {
            const deployerOptions: DeployerDelegateOptions = {
                type: DELEGATE_TYPES.DEPLOYER,
                platformId: '11111111111111111111111111111111',
                tokenName: 'Test Token',
                tokenSymbol: 'TEST',
                tokenDescription: 'A test token',
                tokenMigrateType: 'amm',
                buyAmount: 1000000,
                buySlippageBps: 500,
                extraSigners: [Keypair.generate()],
                tokenImage: 'data:image/png;base64,test',
                tokenWebsite: 'https://test.com',
                tokenTwitter: 'https://twitter.com/test',
                tokenTelegram: 'https://t.me/test',
                tokenDiscord: 'https://discord.gg/test',
                tokenGithub: 'https://github.com/test'
            };
            
            expect(deployerOptions.type).toBe(DELEGATE_TYPES.DEPLOYER);
            expect(deployerOptions.tokenName).toBe('Test Token');
            expect(deployerOptions.tokenMigrateType).toBe('amm');
            expect(deployerOptions.buyAmount).toBe(1000000);
        });

        it('should allow optional fields to be undefined', () => {
            const minimalOptions: DeployerDelegateOptions = {
                type: DELEGATE_TYPES.DEPLOYER,
                platformId: '11111111111111111111111111111111',
                tokenName: 'Test Token',
                tokenSymbol: 'TEST',
                tokenMigrateType: 'cpmm',
                buyAmount: 1000000
            };
            
            expect(minimalOptions.tokenDescription).toBeUndefined();
            expect(minimalOptions.buySlippageBps).toBeUndefined();
            expect(minimalOptions.extraSigners).toBeUndefined();
        });
    });

    describe('DeployerDelegateResult', () => {
        it('should extend BaseDelegateResult with deployer-specific fields', () => {
            const deployerResult: DeployerDelegateResult = {
                success: true,
                signatures: ['sig1', 'sig2', 'sig3'],
                tokenMint: '11111111111111111111111111111111',
                metadataUri: 'https://arweave.net/metadata'
            };
            
            expect(deployerResult.success).toBe(true);
            expect(deployerResult.signatures).toEqual(['sig1', 'sig2', 'sig3']);
            expect(deployerResult.tokenMint).toBe('11111111111111111111111111111111');
            expect(deployerResult.metadataUri).toBe('https://arweave.net/metadata');
        });

        it('should allow optional fields to be undefined', () => {
            const minimalResult: DeployerDelegateResult = {
                success: true,
                signatures: ['sig1']
            };
            
            expect(minimalResult.tokenMint).toBeUndefined();
            expect(minimalResult.metadataUri).toBeUndefined();
        });
    });

    describe('RaydiumLaunchpadTokenParams', () => {
        it('should have all required properties', () => {
            const BN = require("bn.js");
            
            const params: RaydiumLaunchpadTokenParams = {
                name: 'Test Token',
                symbol: 'TEST',
                decimals: 6,
                supply: 1000000000,
                migrateType: 'amm',
                uri: 'https://arweave.net/metadata',
                txVersion: 'V0' as any,
                buyAmount: new BN(1000000),
                createOnly: false,
                extraSigners: [Keypair.generate()],
                platformId: '11111111111111111111111111111111',
                slippageBps: 500
            };
            
            expect(params.name).toBe('Test Token');
            expect(params.symbol).toBe('TEST');
            expect(params.decimals).toBe(6);
            expect(params.supply).toBe(1000000000);
            expect(params.migrateType).toBe('amm');
            expect(params.createOnly).toBe(false);
            expect(params.slippageBps).toBe(500);
        });
    });

    describe('RaydiumLaunchpadTokenComputeBudgetConfig', () => {
        it('should have units and microLamports properties', () => {
            const config: RaydiumLaunchpadTokenComputeBudgetConfig = {
                units: 200000,
                microLamports: 1000000
            };
            
            expect(config.units).toBe(200000);
            expect(config.microLamports).toBe(1000000);
        });
    });

    describe('Type compatibility', () => {
        it('should allow DeployerDelegateOptions to be assigned to BaseDelegateOptions', () => {
            const deployerOptions: DeployerDelegateOptions = {
                type: DELEGATE_TYPES.DEPLOYER,
                platformId: '11111111111111111111111111111111',
                tokenName: 'Test Token',
                tokenSymbol: 'TEST',
                tokenMigrateType: 'amm',
                buyAmount: 1000000
            };
            
            const baseOptions: BaseDelegateOptions = deployerOptions;
            expect(baseOptions.type).toBe(DELEGATE_TYPES.DEPLOYER);
        });

        it('should allow DeployerDelegateResult to be assigned to BaseDelegateResult', () => {
            const deployerResult: DeployerDelegateResult = {
                success: true,
                signatures: ['sig1']
            };
            
            const baseResult: BaseDelegateResult = deployerResult;
            expect(baseResult.success).toBe(true);
            expect(baseResult.signatures).toEqual(['sig1']);
        });
    });
}); 