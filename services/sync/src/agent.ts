import { Actor, HttpAgent, ActorSubclass } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { IDL } from "@dfinity/candid";
import { CONFIG } from "./config.js";

// Candid interface
const idlFactory = ({ IDL }: { IDL: any }) => {
  const Result = IDL.Variant({ ok: IDL.Text, err: IDL.Text });
  const UnresolvedMarket = IDL.Record({
    marketId: IDL.Text,
    polymarketSlug: IDL.Text,
    polymarketConditionId: IDL.Text,
    status: IDL.Text,
  });
  return IDL.Service({
    admin_create_market: IDL.Func(
      [
        IDL.Text, // question
        IDL.Text, // eventTitle
        IDL.Text, // sport
        IDL.Text, // polymarketSlug
        IDL.Text, // polymarketConditionId
        IDL.Int,  // endDateSeconds
        IDL.Nat,  // yesPrice
        IDL.Nat,  // noPrice
      ],
      [Result],
      []
    ),
    try_resolve_market: IDL.Func(
      [IDL.Text], // marketId
      [Result],
      []
    ),
    get_unresolved_markets: IDL.Func(
      [],
      [IDL.Vec(UnresolvedMarket)],
      ["query"]
    ),
  });
};

interface UnresolvedMarket {
  marketId: string;
  polymarketSlug: string;
  polymarketConditionId: string;
  status: string;
}

interface AdminActor {
  admin_create_market(
    question: string,
    eventTitle: string,
    sport: string,
    polymarketSlug: string,
    polymarketConditionId: string,
    endDateSeconds: bigint,
    yesPrice: bigint,
    noPrice: bigint,
  ): Promise<{ ok: string } | { err: string }>;
  try_resolve_market(
    marketId: string,
  ): Promise<{ ok: string } | { err: string }>;
  get_unresolved_markets(): Promise<UnresolvedMarket[]>;
}

let cachedActor: AdminActor | null = null;

function decodePem(pemOrBase64: string): string {
  if (pemOrBase64.includes("BEGIN")) return pemOrBase64;
  return Buffer.from(pemOrBase64, "base64").toString("utf-8");
}

export async function getActor(): Promise<AdminActor> {
  if (cachedActor) return cachedActor;

  if (!CONFIG.DFX_IDENTITY_PEM) {
    throw new Error("DFX_IDENTITY_PEM not set");
  }

  const pem = decodePem(CONFIG.DFX_IDENTITY_PEM);
  const identity = Secp256k1KeyIdentity.fromPem(pem);

  console.log(`   Identity principal: ${identity.getPrincipal().toText()}`);

  const agent = await HttpAgent.create({
    host: CONFIG.IC_HOST,
    identity,
  });

  cachedActor = Actor.createActor<AdminActor>(idlFactory, {
    agent,
    canisterId: CONFIG.CANISTER_ID,
  });

  return cachedActor;
}

export async function createMarket(
  question: string,
  eventTitle: string,
  sport: string,
  slug: string,
  conditionId: string,
  endDateSeconds: number,
  yesPrice: number,
  noPrice: number,
): Promise<{ ok: boolean; message: string }> {
  const actor = await getActor();

  try {
    const result = await actor.admin_create_market(
      question,
      eventTitle,
      sport,
      slug,
      conditionId,
      BigInt(endDateSeconds),
      BigInt(yesPrice),
      BigInt(noPrice),
    );

    if ("ok" in result) {
      return { ok: true, message: result.ok };
    } else {
      return { ok: false, message: result.err };
    }
  } catch (e) {
    return { ok: false, message: String(e).slice(0, 200) };
  }
}

export async function tryResolveMarket(
  marketId: string,
): Promise<{ ok: boolean; message: string }> {
  const actor = await getActor();

  try {
    const result = await actor.try_resolve_market(marketId);
    if ("ok" in result) {
      return { ok: true, message: result.ok };
    } else {
      return { ok: false, message: result.err };
    }
  } catch (e) {
    return { ok: false, message: String(e).slice(0, 200) };
  }
}

export async function getUnresolvedMarkets(): Promise<UnresolvedMarket[]> {
  const actor = await getActor();
  return actor.get_unresolved_markets();
}
