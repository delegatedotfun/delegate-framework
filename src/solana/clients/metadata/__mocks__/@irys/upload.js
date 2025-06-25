module.exports = {
  Uploader: jest.fn(() => ({
    withWallet: jest.fn().mockResolvedValue({
      address: 'mock-irys-address',
      getPrice: jest.fn(),
      getLoadedBalance: jest.fn(),
      fund: jest.fn(),
      upload: jest.fn(),
      uploadFile: jest.fn(),
    })
  }))
}; 