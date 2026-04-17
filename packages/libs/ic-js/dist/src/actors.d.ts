import { type Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { FinalScore } from '@final-score/declarations';
export type FinalScoreService = FinalScore._SERVICE;
export interface UsdcAccount {
    owner: Principal;
    subaccount: [] | [Uint8Array | number[]];
}
export interface UsdcLedgerService {
    icrc1_balance_of: (account: UsdcAccount) => Promise<bigint>;
    icrc1_transfer: (arg: {
        from_subaccount: [] | [Uint8Array | number[]];
        to: UsdcAccount;
        amount: bigint;
        fee: [] | [bigint];
        memo: [] | [Uint8Array | number[]];
        created_at_time: [] | [bigint];
    }) => Promise<{
        Ok: bigint;
    } | {
        Err: any;
    }>;
    icrc2_approve: (arg: {
        from_subaccount: [] | [Uint8Array | number[]];
        spender: UsdcAccount;
        amount: bigint;
        expected_allowance: [] | [bigint];
        expires_at: [] | [bigint];
        fee: [] | [bigint];
        memo: [] | [Uint8Array | number[]];
        created_at_time: [] | [bigint];
    }) => Promise<{
        Ok: bigint;
    } | {
        Err: any;
    }>;
    icrc2_allowance: (arg: {
        account: UsdcAccount;
        spender: UsdcAccount;
    }) => Promise<{
        allowance: bigint;
        expires_at: [] | [bigint];
    }>;
}
/**
 * Gets an actor for the Final Score canister.
 */
export declare const getFinalScoreActor: (identity?: Identity) => Promise<FinalScoreService>;
/**
 * Gets an actor for the USDC ledger canister (ICRC-1/ICRC-2).
 */
export declare const getUsdcLedgerActor: (identity?: Identity) => Promise<UsdcLedgerService>;
