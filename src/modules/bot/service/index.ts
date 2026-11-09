/**
 * Public service surface.
 * Other modules may import only this file, never this module's repo.
 */
export {
  BOT_SESSION_COOKIE,
  CONFIRMATION_TTL_MS,
  MAX_TOOL_ROUNDS,
  botLLM,
  confirmAction,
  continueAfterCard,
  conversationHistory,
  chatActions,
  findConfirmationConversation,
  findOwnConversation,
  handleMessage,
  openFreelanceConversation,
  openFreelanceDraftConversation,
  openJobDraftConversation,
  readFreelanceFocus,
  pendingConfirmations,
  hashSessionToken,
  rateAnswer,
  openServiceConversation,
  openUgcHomeConversation,
  openUgcThread,
  resolveConversation,
  resumeConversation,
  setBotLLMForTests,
  setFillMode,
  takeDraftOffer,
  startAtUser,
  toLLMMessages,
  type BotEvent,
  type ChatActions,
} from "./conversation";
export { jobDraftOpener } from "./job-draft-focus";
export { goalSessionFromRequest } from "./job-goal-session";
export {
  jobGoalActionInput,
  manageConversationJobGoal,
  readConversationJobGoal,
  sweepIdleJobGoals,
} from "./job-goal-control";
export { runUiAction, type UiActionResult } from "./ui-action";
export {
  allTools,
  findTool,
  never,
  registerBotTools,
  tool,
  jobCard,
  UNTRUSTED_NOTE,
  hashArgs,
  mcpTools,
  runMcpTool,
  runTool,
  toolNeedsConfirmation,
  toolsFor,
  type BotState,
  type BotTool,
  type McpFace,
  type McpOutcome,
  type McpToolDefinition,
  type ToolContext,
  type ToolOutcome,
} from "./tools";
export { setBotPorts, type BotPorts } from "../../../ports";
export { postSystemEvent } from "./system-event";
export { listOwnBotActions, sweepBotActions } from "./journal";
export { listMcpReminders, runReminderDispatch } from "./reminders";
export {
  MEMORY_MAX_CHARS,
  MEMORY_MAX_FACTS,
  clearMemory,
  editFact,
  forgetFact,
  listMemory,
  memoryError,
  rememberFact,
  type MemoryFact,
} from "./user-memory";
export { handleTelegramAgentUpdate } from "./telegram-agent";
export { offerUgcNextStep, ugcNextLine } from "./ugc-next";
export type { UgcNextLink } from "./ugc-next";
