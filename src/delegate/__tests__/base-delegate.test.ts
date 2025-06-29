import { Connection, Keypair } from "@solana/web3.js";
import { BaseDelegate } from "../base-delegate";
import { BaseDelegateOptions, BaseDelegateResult } from "../types";

// Mock delegate for testing
class TestDelegate extends BaseDelegate<BaseDelegateOptions, BaseDelegateResult> {
    async executeDelegate(): Promise<BaseDelegateResult> {
        return { success: true };
    }
    
    validateOptions(): void {
        // Test validation
    }
}

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

describe('BaseDelegate', () => {
    let delegate: TestDelegate;
    let connection: Connection;
    let signerKeypair: Keypair;

    beforeEach(() => {
        connection = new Connection('http://localhost:8899');
        signerKeypair = Keypair.generate();
        delegate = new TestDelegate(connection, signerKeypair);
    });

    describe('constructor', () => {
        it('should initialize with connection and signer', () => {
            expect(delegate.connection).toBe(connection);
            expect(delegate.signerKeypair).toBe(signerKeypair);
            expect(delegate.feeTakerKeypair).toBeUndefined();
        });

        it('should accept optional feeTakerKeypair', () => {
            const feeTaker = Keypair.generate();
            const delegateWithFee = new TestDelegate(connection, signerKeypair, feeTaker);
            expect(delegateWithFee.feeTakerKeypair).toBe(feeTaker);
        });
    });

    describe('retryOperation', () => {
        it('should succeed on first attempt', async () => {
            const operation = jest.fn().mockResolvedValue('success');
            
            const result = await delegate.retryOperation(operation);
            
            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(1);
        });

        it('should retry and succeed on second attempt', async () => {
            const operation = jest.fn()
                .mockRejectedValueOnce(new Error('First failure'))
                .mockResolvedValue('success');
            
            const result = await delegate.retryOperation(operation, 2);
            
            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(2);
        });

        it('should fail after max retries', async () => {
            const error = new Error('Persistent failure');
            const operation = jest.fn().mockRejectedValue(error);
            
            await expect(delegate.retryOperation(operation, 3)).rejects.toThrow('Persistent failure');
            expect(operation).toHaveBeenCalledTimes(3);
        }, 10000); // Increase timeout for retry test

        it('should use exponential backoff', async () => {
            const operation = jest.fn()
                .mockRejectedValueOnce(new Error('First failure'))
                .mockRejectedValueOnce(new Error('Second failure'))
                .mockResolvedValue('success');
            
            const startTime = Date.now();
            const result = await delegate.retryOperation(operation, 3);
            const endTime = Date.now();
            
            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(3);
            
            // Verify that exponential backoff was used (should take at least 6 seconds: 2 + 4)
            const elapsedTime = endTime - startTime;
            expect(elapsedTime).toBeGreaterThanOrEqual(6000);
        }, 10000);
    });

    describe('handleError', () => {
        it('should log error with context', async () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
            const error = new Error('Test error');
            const context = { testField: 'testValue' };
            
            await delegate.handleError(error, context);
            
            expect(consoleSpy).toHaveBeenCalledWith(
                'Delegate operation failed:',
                expect.objectContaining({
                    error: 'Test error',
                    stack: error.stack,
                    testField: 'testValue',
                    timestamp: expect.any(String)
                })
            );
            
            consoleSpy.mockRestore();
        });
    });

    describe('logOperation', () => {
        it('should log operation with data', () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            const data = { testField: 'testValue' };
            
            delegate.logOperation('test_operation', data);
            
            expect(consoleSpy).toHaveBeenCalledWith(
                '[Delegate] test_operation:',
                expect.objectContaining({
                    operation: 'test_operation',
                    timestamp: expect.any(String),
                    signer: signerKeypair.publicKey.toBase58(),
                    testField: 'testValue'
                })
            );
            
            consoleSpy.mockRestore();
        });
    });

    describe('generateRequestId', () => {
        it('should generate sequential request IDs', () => {
            const id1 = delegate['generateRequestId']();
            const id2 = delegate['generateRequestId']();
            const id3 = delegate['generateRequestId']();
            
            expect(id1).toBe(1);
            expect(id2).toBe(2);
            expect(id3).toBe(3);
        });
    });

    describe('validation helpers', () => {
        describe('validatePublicKey', () => {
            it('should validate valid public key', () => {
                const validKey = '11111111111111111111111111111111';
                expect(() => delegate['validatePublicKey'](validKey, 'testField')).not.toThrow();
            });

            it('should throw for invalid public key', () => {
                const invalidKey = 'invalid-key';
                expect(() => delegate['validatePublicKey'](invalidKey, 'testField')).toThrow(
                    'Invalid testField: invalid-key, must be a valid public key'
                );
            });
        });

        describe('validateRequiredField', () => {
            it('should pass for truthy values', () => {
                expect(() => delegate['validateRequiredField']('test', 'testField')).not.toThrow();
                expect(() => delegate['validateRequiredField'](123, 'testField')).not.toThrow();
                expect(() => delegate['validateRequiredField'](true, 'testField')).not.toThrow();
            });

            it('should throw for falsy values', () => {
                expect(() => delegate['validateRequiredField']('', 'testField')).toThrow('testField is required');
                expect(() => delegate['validateRequiredField'](0, 'testField')).toThrow('testField is required');
                expect(() => delegate['validateRequiredField'](false, 'testField')).toThrow('testField is required');
                expect(() => delegate['validateRequiredField'](null, 'testField')).toThrow('testField is required');
                expect(() => delegate['validateRequiredField'](undefined, 'testField')).toThrow('testField is required');
            });
        });

        describe('validateStringField', () => {
            it('should pass for valid strings', () => {
                expect(() => delegate['validateStringField']('test', 'testField')).not.toThrow();
                expect(() => delegate['validateStringField']('a', 'testField', 1)).not.toThrow();
            });

            it('should throw for invalid strings', () => {
                expect(() => delegate['validateStringField']('', 'testField')).toThrow('testField must be a non-empty string');
                expect(() => delegate['validateStringField']('a', 'testField', 2)).toThrow('testField must be a non-empty string');
                expect(() => delegate['validateStringField'](123 as any, 'testField')).toThrow('testField must be a non-empty string');
            });
        });

        describe('validateNumberField', () => {
            it('should pass for valid numbers', () => {
                expect(() => delegate['validateNumberField'](5, 'testField')).not.toThrow();
                expect(() => delegate['validateNumberField'](5, 'testField', 1, 10)).not.toThrow();
            });

            it('should throw for invalid numbers', () => {
                expect(() => delegate['validateNumberField'](5, 'testField', 10)).toThrow('testField must be at least 10');
                expect(() => delegate['validateNumberField'](5, 'testField', 1, 3)).toThrow('testField must be at most 3');
                expect(() => delegate['validateNumberField']('5' as any, 'testField')).toThrow('testField must be a valid number');
                expect(() => delegate['validateNumberField'](NaN, 'testField')).toThrow('testField must be a valid number');
            });
        });
    });
}); 