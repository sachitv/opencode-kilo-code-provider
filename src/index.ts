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
      const organizationId = options.organizationId ?? (config.provider?.[providerID]?.options as Record<string, unknown>)?.organizationId as string | undefined;
      const baseURL = options.baseURL ?? KILO_CODE_BASE_URL;
      const npm = providerEntry();

      const models = await discoverKiloCodeModels({
        ...(organizationId ? { organizationId } : {}),
        providerID,
        providerNpm: npm,
      });

      const headers = organizationId ? { [KILO_CODE_ORGANIZATION_HEADER]: organizationId } : undefined;

      config.provider[providerID] = {
        ...(config.provider[providerID] ?? {}),
        npm,
        name: "Kilo Code Gateway",
        options: {
          ...(config.provider[providerID]?.options ?? {}),
          baseURL,
          ...(organizationId ? { organizationId } : {}),
          ...(headers ? { headers } : {}),
        },
        models: Object.fromEntries(
          Object.entries(models).map(([id, m]) => [id, modelToConfigEntry(m)]),
        ),
      };

      if (options.defaultModel && !config.model) {
        config.model = `${providerID}/${options.defaultModel}`;
      }
    },
  };
};

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
    cost: {
      input: m.cost.input,
      output: m.cost.output,
      ...(m.cost.cache_read ? { cache_read: m.cost.cache_read } : {}),
      ...(m.cost.cache_write ? { cache_write: m.cost.cache_write } : {}),
    },
    limit: { context: m.limit.context, output: m.limit.output },
    modalities: { input: m.input_modalities, output: m.output_modalities },
    status: m.status,
    provider: m.provider,
    ...(m.variants ? { variants: m.variants } : {}),
  };
}

export const server = KiloCodeOpenCodeProvider;
