import { Actor, HttpAgent, ActorSubclass } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { IDL } from "@dfinity/candid";
import { CONFIG } from "./config.js";

// Candid interface for admin_create_market
const idlFactory = ({ IDL }: { IDL: any }) => {
  const Result = IDL.Variant({ ok: IDL.Text, err: IDL.Text });
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
  });
};

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
}

let cachedActor: AdminActor | null = null;

function decodePem(pemOrBase64: string): string {
  // If it looks like a raw PEM, return as-is
  if (pemOrBase64.includes("BEGIN")) return pemOrBase64;
  // Otherwise, base64-decode it
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
