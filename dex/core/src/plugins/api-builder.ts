import type { DexConfig } from "../config/types.openclaw.js";
import { attachPluginApiFacades, type DexPluginApiWithoutFacades } from "./api-facades.js";
import type { PluginRuntime } from "./runtime/types.js";
import type { DexPluginApi, PluginLogger } from "./types.js";

export type BuildPluginApiParams = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  rootDir?: string;
  registrationMode: DexPluginApi["registrationMode"];
  config: DexConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;
  resolvePath: (input: string) => string;
  handlers?: Partial<
    Pick<
      DexPluginApi,
      | "registerTool"
      | "registerHook"
      | "registerHttpRoute"
      | "registerHostedMediaResolver"
      | "registerChannel"
      | "registerGatewayMethod"
      | "registerCli"
      | "registerReload"
      | "registerNodeHostCommand"
      | "registerNodeInvokePolicy"
      | "registerSecurityAuditCollector"
      | "registerService"
      | "registerGatewayDiscoveryService"
      | "registerCliBackend"
      | "registerTextTransforms"
      | "registerConfigMigration"
      | "registerMigrationProvider"
      | "registerAutoEnableProbe"
      | "registerProvider"
      | "registerModelCatalogProvider"
      | "registerEmbeddingProvider"
      | "registerSpeechProvider"
      | "registerRealtimeTranscriptionProvider"
      | "registerRealtimeVoiceProvider"
      | "registerMediaUnderstandingProvider"
      | "registerTranscriptSourceProvider"
      | "registerImageGenerationProvider"
      | "registerVideoGenerationProvider"
      | "registerMusicGenerationProvider"
      | "registerWebFetchProvider"
      | "registerWebSearchProvider"
      | "registerInteractiveHandler"
      | "onConversationBindingResolved"
      | "registerCommand"
      | "registerContextEngine"
      | "registerCompactionProvider"
      | "registerAgentHarness"
      | "registerCodexAppServerExtensionFactory"
      | "registerAgentToolResultMiddleware"
      | "registerSessionExtension"
      | "enqueueNextTurnInjection"
      | "registerTrustedToolPolicy"
      | "registerToolMetadata"
      | "registerControlUiDescriptor"
      | "registerRuntimeLifecycle"
      | "registerAgentEventSubscription"
      | "emitAgentEvent"
      | "setRunContext"
      | "getRunContext"
      | "clearRunContext"
      | "registerSessionSchedulerJob"
      | "registerSessionAction"
      | "sendSessionAttachment"
      | "scheduleSessionTurn"
      | "unscheduleSessionTurnsByTag"
      | "registerDetachedTaskRuntime"
      | "registerMemoryCapability"
      | "registerMemoryPromptSection"
      | "registerMemoryPromptSupplement"
      | "registerMemoryCorpusSupplement"
      | "registerMemoryFlushPlan"
      | "registerMemoryRuntime"
      | "registerMemoryEmbeddingProvider"
      | "on"
    >
  >;
};

const noopRegisterTool: DexPluginApi["registerTool"] = () => {};
const noopRegisterHook: DexPluginApi["registerHook"] = () => {};
const noopRegisterHttpRoute: DexPluginApi["registerHttpRoute"] = () => {};
const noopRegisterHostedMediaResolver: DexPluginApi["registerHostedMediaResolver"] = () => {};
const noopRegisterChannel: DexPluginApi["registerChannel"] = () => {};
const noopRegisterGatewayMethod: DexPluginApi["registerGatewayMethod"] = () => {};
const noopRegisterCli: DexPluginApi["registerCli"] = () => {};
const noopRegisterReload: DexPluginApi["registerReload"] = () => {};
const noopRegisterNodeHostCommand: DexPluginApi["registerNodeHostCommand"] = () => {};
const noopRegisterNodeInvokePolicy: DexPluginApi["registerNodeInvokePolicy"] = () => {};
const noopRegisterSecurityAuditCollector: DexPluginApi["registerSecurityAuditCollector"] =
  () => {};
const noopRegisterService: DexPluginApi["registerService"] = () => {};
const noopRegisterGatewayDiscoveryService: DexPluginApi["registerGatewayDiscoveryService"] =
  () => {};
