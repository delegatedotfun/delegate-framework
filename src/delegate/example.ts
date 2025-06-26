import { Connection, Keypair } from "@solana/web3.js";
import { BaseDelegate } from "./base-delegate";
import { BaseDelegateOptions, BaseDelegateResult, DeployerDelegateOptions } from "./types";
import { Deployer } from "./deployer";
import { IrysClient } from "../solana/clients/metadata/irys";
import { DELEGATE_TYPES } from "./constants";

// Example of how to create and use delegates with the framework

export class ExampleUsage {
    
    static async createDeployerDelegate(): Promise<Deployer> {
        const connection = new Connection("https://api.mainnet-beta.solana.com");
        const signerKeypair = Keypair.generate(); // In real usage, load from secure storage
        const metadataClient = new IrysClient({
            privateKey: "your-private-key-here"
        });
        
        return new Deployer(connection, signerKeypair, metadataClient);
    }
    
    static async executeDeployerExample(): Promise<void> {
        try {
            const deployer = await this.createDeployerDelegate();
            
            const deployOptions: DeployerDelegateOptions = {
                type: DELEGATE_TYPES.DEPLOYER,
                platformId: "your-platform-id",
                tokenName: "My Token",
                tokenSymbol: "MTK",
                tokenDescription: "A great token",
                tokenMigrateType: "amm",
                buyAmount: 1000000, // 1 SOL in lamports
                buySlippageBps: 500, // 5%
                tokenImage: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
                tokenWebsite: "https://mytoken.com",
                tokenTwitter: "https://twitter.com/mytoken"
            };
            
            const result = await deployer.executeDelegate(deployOptions);
            
            console.log("Deployment successful!", {
                signatures: result.signatures,
                metadataUri: result.metadataUri,
                tokenMint: result.tokenMint
            });
            
        } catch (error) {
            console.error("Deployment failed:", error);
        }
    }
}

// Example of creating a custom delegate by extending BaseDelegate
export interface CustomDelegateOptions extends BaseDelegateOptions {
    type: "custom";
    customField: string;
    amount: number;
}

export interface CustomDelegateResult extends BaseDelegateResult {
    customResult: string;
}

export class CustomDelegate extends BaseDelegate<CustomDelegateOptions, CustomDelegateResult> {
    
    async executeDelegate(delegateOptions: CustomDelegateOptions): Promise<CustomDelegateResult> {
        const requestId = this.generateRequestId();
        
        try {
            this.logOperation('custom_delegate_started', { requestId });
            
            this.validateOptions(delegateOptions);
            
            // Your custom logic here
            const result = await this.retryOperation(async () => {
                // Simulate some work
                await new Promise(resolve => setTimeout(resolve, 1000));
                return `Processed ${delegateOptions.amount} of ${delegateOptions.customField}`;
            }, 3);
            
            this.logOperation('custom_delegate_completed', { requestId, result });
            
            return {
                success: true,
                customResult: result
            };
            
        } catch (error) {
            await this.handleError(error instanceof Error ? error : new Error(String(error)), { requestId });
            throw error;
        }
    }
    
    validateOptions(delegateOptions: CustomDelegateOptions): void {
        this.validateStringField(delegateOptions.customField, 'customField');
        this.validateNumberField(delegateOptions.amount, 'amount', 1);
    }
} 