import { type Identity } from '@icp-sdk/core/agent';
/**
 * Get USDC balance for a principal.
 * @param principal Principal ID as string
 * @returns Balance in atomic units (6 decimals, so 1_000_000 = 1 USDC)
 */
export declare function getUsdcBalance(principal: string): Promise<bigint>;
/**
 * Approve a canister/principal to spend USDC on behalf of the user (ICRC-2).
 * @param identity User's identity
 * @param spender Canister/principal to approve
 * @param amount Amount in atomic units to approve
 * @returns Approval block index
 */
export declare function approveUsdc(identity: Identity, spender: string, amount: bigint): Promise<bigint>;
/**
 * Check current ICRC-2 allowance for a spender.
 * @param identity User's identity (to determine owner principal)
 * @param spender Principal to check allowance for
 * @returns Current allowance in atomic units
 */
export declare function getAllowance(identity: Identity, spender: string): Promise<bigint>;
/**
 * Transfer USDC to another principal (ICRC-1).
 * @param identity Sender's identity
 * @param to Recipient principal ID
 * @param amount Amount in atomic units
 * @returns Transaction block index
 */
export declare function transferUsdc(identity: Identity, to: string, amount: bigint): Promise<bigint>;
