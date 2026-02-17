/**
 * Kubilitics backend API client and types.
 * Use useBackendClient() when backend base URL is configured (backendConfigStore).
 */
export {
  getClusters,
  getTopology,
  getResourceTopology,
  getTopologyExportDrawio,
  getHealth,
  listResources,
  getResource,
  backendRequest,
  createBackendApiClient,
  BackendApiError,
  type BackendCluster,
  type BackendResourceListResponse,
} from './backendApiClient';

/**
 * Kubilitics AI service client.
 * Covers all kubilitics-ai HTTP endpoints and WebSocket URL builder.
 */
export {
  AI_BASE_URL,
  AI_WS_URL,
  AIServiceError,
  getAIHealth,
  getAIReadiness,
  getAIInfo,
  llmComplete,
  safetyEvaluate,
  getSafetyRules,
  getSafetyPolicies,
  getAnomalies,
  getTrends,
  getRecommendations,
  listConversations,
  getConversation,
  saveLLMProviderConfig,
  loadLLMProviderConfig,
  clearLLMProviderConfig,
  buildChatWSUrl,
  type AIMessage,
  type AITool,
  type AICompleteRequest,
  type AICompleteResponse,
  type AIServerInfo,
  type AIHealthResponse,
  type SafetyEvaluateRequest,
  type SafetyEvaluateResponse,
  type AnalyticsAnomaly,
  type AnalyticsTrend,
  type AnalyticsRecommendation,
  type Conversation,
  type ConversationMessage,
  type LLMProviderConfig,
  type WSChatContext,
} from './aiService';
