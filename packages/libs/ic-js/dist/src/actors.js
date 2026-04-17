import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { FinalScore } from '@final-score/declarations';
import { getCanisterId, getHost } from './config.js';
// --------------------------------------------------------------------------
// Minimal ICRC-1 / ICRC-2 IDL for the USDC ledger
// --------------------------------------------------------------------------
const usdcIdlFactory = ({ IDL: IDLInner }) => {
    const Account = IDLInner.Record({
        owner: IDLInner.Principal,
        subaccount: IDLInner.Opt(IDLInner.Vec(IDLInner.Nat8)),
    });
    const TransferArg = IDLInner.Record({
        from_subaccount: IDLInner.Opt(IDLInner.Vec(IDLInner.Nat8)),
        to: Account,
        amount: IDLInner.Nat,
        fee: IDLInner.Opt(IDLInner.Nat),
        memo: IDLInner.Opt(IDLInner.Vec(IDLInner.Nat8)),
        created_at_time: IDLInner.Opt(IDLInner.Nat64),
    });
    const TransferError = IDLInner.Variant({
        BadFee: IDLInner.Record({ expected_fee: IDLInner.Nat }),
        BadBurn: IDLInner.Record({ min_burn_amount: IDLInner.Nat }),
        InsufficientFunds: IDLInner.Record({ balance: IDLInner.Nat }),
        TooOld: IDLInner.Null,
        CreatedInFuture: IDLInner.Record({ ledger_time: IDLInner.Nat64 }),
        Duplicate: IDLInner.Record({ duplicate_of: IDLInner.Nat }),
        TemporarilyUnavailable: IDLInner.Null,
        GenericError: IDLInner.Record({
            error_code: IDLInner.Nat,
            message: IDLInner.Text,
        }),
    });
    const TransferResult = IDLInner.Variant({
        Ok: IDLInner.Nat,
        Err: TransferError,
    });
    const ApproveArg = IDLInner.Record({
        from_subaccount: IDLInner.Opt(IDLInner.Vec(IDLInner.Nat8)),
        spender: Account,
        amount: IDLInner.Nat,
        expected_allowance: IDLInner.Opt(IDLInner.Nat),
        expires_at: IDLInner.Opt(IDLInner.Nat64),
        fee: IDLInner.Opt(IDLInner.Nat),
        memo: IDLInner.Opt(IDLInner.Vec(IDLInner.Nat8)),
        created_at_time: IDLInner.Opt(IDLInner.Nat64),
    });
    const ApproveError = IDLInner.Variant({
        BadFee: IDLInner.Record({ expected_fee: IDLInner.Nat }),
        InsufficientFunds: IDLInner.Record({ balance: IDLInner.Nat }),
        AllowanceChanged: IDLInner.Record({ current_allowance: IDLInner.Nat }),
        Expired: IDLInner.Record({ ledger_time: IDLInner.Nat64 }),
        TooOld: IDLInner.Null,
        CreatedInFuture: IDLInner.Record({ ledger_time: IDLInner.Nat64 }),
        Duplicate: IDLInner.Record({ duplicate_of: IDLInner.Nat }),
        TemporarilyUnavailable: IDLInner.Null,
        GenericError: IDLInner.Record({
            error_code: IDLInner.Nat,
            message: IDLInner.Text,
        }),
    });
    const ApproveResult = IDLInner.Variant({
        Ok: IDLInner.Nat,
        Err: ApproveError,
    });
    const AllowanceArg = IDLInner.Record({
        account: Account,
        spender: Account,
    });
    const AllowanceResult = IDLInner.Record({
        allowance: IDLInner.Nat,
        expires_at: IDLInner.Opt(IDLInner.Nat64),
    });
    return IDLInner.Service({
        icrc1_balance_of: IDLInner.Func([Account], [IDLInner.Nat], ['query']),
        icrc1_transfer: IDLInner.Func([TransferArg], [TransferResult], []),
        icrc2_approve: IDLInner.Func([ApproveArg], [ApproveResult], []),
        icrc2_allowance: IDLInner.Func([AllowanceArg], [AllowanceResult], ['query']),
    });
};
function isPlugAgent(identityOrAgent) {
    return (identityOrAgent &&
        typeof identityOrAgent === 'object' &&
        'agent' in identityOrAgent &&
        'getPrincipal' in identityOrAgent &&
        typeof identityOrAgent.getPrincipal === 'function');
}
const createActor = async (idlFactoryFn, canisterId, identity) => {
    const host = getHost();
    const isLocal = host.includes('localhost') ||
        host.includes('127.0.0.1') ||
        host.includes('host.docker.internal');
    const agent = await HttpAgent.create({
        host,
        identity,
        shouldFetchRootKey: isLocal,
    });
    return Actor.createActor(idlFactoryFn, {
        agent,
        canisterId,
    });
};
// --------------------------------------------------------------------------
// Public actor getters
// --------------------------------------------------------------------------
/**
 * Gets an actor for the Final Score canister.
 */
export const getFinalScoreActor = async (identity) => {
    return createActor(FinalScore.idlFactory, getCanisterId('FINAL_SCORE'), identity);
};
/**
 * Gets an actor for the USDC ledger canister (ICRC-1/ICRC-2).
 */
export const getUsdcLedgerActor = async (identity) => {
    return createActor(usdcIdlFactory, getCanisterId('USDC_LEDGER'), identity);
};
