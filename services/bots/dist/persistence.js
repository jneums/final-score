/**
 * Encrypted persistence for bot identities.
 *
 * Stores bot identity pool as AES-256-GCM encrypted JSON on disk.
 * Decrypted at startup, encrypted on every write.
 * Master key comes from BOT_POOL_KEY env var.
 *
 * File format: base64(iv:authTag:ciphertext)
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { addLog } from "./index.js";
// ─── Config ─────────────────────────────────────────────────
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT = "final-score-bot-pool-v1"; // Static salt — key derivation is from env var
// ─── Encryption ─────────────────────────────────────────────
function deriveKey(masterKey) {
    return scryptSync(masterKey, SALT, KEY_LENGTH);
}
function encrypt(data, masterKey) {
    const key = deriveKey(masterKey);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(data, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Format: base64(iv + authTag + ciphertext)
    const combined = Buffer.concat([iv, authTag, encrypted]);
    return combined.toString("base64");
}
function decrypt(encoded, masterKey) {
    const key = deriveKey(masterKey);
    const combined = Buffer.from(encoded, "base64");
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString("utf8");
}
// ─── Public API ─────────────────────────────────────────────
/**
 * Load the persisted pool from encrypted file.
 * Returns null if file doesn't exist or key is not set.
 */
export function loadPool(filePath) {
    const masterKey = process.env.BOT_POOL_KEY;
    if (!masterKey) {
        addLog("persistence", "load", "skip", "BOT_POOL_KEY not set — identity persistence disabled");
        return null;
    }
    if (!existsSync(filePath)) {
        addLog("persistence", "load", "skip", `No pool file at ${filePath}`);
        return null;
    }
    try {
        const encoded = readFileSync(filePath, "utf8").trim();
        const json = decrypt(encoded, masterKey);
        const pool = JSON.parse(json);
        addLog("persistence", "load", "success", `Loaded ${pool.identities.length} identities (${pool.idleNames.length} idle), nextIndex=${pool.nextBotIndex}`);
        return pool;
    }
    catch (e) {
        addLog("persistence", "load", "error", `Failed to decrypt/parse pool: ${String(e).slice(0, 200)}`);
        return null;
    }
}
/**
 * Save the pool to encrypted file.
 */
export function savePool(filePath, pool) {
    const masterKey = process.env.BOT_POOL_KEY;
    if (!masterKey) {
        return false;
    }
    try {
        pool.updatedAt = new Date().toISOString();
        const json = JSON.stringify(pool);
        const encoded = encrypt(json, masterKey);
        // Ensure directory exists
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(filePath, encoded, "utf8");
        addLog("persistence", "save", "success", `Saved ${pool.identities.length} identities to ${filePath}`);
        return true;
    }
    catch (e) {
        addLog("persistence", "save", "error", `Failed to save pool: ${String(e).slice(0, 200)}`);
        return false;
    }
}
/**
 * Check if persistence is available (BOT_POOL_KEY is set).
 */
export function isPersistenceEnabled() {
    return !!process.env.BOT_POOL_KEY;
}
