import { createOpenAICompatible, type OpenAICompatibleProviderSettings } from "@ai-sdk/openai-compatible";
import { readOpenCodeApiKey } from "./auth";

export const KILO_CODE_PROVIDER_ID = "kilo-code";
export const KILO_CODE_BASE_URL = "https://api.kilo.ai/api/gateway";
export const KILO_CODE_DISCOVERY_BASE = "https://api.kilo.ai";
export const KILO_CODE_ORGANIZATION_HEADER = "X-KiloCode-OrganizationId";

type KiloCodeProviderSettings = Omit<OpenAICompatibleProviderSettings, "baseURL" | "name"> & {
  baseURL?: string;
  name?: string;
  organizationId?: string;
};

export function createKiloCode(options: KiloCodeProviderSettings = {}) {
  const { organizationId, ...providerOptions } = options;
  const apiKey = providerOptions.apiKey ?? readOpenCodeApiKey(KILO_CODE_PROVIDER_ID);
  const headers = {
    ...providerOptions.headers,
    ...(organizationId ? { [KILO_CODE_ORGANIZATION_HEADER]: organizationId } : {}),
  };

  return createOpenAICompatible({
    ...providerOptions,
    ...(apiKey ? { apiKey } : {}),
    name: providerOptions.name ?? KILO_CODE_PROVIDER_ID,
    baseURL: providerOptions.baseURL ?? KILO_CODE_BASE_URL,
    headers,
  });
}
