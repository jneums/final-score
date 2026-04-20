// packages/libs/ic-js/src/api/token-info.api.ts
import { getFinalScoreActor } from '../actors.js';
/**
 * Fetch token metadata from the Final Score canister.
 * Returns the configured token's ledger principal, symbol, decimals, and fee.
 */
export async function getTokenInfo() {
    const actor = await getFinalScoreActor();
    const info = await actor.get_token_info();
    return {
        ledger: info.ledger,
        symbol: info.symbol,
        decimals: info.decimals,
        fee: Number(info.fee),
    };
}
