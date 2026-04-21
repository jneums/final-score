import { HttpAgent } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { CONFIG } from "./config.js";
// ─── PEM handling ─────────────────────────────────────────────
function decodePem(pemOrBase64) {
    if (pemOrBase64.includes("BEGIN"))
        return pemOrBase64;
    return Buffer.from(pemOrBase64, "base64").toString("utf-8");
}
/**
 * Generate a new secp256k1 identity. Returns the identity, its principal,
 * and the secret key encoded as base64 for storage/reconstruction.
 */
export function generateIdentity() {
    const identity = Secp256k1KeyIdentity.generate();
    const secretKey = identity.getKeyPair().secretKey;
    const pemBase64 = Buffer.from(secretKey).toString("base64");
    return {
        pemBase64,
        principal: identity.getPrincipal().toText(),
        identity,
    };
}
/**
 * Load an identity from a base64-encoded secret key or PEM string.
 * If the input contains "BEGIN", it's treated as PEM and loaded via fromPem().
 * Otherwise it's treated as a base64-encoded raw secret key.
 */
export function loadIdentityFromPem(pemBase64) {
    const decoded = decodePem(pemBase64);
    if (decoded.includes("BEGIN")) {
        return Secp256k1KeyIdentity.fromPem(decoded);
    }
    // Raw secret key stored as base64
    const buf = Buffer.from(pemBase64, "base64");
    return Secp256k1KeyIdentity.fromSecretKey(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
/**
 * Create an HttpAgent for the given identity.
 */
export async function createAgent(identity, host) {
    return HttpAgent.create({
        host: host || CONFIG.IC_HOST,
        identity,
    });
}
/**
 * Load the admin identity from CONFIG.ADMIN_IDENTITY_PEM.
 */
export function loadAdminIdentity() {
    if (!CONFIG.ADMIN_IDENTITY_PEM) {
        throw new Error("ADMIN_IDENTITY_PEM not set");
    }
    return loadIdentityFromPem(CONFIG.ADMIN_IDENTITY_PEM);
}
