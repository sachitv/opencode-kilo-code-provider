import type { Config, Plugin } from "@opencode-ai/plugin";
import { Model, Plugin as V2Plugin, Provider } from "@opencode/plugin";
import type { Context as V2Context } from "@opencode/plugin/promise/plugin";
import { readOpenCodeApiKey } from "./auth";
import { discoverKiloCodeModels, type KiloModel } from "./models";
import {
  KILO_CODE_BASE_URL,
  KILO_CODE_ORGANIZATION_HEADER,
  KILO_CODE_PROVIDER_ID,
} from "./provider";

export { createKiloCode } from "./provider";
export { discoverKiloCodeModels, toKiloModel, type KiloModel } from "./models";

type PluginOptions = {
  organizationId?: string;
  providerID?: string;
  baseURL?: string;
  defaultModel?: string;
};

const KILO_DEFAULT_MODEL = "kilo-auto/free";

function providerEntry() {
  return new URL("./provider.js", import.meta.url).href;
}

function resolveOrgId(options: PluginOptions, config: Config, providerID: string): string | undefined {
  if (options.organizationId) return options.organizationId;
  const opts = config.provider?.[providerID]?.options as Record<string, unknown> | undefined;
  const v = opts?.organizationId;
  return typeof v === "string" ? v : undefined;
}

function modelToConfigEntry(m: KiloModel) {
  return {
    id: m.id,
    name: m.name,
    family: m.family,
    release_date: m.release_date,
    attachment: m.attachment,
    reasoning: m.reasoning,
    temperature: m.temperature,
    tool_call: m.tool_call,
    cost: m.cost,
    limit: m.limit,
    modalities: { input: m.input_modalities, output: m.output_modalities },
    status: m.status,
    provider: m.provider,
    ...(m.variants ? { variants: m.variants } : {}),
  };
}

function providerOptions(config: Config, providerID: string, organizationId: string | undefined, baseURL: string) {
  const existing = config.provider?.[providerID]?.options ?? {};
  const headers = organizationId ? { [KILO_CODE_ORGANIZATION_HEADER]: organizationId } : undefined;

  return {
    ...existing,
    baseURL,
    ...(organizationId ? { organizationId } : {}),
    ...(headers ? { headers } : {}),
  };
}

function modelsToConfig(models: Record<string, KiloModel>) {
  return Object.fromEntries(
    Object.entries(models).map(([id, m]) => [id, modelToConfigEntry(m)]),
  );
}

function ensureDefaultModel(
  models: Record<string, KiloModel>,
  defaultModel: string | undefined,
  npm: string,
): Record<string, KiloModel> {
  if (!defaultModel || models[defaultModel]) return models;

  return {
    ...models,
    [defaultModel]: {
      id: defaultModel,
      name: defaultModel,
      family: "",
      cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      limit: { context: 128_000, output: 16_384 },
      tool_call: true,
      reasoning: false,
      temperature: true,
      attachment: false,
      input_modalities: ["text"],
      output_modalities: ["text"],
      status: "active",
      release_date: "",
      provider: { npm },
    },
  };
}

function modelToV2Info(m: KiloModel, providerID: string) {
  const model = Model.Info.default(Provider.ID.make(providerID), Model.ID.make(m.id));
  Object.assign(model, {
    name: m.name,
    family: m.family,
    status: m.status,
    enabled: true,
    cost: [{
      input: m.cost.input,
      output: m.cost.output,
      cache: { read: m.cost.cache_read, write: m.cost.cache_write },
    }],
    limit: { context: m.limit.context, output: m.limit.output },
    capabilities: {
      tools: m.tool_call,
      input: m.input_modalities,
      output: m.output_modalities,
    },
    variants: Object.entries(m.variants ?? {}).map(([id, settings]) => ({ id, settings })),
  });
  return model;
}

function applyDefaultModel(config: Config, providerID: string, defaultModel: string | undefined): void {
  if (defaultModel && !config.model) {
    config.model = `${providerID}/${defaultModel}`;
  }
}

