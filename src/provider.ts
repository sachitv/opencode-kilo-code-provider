import { createOpenAICompatible, type OpenAICompatibleProviderSettings } from "@ai-sdk/openai-compatible";
import { readOpenCodeApiKeySync } from "./auth";

export const KILO_CODE_PROVIDER_ID = "kilo-code";
export const KILO_CODE_BASE_URL = "https://api.kilo.ai/api/gateway";
export const KILO_CODE_ORGANIZATION_HEADER = "X-KiloCode-OrganizationId";

type KiloCodeProviderSettings = Omit<OpenAICompatibleProviderSettings, "baseURL" | "name"> & {
  baseURL?: string;
  name?: string;
  organizationId?: string;
  kilocodeOrganizationId?: string;
};

export function createKiloCode(options: KiloCodeProviderSettings = {}) {
  const { organizationId, kilocodeOrganizationId, ...providerOptions } = options;
  const kiloOrganizationId = organizationId ?? kilocodeOrganizationId;
  const apiKey = providerOptions.apiKey ?? readOpenCodeApiKeySync(KILO_CODE_PROVIDER_ID);
  const headers = {
    ...providerOptions.headers,
    ...(kiloOrganizationId ? { [KILO_CODE_ORGANIZATION_HEADER]: kiloOrganizationId } : {}),
  };

  return createOpenAICompatible({
    ...providerOptions,
    ...(apiKey ? { apiKey } : {}),
    name: providerOptions.name ?? KILO_CODE_PROVIDER_ID,
    baseURL: providerOptions.baseURL ?? KILO_CODE_BASE_URL,
    headers,
  });
}
