import type { Config, Plugin } from "@opencode-ai/plugin";
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
        models: modelsToConfig(models),
      };

      applyDefaultModel(config, providerID, options.defaultModel);
    },
  };
};

export const server = KiloCodeOpenCodeProvider;