export const KiloCodeOpenCodeProvider: Plugin = async (_ctx, rawOptions = {}) => {
  const options = rawOptions as PluginOptions;
  const providerID = options.providerID ?? KILO_CODE_PROVIDER_ID;

  return {
    auth: {
      provider: providerID,
      methods: [{ type: "api", label: "Kilo Gateway API key" }],
    },
    config: async (config) => {
      config.provider ??= {};
      const organizationId = resolveOrgId(options, config, providerID);
      const baseURL = options.baseURL ?? KILO_CODE_BASE_URL;
      const npm = providerEntry();
      const defaultModel = options.defaultModel ?? KILO_DEFAULT_MODEL;

      const models = await discoverKiloCodeModels({
        ...(organizationId ? { organizationId } : {}),
        providerID,
        providerNpm: npm,
      });

      config.provider[providerID] = {
        ...(config.provider[providerID] ?? {}),
        npm,
        name: "Kilo Code Gateway",
        options: providerOptions(config, providerID, organizationId, baseURL),
        models: modelsToConfig(ensureDefaultModel(models, defaultModel, npm)),
      };

      applyDefaultModel(config, providerID, defaultModel);
    },
  };
};

type V2Connection = NonNullable<Awaited<ReturnType<V2Context["integration"]["connection"]["active"]>>>;

async function v2Auth(
  ctx: V2Context,
  providerID: string,
): Promise<{ apiKey?: string; sourceConnection?: V2Connection }> {
  let sourceConnection: V2Connection | undefined;
  try {
    sourceConnection = await ctx.integration.connection.active(providerID);
  } catch {
    return {};
  }

  if (!sourceConnection) {
    const apiKey = readOpenCodeApiKey(providerID);
    return apiKey ? { apiKey } : {};
  }

  try {
    const credential = await ctx.integration.connection.resolve(sourceConnection);
    const apiKey = credential?.type === "key"
      ? credential.key
      : credential?.type === "oauth"
        ? credential.access
        : undefined;
    return { ...(apiKey ? { apiKey } : {}), sourceConnection };
  } catch {
    // A failed resolve must not revive a stale legacy key. Retain the connection
    // association so OpenCode can replace this account-specific registration.
    return { sourceConnection };
  }
}

