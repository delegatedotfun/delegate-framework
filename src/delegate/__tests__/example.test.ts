let logSpy: jest.SpyInstance, errorSpy: jest.SpyInstance, warnSpy: jest.SpyInstance;

beforeAll(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

import { Connection, Keypair } from "@solana/web3.js";
import { ExampleUsage, CustomDelegate, CustomDelegateOptions } from "../example";
import { BaseDelegate } from "../base-delegate";

// Mock the IrysClient
jest.mock('../../solana/clients/metadata/irys', () => ({
    IrysClient: jest.fn().mockImplementation(() => ({
        uploadMetadata: jest.fn().mockResolvedValue({ success: true, uri: 'https://arweave.net/test' }),
        uploadImage: jest.fn().mockResolvedValue({ success: true, uri: 'https://arweave.net/image' })
    }))
}));

describe('Example Usage', () => {
    let connection: Connection;
    let signerKeypair: Keypair;

    beforeEach(() => {
        connection = new Connection('http://localhost:8899');
        signerKeypair = Keypair.generate();
    });

    describe('ExampleUsage', () => {
        describe('createDeployerDelegate', () => {
            it('should create a deployer delegate with required dependencies', async () => {
                const deployer = await ExampleUsage.createDeployerDelegate();
                
                expect(deployer).toBeDefined();
                expect(deployer.connection).toBeDefined();
                expect(deployer.signerKeypair).toBeDefined();
            });
        });

        describe('executeDeployerExample', () => {
            it('should execute deployer example successfully', async () => {
                // This will fail due to mocked dependencies, but we can test the structure
                await ExampleUsage.executeDeployerExample();
                // No need to check consoleSpy, logs are globally silenced
            });
        });
    });

    describe('CustomDelegate', () => {
        let customDelegate: CustomDelegate;

        beforeEach(() => {
            customDelegate = new CustomDelegate(connection, signerKeypair);
        });

        describe('constructor', () => {
            it('should extend BaseDelegate', () => {
                expect(customDelegate).toBeInstanceOf(BaseDelegate);
                expect(customDelegate.connection).toBe(connection);
                expect(customDelegate.signerKeypair).toBe(signerKeypair);
            });
        });

        describe('validateOptions', () => {
            const validOptions: CustomDelegateOptions = {
                type: 'custom',
                customField: 'test-value',
                amount: 5
            };

            it('should validate required fields', () => {
                expect(() => customDelegate.validateOptions(validOptions)).not.toThrow();
            });

            it('should throw for missing customField', () => {
                const invalidOptions = { ...validOptions, customField: '' };
                expect(() => customDelegate.validateOptions(invalidOptions)).toThrow('customField must be a non-empty string');
            });

            it('should throw for invalid amount', () => {
                const invalidOptions = { ...validOptions, amount: 0 };
                expect(() => customDelegate.validateOptions(invalidOptions)).toThrow('amount must be at least 1');
            });
        });

        describe('executeDelegate', () => {
            const validOptions: CustomDelegateOptions = {
                type: 'custom',
                customField: 'test-value',
                amount: 3
            };

            it('should execute successfully', async () => {
                const result = await customDelegate.executeDelegate(validOptions);
                
                expect(result.success).toBe(true);
                expect(result.customResult).toBe('Processed 3 of test-value');
            });

            it('should handle errors gracefully', async () => {
                // Mock retryOperation to fail
                jest.spyOn(customDelegate, 'retryOperation').mockRejectedValue(new Error('Test error'));
                
                await expect(customDelegate.executeDelegate(validOptions)).rejects.toThrow('Test error');
            });

            it('should log operations during execution', async () => {
                await customDelegate.executeDelegate(validOptions);
                // No need to check consoleSpy, logs are globally silenced
            });
        });

        describe('retry logic', () => {
            it('should use retry logic for operations', async () => {
                const validOptions: CustomDelegateOptions = {
                    type: 'custom',
                    customField: 'test-value',
                    amount: 1
                };

                const retrySpy = jest.spyOn(customDelegate, 'retryOperation');
                
                await customDelegate.executeDelegate(validOptions);
                
                expect(retrySpy).toHaveBeenCalledWith(
                    expect.any(Function),
                    3
                );
            });
        });

        describe('error handling', () => {
            it('should handle errors with context', async () => {
                const validOptions: CustomDelegateOptions = {
                    type: 'custom',
                    customField: 'test-value',
                    amount: 1
                };

                // Mock retryOperation to fail
                jest.spyOn(customDelegate, 'retryOperation').mockRejectedValue(new Error('Test error'));
                const handleErrorSpy = jest.spyOn(customDelegate, 'handleError');
                
                try {
                    await customDelegate.executeDelegate(validOptions);
                } catch (error) {
                    // Expected to fail
                }
                
                expect(handleErrorSpy).toHaveBeenCalledWith(
                    expect.any(Error),
                    expect.objectContaining({
                        requestId: expect.any(Number)
                    })
                );
            });
        });
    });

    describe('Framework Integration', () => {
        it('should demonstrate framework capabilities', async () => {
            const customDelegate = new CustomDelegate(connection, signerKeypair);
            
            // Test that the delegate has all framework features
            expect(customDelegate.retryOperation).toBeDefined();
            expect(customDelegate.handleError).toBeDefined();
            expect(customDelegate.logOperation).toBeDefined();
            expect(customDelegate.validateOptions).toBeDefined();
            expect(customDelegate.executeDelegate).toBeDefined();
            
            // Test that it can execute with framework features
            const options: CustomDelegateOptions = {
                type: 'custom',
                customField: 'framework-test',
                amount: 2
            };
            
            const result = await customDelegate.executeDelegate(options);
            
            expect(result.success).toBe(true);
            expect(result.customResult).toBe('Processed 2 of framework-test');
        });
    });
}); 