const noopRegisterCliBackend: DexPluginApi["registerCliBackend"] = () => {};
const noopRegisterTextTransforms: DexPluginApi["registerTextTransforms"] = () => {};
const noopRegisterConfigMigration: DexPluginApi["registerConfigMigration"] = () => {};
const noopRegisterMigrationProvider: DexPluginApi["registerMigrationProvider"] = () => {};
const noopRegisterAutoEnableProbe: DexPluginApi["registerAutoEnableProbe"] = () => {};
const noopRegisterProvider: DexPluginApi["registerProvider"] = () => {};
const noopRegisterModelCatalogProvider: DexPluginApi["registerModelCatalogProvider"] =
  () => {};
const noopRegisterEmbeddingProvider: DexPluginApi["registerEmbeddingProvider"] = () => {};
const noopRegisterSpeechProvider: DexPluginApi["registerSpeechProvider"] = () => {};
const noopRegisterRealtimeTranscriptionProvider: DexPluginApi["registerRealtimeTranscriptionProvider"] =
  () => {};
const noopRegisterRealtimeVoiceProvider: DexPluginApi["registerRealtimeVoiceProvider"] =
  () => {};
const noopRegisterMediaUnderstandingProvider: DexPluginApi["registerMediaUnderstandingProvider"] =
  () => {};
const noopRegisterTranscriptsSourceProvider: DexPluginApi["registerTranscriptSourceProvider"] =
  () => {};
const noopRegisterImageGenerationProvider: DexPluginApi["registerImageGenerationProvider"] =
  () => {};
const noopRegisterVideoGenerationProvider: DexPluginApi["registerVideoGenerationProvider"] =
  () => {};
const noopRegisterMusicGenerationProvider: DexPluginApi["registerMusicGenerationProvider"] =
  () => {};
const noopRegisterWebFetchProvider: DexPluginApi["registerWebFetchProvider"] = () => {};
const noopRegisterWebSearchProvider: DexPluginApi["registerWebSearchProvider"] = () => {};
const noopRegisterInteractiveHandler: DexPluginApi["registerInteractiveHandler"] = () => {};
const noopOnConversationBindingResolved: DexPluginApi["onConversationBindingResolved"] =
  () => {};
const noopRegisterCommand: DexPluginApi["registerCommand"] = () => {};
const noopRegisterContextEngine: DexPluginApi["registerContextEngine"] = () => {};
const noopRegisterCompactionProvider: DexPluginApi["registerCompactionProvider"] = () => {};
const noopRegisterAgentHarness: DexPluginApi["registerAgentHarness"] = () => {};
const noopRegisterCodexAppServerExtensionFactory: DexPluginApi["registerCodexAppServerExtensionFactory"] =
  () => {};
const noopRegisterAgentToolResultMiddleware: DexPluginApi["registerAgentToolResultMiddleware"] =
  () => {};
const noopRegisterSessionExtension: DexPluginApi["registerSessionExtension"] = () => {};
const noopEnqueueNextTurnInjection: DexPluginApi["enqueueNextTurnInjection"] = async (
  injection,
) => ({ enqueued: false, id: "", sessionKey: injection.sessionKey });
const noopRegisterTrustedToolPolicy: DexPluginApi["registerTrustedToolPolicy"] = () => {};
const noopRegisterToolMetadata: DexPluginApi["registerToolMetadata"] = () => {};
const noopRegisterControlUiDescriptor: DexPluginApi["registerControlUiDescriptor"] = () => {};
const noopRegisterRuntimeLifecycle: DexPluginApi["registerRuntimeLifecycle"] = () => {};
const noopRegisterAgentEventSubscription: DexPluginApi["registerAgentEventSubscription"] =
  () => {};
const noopEmitAgentEvent: DexPluginApi["emitAgentEvent"] = () => ({
  emitted: false,
  reason: "not wired",
});
const noopSetRunContext: DexPluginApi["setRunContext"] = () => false;
const noopGetRunContext: DexPluginApi["getRunContext"] = () => undefined;
const noopClearRunContext: DexPluginApi["clearRunContext"] = () => {};
const noopRegisterSessionSchedulerJob: DexPluginApi["registerSessionSchedulerJob"] = () =>
  undefined;
const noopRegisterSessionAction: DexPluginApi["registerSessionAction"] = () => {};
const noopSendSessionAttachment: DexPluginApi["sendSessionAttachment"] = async () => ({
  ok: false,
  error: "not wired",
});
const noopScheduleSessionTurn: DexPluginApi["scheduleSessionTurn"] = async () => undefined;
const noopUnscheduleSessionTurnsByTag: DexPluginApi["unscheduleSessionTurnsByTag"] =
  async () => ({ removed: 0, failed: 0 });
