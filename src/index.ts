import type { Config, Plugin } from "@opencode-ai/plugin";
import { discoverKiloCodeModels, type Model } from "./models";
import {
  KILO_CODE_BASE_URL,
  KILO_CODE_ORGANIZATION_HEADER,
  KILO_CODE_PROVIDER_ID,
} from "./provider";

export { createKiloCode } from "./provider";
export { discoverKiloCodeModels } from "./models";

type KiloCodePluginOptions = {
  organizationId?: string;
  kilocodeOrganizationId?: string;
  providerID?: string;
  baseURL?: string;
  defaultModel?: string;
};

function providerEntry() {
  return new URL("./provider.js", import.meta.url).href;
}

function getOrganizationId(options: KiloCodePluginOptions, config: Config, providerID: string) {
  const provider = config.provider?.[providerID];
  const providerOptions = provider?.options ?? {};
  return (
    options.organizationId ??
    options.kilocodeOrganizationId ??
    (typeof providerOptions.organizationId === "string" ? providerOptions.organizationId : undefined) ??
    (typeof providerOptions.kilocodeOrganizationId === "string" ? providerOptions.kilocodeOrganizationId : undefined)
  );
}

function modalityArray(modalities: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }): Array<"text" | "audio" | "image" | "video" | "pdf"> {
  const result: Array<"text" | "audio" | "image" | "video" | "pdf"> = [];
  if (modalities.text) result.push("text");
  if (modalities.audio) result.push("audio");
  if (modalities.image) result.push("image");
  if (modalities.video) result.push("video");
  if (modalities.pdf) result.push("pdf");
  return result;
}

const DEFAULT_OUTPUT = 16384;

function modelToConfigEntry(model: Model, npm: string) {
  return {
    id: model.id,
    name: model.name,
    ...(model.family ? { family: model.family } : {}),
    release_date: model.release_date,
    attachment: model.capabilities.attachment,
    reasoning: model.capabilities.reasoning,
    temperature: model.capabilities.temperature,
    tool_call: model.capabilities.toolcall,
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      ...(model.cost.cache.read ? { cache_read: model.cost.cache.read } : {}),
      ...(model.cost.cache.write ? { cache_write: model.cost.cache.write } : {}),
    },
    limit: {
      context: model.limit.context,
      output: model.limit.output ?? DEFAULT_OUTPUT,
    },
    modalities: {
      input: modalityArray(model.capabilities.input),
      output: modalityArray(model.capabilities.output),
    },
    status: model.status,
    provider: { npm },
  };
}

export const KiloCodeOpenCodeProvider: Plugin = async (_ctx, rawOptions = {}) => {
  const options = rawOptions as KiloCodePluginOptions;
  const providerID = options.providerID ?? KILO_CODE_PROVIDER_ID;

  return {
    auth: {
      provider: providerID,
      loader: async (auth) => {
        const value = await auth();
        if (!value) return {};
        if (value.type === "api") return { apiKey: value.key };
        if (value.type === "oauth") return { apiKey: value.access };
        return {};
      },
      methods: [
        {
          type: "api",
          label: "Kilo Gateway API key",
        },
      ],
    },
    config: async (config) => {
      config.provider ??= {};
      const organizationId = getOrganizationId(options, config, providerID);
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
          Object.entries(models).map(([id, model]) => [id, modelToConfigEntry(model, npm)]),
        ),
      };

      if (options.defaultModel && !config.model) {
        config.model = `${providerID}/${options.defaultModel}`;
      }
    },
  };
};

export const server = KiloCodeOpenCodeProvider;