async function setupV2(ctx: V2Context): Promise<() => void> {
  const options = ctx.options as PluginOptions;
  const providerID = options.providerID ?? KILO_CODE_PROVIDER_ID;
  const organizationId = options.organizationId;
  const baseURL = options.baseURL ?? KILO_CODE_BASE_URL;
  const defaultModel = options.defaultModel ?? KILO_DEFAULT_MODEL;

  await ctx.integration.transform((editor) => {
    editor.update(providerID, (integration) => {
      integration.name = "Kilo Code Gateway";
    });
    editor.method.update({
      integrationID: providerID,
      method: { type: "key", label: "Kilo Gateway API key" },
    });
  });

  const npm = providerEntry();
  const controller = new AbortController();
  type Auth = Awaited<ReturnType<typeof v2Auth>>;
  const sameAuth = (a: Auth | undefined, b: Auth) => a !== undefined &&
    a.apiKey === b.apiKey && JSON.stringify(a.sourceConnection) === JSON.stringify(b.sourceConnection);
  const toInventory = (auth: Auth, models: Record<string, KiloModel>) => ({
    models: Object.values(ensureDefaultModel(models, defaultModel, npm))
      .map((model) => modelToV2Info(model, providerID)),
    ...(auth.sourceConnection ? { sourceConnection: auth.sourceConnection } : {}),
  });
  const loadInventory = async (auth: Auth, signal: AbortSignal) => {
    const discoveredModels = await discoverKiloCodeModels({
      ...(organizationId ? { organizationId } : {}),
      apiKey: auth.apiKey,
      providerID,
      providerNpm: npm,
      fetch: async (input, init) => {
        const response = await fetch(input, {
          ...init,
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        });
        if (!response.ok) throw new Error("Kilo model discovery failed");
        return response;
      },
    });
    return toInventory(auth, discoveredModels);
  };

  let inventory: Awaited<ReturnType<typeof loadInventory>>;
  let completedAuth: Auth | undefined;
  let pendingAuth: Auth | undefined;
  let request: AbortController | undefined;
  let generation = 0;
  let authCheck = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 1_000;
  let ready!: () => void;
  const initialized = new Promise<void>((resolve) => { ready = resolve; });
  const clearRetry = () => { clearTimeout(retry); retry = undefined; };
  const scheduleRetry = () => {
    clearRetry();
    if (controller.signal.aborted) return;
    retry = setTimeout(() => { void refresh(true); }, retryDelay);
    retry.unref();
    retryDelay = Math.min(retryDelay * 2, 30_000);
  };
  const refresh = async (force = false) => {
    const check = ++authCheck;
    await initialized;
    if (controller.signal.aborted) return;
    const auth = await v2Auth(ctx, providerID);
    if (controller.signal.aborted || check !== authCheck) return;
    // Empty-payload updates may concern another integration. Compare both
    // connection identity and the resolved key to retain credential rotation.
    if (!force && sameAuth(pendingAuth ?? completedAuth, auth)) return;
    request?.abort();
    clearRetry();
    const current = ++generation;
    request = new AbortController();
    const signal = AbortSignal.any([controller.signal, request.signal]);
    pendingAuth = auth;
    try {
      const refreshed = await loadInventory(auth, signal);
      if (signal.aborted || current !== generation) return;
      inventory = refreshed;
      await ctx.provider.reload();
      if (signal.aborted || current !== generation) return;
      completedAuth = auth;
      retryDelay = 1_000;
    } catch {
      if (signal.aborted || current !== generation) return;
      // Never retain an old account's catalog after a failed switch. Publish
      // the configured default for this account while retrying its discovery.
      completedAuth = undefined;
      inventory = toInventory(auth, {});
      try { await ctx.provider.reload(); } catch { /* Retry publication too. */ }
      if (signal.aborted || current !== generation) return;
      console.error("kilo-code: failed to refresh model inventory; retrying");
      scheduleRetry();
    } finally {
      if (current === generation) pendingAuth = undefined;
    }
  };
  const cleanup = () => {
    controller.abort();
    request?.abort();
    clearRetry();
    ready();
  };
  // Read events independently of discovery so a stalled request cannot block
  // the next account switch. Generation checks discard superseded results.
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type !== "credential.updated" && event.type !== "integration.updated" &&
          event.type !== "server.connected" &&
          !(event.type === "credential.switched" && event.data.integrationID === providerID)) continue;
        void refresh();
      }
    } catch {
      if (!controller.signal.aborted) console.error("kilo-code: model inventory event subscription failed");
    }
  })();

  try {
    const auth = await v2Auth(ctx, providerID);
    let discoveryFailed = false;
    try {
      inventory = await loadInventory(auth, controller.signal);
      completedAuth = auth;
    } catch {
      inventory = toInventory(auth, {});
      discoveryFailed = true;
    }

    await ctx.provider.transform((editor) => {
      const emptyProvider = Provider.Info.empty(Provider.ID.make(providerID));
      const info = {
        ...emptyProvider,
        name: "Kilo Code Gateway",
        activation: "enabled" as const,
        package: `aisdk:${providerEntry()}`,
        integrationID: providerID as unknown as typeof emptyProvider.integrationID,
        settings: { ...emptyProvider.settings, baseURL },
        headers: {
          ...emptyProvider.headers,
          ...(organizationId ? { [KILO_CODE_ORGANIZATION_HEADER]: organizationId } : {}),
        },
      };
      editor.add({
        info,
        ...inventory,
      });
    });

    await ctx.model.transform((editor) => {
      if (!editor.default.get()) editor.default.set(providerID, defaultModel);
    });
    ready();
    if (discoveryFailed && (auth.sourceConnection || auth.apiKey)) scheduleRetry();
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}

export const server = KiloCodeOpenCodeProvider;

const v2Plugin: V2Plugin.Plugin = {
  id: "kilo-code",
  setup: setupV2,
};

// V1 calls server(); V2 reads id/setup and ignores the legacy member.
export default { ...V2Plugin.define(v2Plugin), server: KiloCodeOpenCodeProvider };
