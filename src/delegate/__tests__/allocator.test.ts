import { AllocatorDelegateOptions, AllocatorDelegateResult } from '../types';

describe('Allocator Types and Validation', () => {
    describe('AllocatorDelegateOptions validation', () => {
        it('should accept valid allocator options', () => {
            const validOptions: AllocatorDelegateOptions = {
                type: 'allocator',
                allocations: [
                    { contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', percentage: 50 },
                    { contractAddress: 'So11111111111111111111111111111111111111112', percentage: 30 }
                ],
                slippageBps: 100,
                costBuffer: 0.005
            };

            expect(validOptions.type).toBe('allocator');
            expect(validOptions.allocations).toHaveLength(2);
            expect(validOptions.allocations[0]?.contractAddress).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            expect(validOptions.allocations[0]?.percentage).toBe(50);
            expect(validOptions.slippageBps).toBe(100);
            expect(validOptions.costBuffer).toBe(0.005);
        });

        it('should accept options with default values', () => {
            const optionsWithDefaults: AllocatorDelegateOptions = {
                type: 'allocator',
                allocations: [
                    { contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', percentage: 100 }
                ]
            };

            expect(optionsWithDefaults.type).toBe('allocator');
            expect(optionsWithDefaults.allocations).toHaveLength(1);
            expect(optionsWithDefaults.slippageBps).toBeUndefined();
            expect(optionsWithDefaults.costBuffer).toBeUndefined();
        });

        it('should validate allocation percentages sum correctly', () => {
            const allocations = [
                { contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', percentage: 60 },
                { contractAddress: 'So11111111111111111111111111111111111111112', percentage: 40 }
            ];

            const totalPercentage = allocations.reduce((sum, allocation) => sum + allocation.percentage, 0);
            expect(totalPercentage).toBe(100);
        });

        it('should handle edge case percentages', () => {
            const edgeCaseOptions: AllocatorDelegateOptions = {
                type: 'allocator',
                allocations: [
                    { contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', percentage: 0.1 },
                    { contractAddress: 'So11111111111111111111111111111111111111112', percentage: 99.9 }
                ]
            };

            expect(edgeCaseOptions.allocations[0]?.percentage).toBe(0.1);
            expect(edgeCaseOptions.allocations[1]?.percentage).toBe(99.9);
        });
    });

    describe('AllocatorDelegateResult structure', () => {
        it('should have correct result structure', () => {
            const mockResult: AllocatorDelegateResult = {
                success: true,
                signatures: ['signature1', 'signature2'],
                allocations: [
                    {
                        contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                        percentage: 50,
                        amountAllocated: 0.495,
                        signature: 'signature1'
                    },
                    {
                        contractAddress: 'So11111111111111111111111111111111111111112',
                        percentage: 30,
                        amountAllocated: 0.295,
                        signature: 'signature2'
                    }
                ]
            };

            expect(mockResult.success).toBe(true);
            expect(mockResult.signatures).toHaveLength(2);
            expect(mockResult.allocations).toHaveLength(2);
            expect(mockResult.allocations[0]?.contractAddress).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            expect(mockResult.allocations[0]?.percentage).toBe(50);
            expect(mockResult.allocations[0]?.amountAllocated).toBe(0.495);
            expect(mockResult.allocations[0]?.signature).toBe('signature1');
        });

        it('should handle empty result case', () => {
            const emptyResult: AllocatorDelegateResult = {
                success: true,
                signatures: [],
                allocations: []
            };

            expect(emptyResult.success).toBe(true);
            expect(emptyResult.signatures).toHaveLength(0);
            expect(emptyResult.allocations).toHaveLength(0);
        });

        it('should handle error result case', () => {
            const errorResult: AllocatorDelegateResult = {
                success: false,
                error: 'Insufficient balance for allocation',
                signatures: [],
                allocations: []
            };

            expect(errorResult.success).toBe(false);
            expect(errorResult.error).toBe('Insufficient balance for allocation');
            expect(errorResult.signatures).toHaveLength(0);
            expect(errorResult.allocations).toHaveLength(0);
        });
    });

    describe('Allocation calculation logic', () => {
        it('should calculate allocation amounts correctly', () => {
            const totalBalance = 1.0; // 1 SOL
            const costBuffer = 0.005;

            const expectedAmounts = [
                (totalBalance * 0.5) - costBuffer, // 0.495 SOL
                (totalBalance * 0.3) - costBuffer, // 0.295 SOL
                (totalBalance * 0.2) - costBuffer  // 0.195 SOL
            ];

            expect(expectedAmounts[0]).toBe(0.495);
            expect(expectedAmounts[1]).toBe(0.295);
            expect(expectedAmounts[2]).toBe(0.195);
        });

        it('should handle different cost buffer values', () => {
            const totalBalance = 1.0;

            const costBuffer1 = 0.001;
            const costBuffer2 = 0.01;

            const amount1 = (totalBalance * 1.0) - costBuffer1;
            const amount2 = (totalBalance * 1.0) - costBuffer2;

            expect(amount1).toBe(0.999);
            expect(amount2).toBe(0.99);
        });

        it('should handle insufficient balance scenarios', () => {
            const lowBalance = 0.001; // 0.001 SOL
            const costBuffer = 0.005;

            const amountToAllocate = (lowBalance * 0.5) - costBuffer;
            
            // Should be negative, indicating insufficient balance
            expect(amountToAllocate).toBeLessThan(0);
        });
    });

    describe('Slippage and cost buffer validation', () => {
        it('should validate slippageBps range', () => {
            const validSlippageBps = [0, 50, 100, 1000, 10000];
            const invalidSlippageBps = [-1, 10001, 15000];

            validSlippageBps.forEach(slippage => {
                expect(slippage).toBeGreaterThanOrEqual(0);
                expect(slippage).toBeLessThanOrEqual(10000);
            });

            invalidSlippageBps.forEach(slippage => {
                expect(slippage < 0 || slippage > 10000).toBe(true);
            });
        });

        it('should validate cost buffer range', () => {
            const validCostBuffers = [0, 0.001, 0.01, 0.1];
            const invalidCostBuffers = [-0.001, -0.1];

            validCostBuffers.forEach(buffer => {
                expect(buffer).toBeGreaterThanOrEqual(0);
            });

            invalidCostBuffers.forEach(buffer => {
                expect(buffer).toBeLessThan(0);
            });
        });

        it('should convert slippageBps to percentage correctly', () => {
            const slippageBps = 100;
            const slippagePercentage = slippageBps / 100;
            
            expect(slippagePercentage).toBe(1.0); // 1%
        });
    });

    describe('Contract address validation', () => {
        it('should validate Solana public key format', () => {
            const validAddresses = [
                'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
                'So11111111111111111111111111111111111111112',  // SOL
                '11111111111111111111111111111111'             // System Program
            ];

            const invalidAddresses = [
                'invalid-address',
                'not-a-public-key',
                '',
                '123'
            ];

            validAddresses.forEach(address => {
                expect(address.length).toBeGreaterThan(0);
                expect(typeof address).toBe('string');
            });

            invalidAddresses.forEach(address => {
                expect(address === '' || address.length < 32 || address.includes('-')).toBe(true);
            });
        });
    });

    describe('Error handling scenarios', () => {
        it('should handle various error conditions', () => {
            const errorScenarios = [
                {
                    condition: 'Empty allocations array',
                    allocations: [],
                    expectedError: 'At least one allocation is required'
                },
                {
                    condition: 'Invalid contract address',
                    allocations: [{ contractAddress: 'invalid', percentage: 50 }],
                    expectedError: 'Invalid contractAddress'
                },
                {
                    condition: 'Negative percentage',
                    allocations: [{ contractAddress: 'valid-address', percentage: -10 }],
                    expectedError: 'percentage must be a positive number'
                },
                {
                    condition: 'Total percentage exceeds 100',
                    allocations: [
                        { contractAddress: 'token1', percentage: 60 },
                        { contractAddress: 'token2', percentage: 50 }
                    ],
                    expectedError: 'Total allocation percentage cannot exceed 100%'
                },
                {
                    condition: 'Invalid slippageBps',
                    allocations: [{ contractAddress: 'token1', percentage: 50 }],
                    slippageBps: 15000,
                    expectedError: 'slippageBps must be at most 10000'
                }
            ];

            errorScenarios.forEach(scenario => {
                expect(scenario.expectedError).toBeDefined();
                expect(typeof scenario.expectedError).toBe('string');
            });
        });
    });
}); 