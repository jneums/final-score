import { CONFIG } from "./config.js";
import { createMarket } from "./agent.js";
import { setPrice } from "./priceCache.js";
const logs = [];
const MAX_LOGS = 200;
function log(action, result, message) {
    const entry = { timestamp: new Date(), action, result, message };
    logs.unshift(entry);
    if (logs.length > MAX_LOGS)
        logs.pop();
    const prefix = result === "error" ? "!" : result === "success" ? "+" : "-";
    console.log(`  ${prefix} [${action}] ${message}`);
}
export function getLogs() {
    return logs;
}
// ─── Polymarket API ────────────────────────────────────────
async function fetchJson(url) {
    const resp = await fetch(url, {
        headers: { "User-Agent": "FinalScore/2.0" },
        signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok)
        throw new Error(`HTTP ${resp.status}: ${url}`);
    return resp.json();
}
async function fetchEvents(tagId, limit = 100) {
    const all = [];
    const maxPages = 5;
    for (let page = 0; page < maxPages; page++) {
        const offset = page * limit;
        const url = `${CONFIG.GAMMA_API}/events` +
            `?tag_id=${tagId}&active=true&closed=false` +
            `&limit=${limit}&offset=${offset}`;
        const events = await fetchJson(url);
        all.push(...events);
        if (events.length < limit)
            break;
    }
    return all;
}
function parsePriceToBps(priceStr) {
    try {
        return Math.round(parseFloat(priceStr) * 10000);
    }
    catch {
        return 5000;
    }
}
function isoToUnix(isoStr) {
    if (!isoStr)
        return 0;
    try {
        return Math.floor(new Date(isoStr).getTime() / 1000);
    }
    catch {
        return 0;
    }
}
function escapeCandid(s) {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}
// ─── Prop event filters ─────────────────────────────────────
const PROP_SUFFIXES = [
    "-more-markets", "-toss", "-most-sixes", "-team-top-batter",
    "-most-fours", "-most-wickets", "-top-scorer",
];
function isPropEvent(slug) {
    return PROP_SUFFIXES.some(s => slug.endsWith(s) || slug.includes(s + "-"));
}
function isMatchDay(slug) {
    return /\d{4}-\d{2}-\d{2}/.test(slug);
}
function isMoneyline(question, isBareMatchup) {
    const q = question.toLowerCase();
    return ((q.includes("win") && (q.includes("on 20") || q.includes("in 20"))) ||
        q.includes("end in a draw") ||
        q.includes("draw?") ||
        (q.includes(" vs ") && question.includes(":") &&
            !q.includes("spread") && !q.includes("o/u") && !q.includes("moneyline")) ||
        q.includes("who wins") ||
        q.includes("completed match") ||
        isBareMatchup);
}
function isBareMatchupQuestion(question) {
    const q = question.toLowerCase();
    return ((q.includes(" vs ") || q.includes(" vs. ")) &&
        !question.includes(":") &&
        !q.includes("spread") &&
        !q.includes("o/u") &&
        !q.includes("moneyline") &&
        !q.startsWith("will ") &&
        !q.includes("draw") &&
        !q.includes("win on ") &&
        !q.includes("win in ") &&
        !q.includes("who wins"));
}
// ─── Main sync loop ─────────────────────────────────────────
export async function runSync() {
    console.log(`\n[${new Date().toISOString()}] Starting Polymarket sync...`);
    let created = 0;
    let skipped = 0;
    let errors = 0;
    for (const [sport, tag] of Object.entries(CONFIG.SPORT_TAGS).sort()) {
        if (!CONFIG.WHITELIST.includes(sport))
            continue;
        try {
            const events = await fetchEvents(tag);
            if (!events.length)
                continue;
            console.log(`  ${sport}: ${events.length} events (tag=${tag})`);
            for (const event of events) {
                const { slug, title, endDate, markets } = event;
                if (!slug || !isMatchDay(slug) || isPropEvent(slug))
                    continue;
                const endSecs = isoToUnix(endDate);
                let matchedInEvent = 0;
                for (const mkt of markets) {
                    if (matchedInEvent >= 6)
                        break;
                    const { question, conditionId, closed } = mkt;
                    if (!conditionId || closed)
                        continue;
                    const bareMatchup = isBareMatchupQuestion(question);
                    if (!isMoneyline(question, bareMatchup))
                        continue;
                    // Parse prices
                    let prices = [];
                    try {
                        const parsed = JSON.parse(mkt.outcomePrices || "[]");
                        prices = Array.isArray(parsed) ? parsed : [];
                    }
                    catch { /* skip */ }
                    const yesPrice = prices.length >= 1 ? parsePriceToBps(prices[0]) : 5000;
                    const noPrice = prices.length >= 2 ? parsePriceToBps(prices[1]) : 5000;
                    // Cache Polymarket prices for the market maker
                    setPrice(conditionId, slug, yesPrice, noPrice);
                    // Split bare matchups (US sports: "Team A vs. Team B")
                    if (bareMatchup) {
                        const teams = question.split(/\s+vs\.?\s+/, 2);
                        if (teams.length === 2) {
                            for (const [team, tp, np, suffix] of [
                                [teams[0].trim(), yesPrice, noPrice, "-a"],
                                [teams[1].trim(), noPrice, yesPrice, "-b"],
                            ]) {
                                const teamQ = `Will ${team} win?`;
                                const teamCid = conditionId + suffix;
                                // Cache per-team prices for the market maker
                                setPrice(teamCid, slug, tp, np);
                                const result = await createMarket(escapeCandid(teamQ), escapeCandid(title), sport, slug, teamCid, endSecs, tp, np);
                                if (result.ok) {
                                    created++;
                                    matchedInEvent++;
                                    log("create", "success", `${teamQ}`);
                                }
                                else if (result.message.includes("already exists")) {
                                    skipped++;
                                }
                                else {
                                    errors++;
                                    log("create", "error", `${teamQ.slice(0, 40)}: ${result.message.slice(0, 80)}`);
                                }
                            }
                            continue;
                        }
                    }
                    // Regular per-outcome markets (soccer, cricket, etc.)
                    const result = await createMarket(escapeCandid(question), escapeCandid(title), sport, slug, conditionId, endSecs, yesPrice, noPrice);
                    if (result.ok) {
                        created++;
                        matchedInEvent++;
                        log("create", "success", `${question.slice(0, 60)}`);
                    }
                    else if (result.message.includes("already exists")) {
                        skipped++;
                    }
                    else {
                        errors++;
                        log("create", "error", `${question.slice(0, 40)}: ${result.message.slice(0, 80)}`);
                    }
                }
            }
        }
        catch (e) {
            log("fetch", "error", `${sport}: ${String(e).slice(0, 100)}`);
            errors++;
        }
    }
    console.log(`\nSync complete: ${created} created, ${skipped} skipped (dup), ${errors} errors`);
    return { created, skipped, errors };
}
