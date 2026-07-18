/**
 * Public surface for the virtual-card issuance package.
 *
 * Existing MCP code should import `requestTransactionCard` from here (or from
 * `./mcpCardTool`) after an order is approved. Do not expose a general-purpose
 * "create any card" tool to the language model.
 */
export { requestTransactionCard } from "./mcpCardTool";
export type {
  RequestTransactionCardInput,
  RequestTransactionCardResult,
} from "./mcpCardTool";

export { createTransactionCard, validateCreateInput } from "./virtualCard.service";
export { consumeCardCredentials } from "./consumeCardCredentials";

export type {
  ApprovedOrder,
  CreateTransactionCardInput,
  CreatedTransactionCard,
  TransactionCardRecord,
} from "./virtualCard.types";

export { VirtualCardError } from "./virtualCard.errors";
