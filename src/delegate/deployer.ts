import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { DeployerDelegateOptions, RaydiumLaunchpadTokenParams, TokenMetadata, RaydiumLaunchpadTokenComputeBudgetConfig, DeployerDelegateResult } from "./types";
import { MetadataClient } from "../solana/clients/metadata/base";
import { getPdaLaunchpadConfigId, LAUNCHPAD_PROGRAM, LaunchpadConfig, Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { BaseDelegate } from "./base-delegate";

const BN = require("bn.js");

export class Deployer extends BaseDelegate<DeployerDelegateOptions, DeployerDelegateResult> {
    private readonly metadataClient: MetadataClient;

    constructor(connection: Connection, signerKeypair: Keypair, metadataClient: MetadataClient, feeTakerKeypair?: Keypair) {
        super(connection, signerKeypair, feeTakerKeypair);
        this.metadataClient = metadataClient;
    }

    async executeDelegate(delegateOptions: DeployerDelegateOptions): Promise<DeployerDelegateResult> {
        const requestId = this.generateRequestId();
        
        try {
            this.logOperation('deployer_execution_started', { requestId });
            
            this.validateOptions(delegateOptions);

            const metadata: TokenMetadata = {
                name: delegateOptions.tokenName,
                symbol: delegateOptions.tokenSymbol,
                description: delegateOptions.tokenDescription || '',
                image: delegateOptions.tokenImage || '',
                externalUrl: delegateOptions.tokenWebsite || '',
                twitter: delegateOptions.tokenTwitter || '',
                telegram: delegateOptions.tokenTelegram || '',
                discord: delegateOptions.tokenDiscord || '',
                github: delegateOptions.tokenGithub || ''
            };

            let metadataUri = '';
            
            // Upload metadata with retry
            try {
                if (delegateOptions.tokenImage) {
                    const imageResult = await this.retryOperation(async () => {
                        const base64Data = delegateOptions.tokenImage!.replace(/^data:image\/[a-z]+;base64,/, '');
                        const imageBuffer = Buffer.from(base64Data, 'base64');
                        
                        const result = await this.metadataClient.uploadImage(imageBuffer);
                        if (!result.success) {
                            throw new Error(`Failed to upload token image: ${result.error}`);
                        }
                        return result;
                    }, 3);
                    
                    metadata.image = imageResult.uri;
                }

                const metadataResult = await this.retryOperation(async () => {
                    const result = await this.metadataClient.uploadMetadata(metadata);
                    if (!result.success) {
                        throw new Error(`Failed to upload token metadata: ${result.error}`);
                    }
                    return result;
                }, 3);
                
                metadataUri = metadataResult.uri || '';
                
                this.logOperation('metadata_upload_completed', { requestId, metadataUri });
            } catch (error) {
                await this.handleError(error instanceof Error ? error : new Error(String(error)), { requestId });
                throw new Error(`Failed to upload token metadata: ${error}`);
            }

            const tokenParams: RaydiumLaunchpadTokenParams = {
                name: delegateOptions.tokenName,
                symbol: delegateOptions.tokenSymbol,
                decimals: 6,
                supply: 1000000000,
                migrateType: delegateOptions.tokenMigrateType,
                uri: metadataUri,
                txVersion: TxVersion.V0,
                buyAmount: new BN(delegateOptions.buyAmount ?? 0),
                createOnly: delegateOptions.buyAmount === 0,
                extraSigners: delegateOptions.extraSigners || [],
                platformId: delegateOptions.platformId,
                slippageBps: delegateOptions.buySlippageBps || 100,
            };

            const raydiumComputeBudgetConfig: RaydiumLaunchpadTokenComputeBudgetConfig = {
                units: 200000,
                microLamports: 1000000,
            };

            const result = await this.retryOperation(async () => {
                return await this.raydiumCreateLaunchlabToken(tokenParams, raydiumComputeBudgetConfig);
            }, 2);

            this.logOperation('deployer_execution_completed', { requestId, signatures: result.signatures });
            
            return {
                success: true,
                signatures: result.signatures,
                metadataUri
            };
            
        } catch (error) {
            await this.handleError(error instanceof Error ? error : new Error(String(error)), { requestId });
            throw error;
        }
    }

    validateOptions(delegateOptions: DeployerDelegateOptions): void {
        this.validateStringField(delegateOptions.tokenName, 'tokenName');
        this.validateStringField(delegateOptions.tokenSymbol, 'tokenSymbol');
        this.validateStringField(delegateOptions.tokenMigrateType, 'tokenMigrateType');
        this.validateNumberField(delegateOptions.buyAmount, 'buyAmount', 0);
        this.validateNumberField(delegateOptions.buySlippageBps || 100, 'buySlippageBps', 0, 10000);
        
        this.validatePublicKey(delegateOptions.platformId, 'platformId');

        if (delegateOptions.tokenMigrateType !== "amm" && delegateOptions.tokenMigrateType !== "cpmm") {
            throw new Error("Invalid token migrate type, must be amm or cpmm");
        }

        if (delegateOptions.tokenImage) {
            const base64Data = delegateOptions.tokenImage.replace(/^data:image\/[a-z]+;base64,/, '');
            if (!base64Data) {
                throw new Error("Invalid token image, must be a valid base64 data URI");
            }
        }
    }

    private async raydiumCreateLaunchlabToken(tokenParams: RaydiumLaunchpadTokenParams, computeBudgetConfig: RaydiumLaunchpadTokenComputeBudgetConfig): Promise<DeployerDelegateResult> {
        try {
            const raydium = await Raydium.load({
                connection: this.connection,
                owner: this.signerKeypair.publicKey,
            });
            
            const newTokenKeypair = Keypair.generate();
            const newTokenMint = newTokenKeypair.publicKey;

            const configId = getPdaLaunchpadConfigId(
                LAUNCHPAD_PROGRAM,
                NATIVE_MINT,
                0,
                0,
            ).publicKey;
            
            const configData = await this.retryOperation(async () => {
                const data = await raydium.connection.getAccountInfo(configId);
                if (!data) {
                    throw new Error("Launchpad config not found");
                }
                return data;
            }, 3);

            const configInfo = LaunchpadConfig.decode(configData.data);
            const baseTokenInfo = await raydium.token.getTokenInfo(configInfo.mintB);

            const { transactions }: { transactions: any } = await raydium.launchpad.createLaunchpad({
                programId: LAUNCHPAD_PROGRAM,
                mintA: newTokenMint,
                decimals: tokenParams.decimals,
                name: tokenParams.name,
                symbol: tokenParams.symbol,
                migrateType: tokenParams.migrateType,
                uri: tokenParams.uri,
                feePayer: this.signerKeypair.publicKey,
                configId: new PublicKey(configId.toBase58()),
                configInfo,
                mintBDecimals: baseTokenInfo.decimals,
                platformId: new PublicKey(tokenParams.platformId),
                txVersion: tokenParams.txVersion || TxVersion.V0,
                slippage: new BN(tokenParams.slippageBps ?? 100),
                buyAmount: tokenParams.createOnly ? new BN(1) : (tokenParams.buyAmount instanceof BN ? tokenParams.buyAmount : new BN(tokenParams.buyAmount || 0)),
                createOnly: tokenParams.createOnly,
                extraSigners: [newTokenKeypair, ...tokenParams.extraSigners],
                supply: new BN(tokenParams.supply * 10 ** tokenParams.decimals),
                computeBudgetConfig,
            });

            const blockhash = await this.retryOperation(async () => {
                return (await this.connection.getLatestBlockhash()).blockhash;
            }, 3);

            transactions.forEach((tx: any) => {
                tx.message.recentBlockhash = blockhash;
                tx.sign([newTokenKeypair, ...tokenParams.extraSigners]);
            });

            const signatures: string[] = [];

            for (const tx of transactions) {
                const signature = await this.retryOperation(async () => {
                    if ('message' in tx) {
                        tx.sign([newTokenKeypair, ...tokenParams.extraSigners]);
                        return await this.connection.sendTransaction(tx, {
                            skipPreflight: false,
                            maxRetries: 3,
                        });
                    } else {
                        tx.sign([newTokenKeypair, ...tokenParams.extraSigners]);
                        return await this.connection.sendTransaction(tx, [newTokenKeypair, ...tokenParams.extraSigners], {
                            skipPreflight: false,
                            maxRetries: 3,
                        });
                    }
                }, 3);
                
                signatures.push(signature);
            }

            return {
                success: true,
                signatures,
                tokenMint: newTokenMint.toBase58()
            };
        } catch (e: any) {
            throw new Error(
                `Failed to create Raydium Launchpad token: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }
}