const noopRegisterDetachedTaskRuntime: DexPluginApi["registerDetachedTaskRuntime"] = () => {};
const noopRegisterMemoryCapability: DexPluginApi["registerMemoryCapability"] = () => {};
const noopRegisterMemoryPromptSection: DexPluginApi["registerMemoryPromptSection"] = () => {};
const noopRegisterMemoryPromptSupplement: DexPluginApi["registerMemoryPromptSupplement"] =
  () => {};
const noopRegisterMemoryCorpusSupplement: DexPluginApi["registerMemoryCorpusSupplement"] =
  () => {};
const noopRegisterMemoryFlushPlan: DexPluginApi["registerMemoryFlushPlan"] = () => {};
const noopRegisterMemoryRuntime: DexPluginApi["registerMemoryRuntime"] = () => {};
const noopRegisterMemoryEmbeddingProvider: DexPluginApi["registerMemoryEmbeddingProvider"] =
  () => {};
const noopOn: DexPluginApi["on"] = () => {};

export function buildPluginApi(params: BuildPluginApiParams): DexPluginApi {
  const handlers = params.handlers ?? {};
  const registerCli = handlers.registerCli ?? noopRegisterCli;
  const api: DexPluginApiWithoutFacades = {
    id: params.id,
    name: params.name,
    version: params.version,
    description: params.description,
    source: params.source,
    rootDir: params.rootDir,
    registrationMode: params.registrationMode,
    config: params.config,
    pluginConfig: params.pluginConfig,
    runtime: params.runtime,
    logger: params.logger,
    registerTool: handlers.registerTool ?? noopRegisterTool,
    registerHook: handlers.registerHook ?? noopRegisterHook,
    registerHttpRoute: handlers.registerHttpRoute ?? noopRegisterHttpRoute,
    registerHostedMediaResolver:
      handlers.registerHostedMediaResolver ?? noopRegisterHostedMediaResolver,
    registerChannel: handlers.registerChannel ?? noopRegisterChannel,
    registerGatewayMethod: handlers.registerGatewayMethod ?? noopRegisterGatewayMethod,
    registerCli,
    registerNodeCliFeature: (registrar, opts) =>
      registerCli(registrar, {
        ...opts,
        parentPath: ["nodes"],
      }),
    registerReload: handlers.registerReload ?? noopRegisterReload,
    registerNodeHostCommand: handlers.registerNodeHostCommand ?? noopRegisterNodeHostCommand,
    registerNodeInvokePolicy: handlers.registerNodeInvokePolicy ?? noopRegisterNodeInvokePolicy,
    registerSecurityAuditCollector:
      handlers.registerSecurityAuditCollector ?? noopRegisterSecurityAuditCollector,
    registerService: handlers.registerService ?? noopRegisterService,
    registerGatewayDiscoveryService:
      handlers.registerGatewayDiscoveryService ?? noopRegisterGatewayDiscoveryService,
    registerCliBackend: handlers.registerCliBackend ?? noopRegisterCliBackend,
    registerTextTransforms: handlers.registerTextTransforms ?? noopRegisterTextTransforms,
    registerConfigMigration: handlers.registerConfigMigration ?? noopRegisterConfigMigration,
    registerMigrationProvider: handlers.registerMigrationProvider ?? noopRegisterMigrationProvider,
    registerAutoEnableProbe: handlers.registerAutoEnableProbe ?? noopRegisterAutoEnableProbe,
    registerProvider: handlers.registerProvider ?? noopRegisterProvider,
    registerModelCatalogProvider:
      handlers.registerModelCatalogProvider ?? noopRegisterModelCatalogProvider,
    registerEmbeddingProvider: handlers.registerEmbeddingProvider ?? noopRegisterEmbeddingProvider,
    registerSpeechProvider: handlers.registerSpeechProvider ?? noopRegisterSpeechProvider,
    registerRealtimeTranscriptionProvider:
      handlers.registerRealtimeTranscriptionProvider ?? noopRegisterRealtimeTranscriptionProvider,
    registerRealtimeVoiceProvider:
      handlers.registerRealtimeVoiceProvider ?? noopRegisterRealtimeVoiceProvider,
    registerMediaUnderstandingProvider:
      handlers.registerMediaUnderstandingProvider ?? noopRegisterMediaUnderstandingProvider,
    registerTranscriptSourceProvider:
      handlers.registerTranscriptSourceProvider ?? noopRegisterTranscriptsSourceProvider,
    registerImageGenerationProvider:
      handlers.registerImageGenerationProvider ?? noopRegisterImageGenerationProvider,
    registerVideoGenerationProvider:
      handlers.registerVideoGenerationProvider ?? noopRegisterVideoGenerationProvider,
    registerMusicGenerationProvider:
      handlers.registerMusicGenerationProvider ?? noopRegisterMusicGenerationProvider,
    registerWebFetchProvider: handlers.registerWebFetchProvider ?? noopRegisterWebFetchProvider,
    registerWebSearchProvider: handlers.registerWebSearchProvider ?? noopRegisterWebSearchProvider,
    registerInteractiveHandler:
      handlers.registerInteractiveHandler ?? noopRegisterInteractiveHandler,
    onConversationBindingResolved:
      handlers.onConversationBindingResolved ?? noopOnConversationBindingResolved,
    registerCommand: handlers.registerCommand ?? noopRegisterCommand,
    registerContextEngine: handlers.registerContextEngine ?? noopRegisterContextEngine,
    registerCompactionProvider:
      handlers.registerCompactionProvider ?? noopRegisterCompactionProvider,
    registerAgentHarness: handlers.registerAgentHarness ?? noopRegisterAgentHarness,
    registerCodexAppServerExtensionFactory:
      handlers.registerCodexAppServerExtensionFactory ?? noopRegisterCodexAppServerExtensionFactory,
    registerAgentToolResultMiddleware:
      handlers.registerAgentToolResultMiddleware ?? noopRegisterAgentToolResultMiddleware,
    registerSessionExtension: handlers.registerSessionExtension ?? noopRegisterSessionExtension,
    enqueueNextTurnInjection: handlers.enqueueNextTurnInjection ?? noopEnqueueNextTurnInjection,
    registerTrustedToolPolicy: handlers.registerTrustedToolPolicy ?? noopRegisterTrustedToolPolicy,
    registerToolMetadata: handlers.registerToolMetadata ?? noopRegisterToolMetadata,
    registerControlUiDescriptor:
      handlers.registerControlUiDescriptor ?? noopRegisterControlUiDescriptor,
    registerRuntimeLifecycle: handlers.registerRuntimeLifecycle ?? noopRegisterRuntimeLifecycle,
    registerAgentEventSubscription:
      handlers.registerAgentEventSubscription ?? noopRegisterAgentEventSubscription,
    emitAgentEvent: handlers.emitAgentEvent ?? noopEmitAgentEvent,
    setRunContext: handlers.setRunContext ?? noopSetRunContext,
    getRunContext: handlers.getRunContext ?? noopGetRunContext,
    clearRunContext: handlers.clearRunContext ?? noopClearRunContext,
    registerSessionSchedulerJob:
      handlers.registerSessionSchedulerJob ?? noopRegisterSessionSchedulerJob,
    registerSessionAction: handlers.registerSessionAction ?? noopRegisterSessionAction,
    sendSessionAttachment: handlers.sendSessionAttachment ?? noopSendSessionAttachment,
    scheduleSessionTurn: handlers.scheduleSessionTurn ?? noopScheduleSessionTurn,
    unscheduleSessionTurnsByTag:
      handlers.unscheduleSessionTurnsByTag ?? noopUnscheduleSessionTurnsByTag,
    registerDetachedTaskRuntime:
      handlers.registerDetachedTaskRuntime ?? noopRegisterDetachedTaskRuntime,
    registerMemoryCapability: handlers.registerMemoryCapability ?? noopRegisterMemoryCapability,
    registerMemoryPromptSection:
      handlers.registerMemoryPromptSection ?? noopRegisterMemoryPromptSection,
    registerMemoryPromptSupplement:
      handlers.registerMemoryPromptSupplement ?? noopRegisterMemoryPromptSupplement,
    registerMemoryCorpusSupplement:
      handlers.registerMemoryCorpusSupplement ?? noopRegisterMemoryCorpusSupplement,
    registerMemoryFlushPlan: handlers.registerMemoryFlushPlan ?? noopRegisterMemoryFlushPlan,
    registerMemoryRuntime: handlers.registerMemoryRuntime ?? noopRegisterMemoryRuntime,
    registerMemoryEmbeddingProvider:
      handlers.registerMemoryEmbeddingProvider ?? noopRegisterMemoryEmbeddingProvider,
    resolvePath: params.resolvePath,
    on: handlers.on ?? noopOn,
  };
  return attachPluginApiFacades(api);
}
