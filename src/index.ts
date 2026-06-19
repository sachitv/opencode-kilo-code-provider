import type { Config, Plugin } from "@opencode-ai/plugin";
import { discoverKiloCodeModels } from "./models";
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
        baseURL,
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
          Object.keys(models).map((id) => [
            id,
            {
              id,
              name: id,
              provider: { npm },
            },
          ]),
        ),
      };

      if (options.defaultModel && !config.model) {
        config.model = `${providerID}/${options.defaultModel}`;
      }
    },
  };
};

export const server = KiloCodeOpenCodeProvider;
