export interface UploadResult {
    success: boolean;
    uri?: string;
    error?: string;
    txId?: string;
}

export interface MetadataClient {
    uploadMetadata(metadata: any): Promise<UploadResult>;
    uploadImage(image: Buffer): Promise<UploadResult>;
}