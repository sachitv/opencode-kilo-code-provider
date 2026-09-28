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

async function v2ApiKey(ctx: V2Context, providerID: string): Promise<string | undefined> {
  const credential = await ctx.integration.connection
    .active(providerID)
    .then((connection) => (connection ? ctx.integration.connection.resolve(connection) : null))
    .catch(() => undefined);

  // null means V2 confirmed no connection; a failed or empty resolve must not revive a stale legacy key.
  if (credential === null) return readOpenCodeApiKey(providerID);
  if (credential?.type === "key") return credential.key;
  if (credential?.type === "oauth") return credential.access;
  return undefined;
}

async function setupV2(ctx: V2Context): Promise<void> {
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

  const apiKey = await v2ApiKey(ctx, providerID);
  const npm = providerEntry();
  const discoveredModels = await discoverKiloCodeModels({
    ...(organizationId ? { organizationId } : {}),
    apiKey,
    providerID,
    providerNpm: npm,
  });
  // V2 setup runs before a user can add a key through /connect. Keep the
  // configured default selectable even when an org-scoped catalog is 401.
  const models = ensureDefaultModel(discoveredModels, defaultModel, npm);

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
      models: Object.values(models).map((model) => modelToV2Info(model, providerID)),
    });
  });

  await ctx.model.transform((editor) => {
    if (!editor.default.get()) editor.default.set(providerID, defaultModel);
  });
}

export const server = KiloCodeOpenCodeProvider;

const v2Plugin: V2Plugin.Plugin = {
  id: "kilo-code",
  setup: setupV2,
};

// V1 calls server(); V2 reads id/setup and ignores the legacy member.
export default { ...V2Plugin.define(v2Plugin), server: KiloCodeOpenCodeProvider };
