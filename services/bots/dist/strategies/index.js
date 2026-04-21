import { favoriteBuyer } from "./favorite-buyer.js";
import { underdogHunter } from "./underdog-hunter.js";
import { scalper } from "./scalper.js";
import { whale } from "./whale.js";
import { hedger } from "./hedger.js";
import { pennyBidder } from "./penny-bidder.js";
import { portfolioBuilder } from "./portfolio-builder.js";
import { panicSeller } from "./panic-seller.js";
import { mcpCasualBettor } from "./mcp-casual-bettor.js";
import { mcpPortfolioViewer } from "./mcp-portfolio-viewer.js";
import { mcpFullFlow } from "./mcp-full-flow.js";
export const CANDID_STRATEGIES = [
    favoriteBuyer,
    underdogHunter,
    scalper,
    whale,
    hedger,
    pennyBidder,
    portfolioBuilder,
    panicSeller,
];
export const MCP_STRATEGIES = [
    mcpCasualBettor,
    mcpPortfolioViewer,
    mcpFullFlow,
];
export const ALL_STRATEGIES = [...CANDID_STRATEGIES, ...MCP_STRATEGIES];
