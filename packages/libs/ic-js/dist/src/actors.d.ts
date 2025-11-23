import { type Identity } from '@icp-sdk/core/agent';
import { FinalScore } from '@final-score/declarations';
/**
 * Gets an actor for the Final Score canister
 * @param identity Optional identity to use for the actor
 * @returns An actor instance for the Final Score canister
 */
export declare const getLeaderboardActor: (identity?: Identity) => FinalScore._SERVICE;
