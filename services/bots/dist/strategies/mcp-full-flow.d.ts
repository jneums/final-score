import { Strategy } from "../strategy.js";
/**
 * MCP Full Flow — exercises the complete order lifecycle via MCP:
 * list markets → get detail → place order at book price → verify → cancel → check positions → check account.
 */
export declare const mcpFullFlow: Strategy;
