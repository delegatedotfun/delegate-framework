export const DELEGATE_TYPES = {
    DEPLOYER: 'deployer',
    BURNER: 'burner',
    ALLOCATOR: 'allocator',
    DISTRIBUTOR: 'distributor',
    HOPPER: 'hopper',
    LIQUIDATOR: 'liquidator',
} as const;

// Solana constants
export const TOKEN_ACCOUNT_RENT = 2039280; // Rent for token account in lamports
export const FEE_WALLET_ADDRESS = '11111111111111111111111111111111'; // Default fee wallet (can be overridden)