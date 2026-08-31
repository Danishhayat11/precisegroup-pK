declare module "webpush-webcrypto" {
  export class ApplicationServerKeys {
    constructor(publicKey: CryptoKey, privateKey: CryptoKey);
    publicKey: CryptoKey;
    privateKey: CryptoKey;
    toJSON(): Promise<{ publicKey: string; privateKey: string }>;
    static fromJSON(keys: {
      publicKey: string;
      privateKey: string;
    }): Promise<ApplicationServerKeys>;
    static generate(): Promise<ApplicationServerKeys>;
  }
  export function generatePushHTTPRequest(opts: {
    applicationServerKeys: ApplicationServerKeys;
    payload: string | Uint8Array;
    target: { endpoint: string; keys: { p256dh: string; auth: string } };
    adminContact: string;
    ttl: number;
    topic?: string;
    urgency?: "very-low" | "low" | "normal" | "high";
  }): Promise<{ endpoint: string; headers: Record<string, string>; body: Uint8Array }>;
  export function setWebCrypto(crypto: Crypto): void;
}
