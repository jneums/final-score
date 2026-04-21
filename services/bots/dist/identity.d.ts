import { HttpAgent } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
export interface GeneratedIdentity {
    pemBase64: string;
    principal: string;
    identity: Secp256k1KeyIdentity;
}
/**
 * Generate a new secp256k1 identity. Returns the identity, its principal,
 * and the secret key encoded as base64 for storage/reconstruction.
 */
export declare function generateIdentity(): GeneratedIdentity;
/**
 * Load an identity from a base64-encoded secret key or PEM string.
 * If the input contains "BEGIN", it's treated as PEM and loaded via fromPem().
 * Otherwise it's treated as a base64-encoded raw secret key.
 */
export declare function loadIdentityFromPem(pemBase64: string): Secp256k1KeyIdentity;
/**
 * Create an HttpAgent for the given identity.
 */
export declare function createAgent(identity: Secp256k1KeyIdentity, host?: string): Promise<HttpAgent>;
/**
 * Load the admin identity from CONFIG.ADMIN_IDENTITY_PEM.
 */
export declare function loadAdminIdentity(): Secp256k1KeyIdentity;
