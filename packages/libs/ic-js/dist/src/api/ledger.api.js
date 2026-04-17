// packages/libs/ic-js/src/api/ledger.api.ts
import { Principal } from '@icp-sdk/core/principal';
import { getUsdcLedgerActor } from '../actors.js';
// Helper to safely stringify errors that may contain BigInt
function stringifyError(err) {
    try {
        return JSON.stringify(err, (_, value) => typeof value === 'bigint' ? value.toString() : value);
    }
    catch {
        return String(err);
    }
}
/**
 * Get USDC balance for a principal.
 * @param principal Principal ID as string
 * @returns Balance in atomic units (6 decimals, so 1_000_000 = 1 USDC)
 */
export async function getUsdcBalance(principal) {
    const ledger = await getUsdcLedgerActor();
    return ledger.icrc1_balance_of({
        owner: Principal.fromText(principal),
        subaccount: [],
    });
}
/**
 * Approve a canister/principal to spend USDC on behalf of the user (ICRC-2).
 * @param identity User's identity
 * @param spender Canister/principal to approve
 * @param amount Amount in atomic units to approve
 * @returns Approval block index
 */
export async function approveUsdc(identity, spender, amount) {
    const ledger = await getUsdcLedgerActor(identity);
    const result = await ledger.icrc2_approve({
        spender: {
            owner: Principal.fromText(spender),
            subaccount: [],
        },
        amount,
        fee: [],
        memo: [],
        from_subaccount: [],
        created_at_time: [],
        expected_allowance: [],
        expires_at: [],
    });
    if ('Err' in result) {
        throw new Error(`USDC approval failed: ${stringifyError(result.Err)}`);
    }
    return result.Ok;
}
/**
 * Check current ICRC-2 allowance for a spender.
 * @param identity User's identity (to determine owner principal)
 * @param spender Principal to check allowance for
 * @returns Current allowance in atomic units
 */
export async function getAllowance(identity, spender) {
    const ledger = await getUsdcLedgerActor(identity);
    const ownerPrincipal = identity.getPrincipal();
    const result = await ledger.icrc2_allowance({
        account: {
            owner: ownerPrincipal,
            subaccount: [],
        },
        spender: {
            owner: Principal.fromText(spender),
            subaccount: [],
        },
    });
    return result.allowance;
}
/**
 * Transfer USDC to another principal (ICRC-1).
 * @param identity Sender's identity
 * @param to Recipient principal ID
 * @param amount Amount in atomic units
 * @returns Transaction block index
 */
export async function transferUsdc(identity, to, amount) {
    const ledger = await getUsdcLedgerActor(identity);
    const result = await ledger.icrc1_transfer({
        to: {
            owner: Principal.fromText(to),
            subaccount: [],
        },
        amount,
        fee: [],
        memo: [],
        from_subaccount: [],
        created_at_time: [],
    });
    if ('Err' in result) {
        throw new Error(`USDC transfer failed: ${stringifyError(result.Err)}`);
    }
    return result.Ok;
}
