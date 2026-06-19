import { readOpenCodeApiKey } from "./auth";
import {
  KILO_CODE_DISCOVERY_BASE,
  KILO_CODE_ORGANIZATION_HEADER,
  KILO_CODE_PROVIDER_ID,
} from "./provider";

const DEFAULT_CONTEXT = 128_000;
const DEFAULT_OUTPUT = 16_384;

type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number;
  max_completion_tokens?: number | null;
  pricing?: {
    prompt?: string | null;
    completion?: string | null;
    input_cache_write?: string | null;
    input_cache_read?: string | null;
  };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
  top_provider?: { max_completion_tokens?: number | null };
  opencode?: {
    family?: string;
    variants?: Record<string, Record<string, unknown>>;
  };
};

type DiscoveryOptions = {
  apiKey?: string;
  organizationId?: string;
  providerID?: string;
  providerNpm?: string;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

function parsePrice(price: string | null | undefined): number {
  if (!price) return 0;
  const n = parseFloat(price);
  return isNaN(n) ? 0 : n * 1_000_000;
}

const FAMILY_PATTERNS = ["claude", "gpt", "gemini", "llama", "mistral", "deepseek", "kimi", "glm"];

function extractFamily(modelId: string): string {
  const name = modelId.split("/")[1] ?? "";
  return FAMILY_PATTERNS.find((p) => name.includes(p)) ?? "";
}

type Modality = "text" | "audio" | "image" | "video" | "pdf";

function parseModalities(raw: string[] | undefined): Modality[] {
  if (!raw) return ["text"];
  const valid: Modality[] = raw.filter((m): m is Modality =>
    m === "text" || m === "audio" || m === "image" || m === "video" || m === "pdf",
  );
  return valid.length === 0 ? ["text"] : valid.includes("text") ? valid : ["text", ...valid];
}

function outputLimit(item: OpenRouterModel, context: number): number {
  return item.top_provider?.max_completion_tokens ?? item.max_completion_tokens ?? (Math.ceil(context * 0.2) || DEFAULT_OUTPUT);
}

function modelCost(item: OpenRouterModel): KiloModel["cost"] {
  return {
    input: parsePrice(item.pricing?.prompt),
    output: parsePrice(item.pricing?.completion),
    cache_read: parsePrice(item.pricing?.input_cache_read),
    cache_write: parsePrice(item.pricing?.input_cache_write),
  };
}

function modelCapabilities(params: string[], inputModalities: Modality[]) {
  return {
    tool_call: params.includes("tools"),
    reasoning: params.includes("reasoning"),
    temperature: params.includes("temperature"),
    attachment: inputModalities.includes("image"),
  };
}

export type KiloModel = {
  id: string;
  name: string;
  family: string;
  cost: { input: number; output: number; cache_read: number; cache_write: number };
  limit: { context: number; output: number };
  tool_call: boolean;
  reasoning: boolean;
  temperature: boolean;
  attachment: boolean;
  input_modalities: Modality[];
  output_modalities: Modality[];
  status: "active";
  release_date: string;
  provider: { npm: string };
  variants?: Record<string, Record<string, unknown>>;
};

export function toKiloModel(item: OpenRouterModel, npm: string): KiloModel {
  const id = item.id;
  const ctx = item.context_length ?? DEFAULT_CONTEXT;
  const params = item.supported_parameters ?? [];
  const inputMods = parseModalities(item.architecture?.input_modalities);
  const capabilities = modelCapabilities(params, inputMods);

  return {
    id,
    name: item.name ?? id,
    family: item.opencode?.family ?? extractFamily(id),
    cost: modelCost(item),
    limit: { context: ctx, output: outputLimit(item, ctx) },
    ...capabilities,
    input_modalities: inputMods,
    output_modalities: parseModalities(item.architecture?.output_modalities),
    status: "active",
    release_date: "",
    provider: { npm },
    ...(item.opencode?.variants ? { variants: item.opencode.variants } : {}),
  };
}

function discoveryURL(organizationId: string | undefined): string {
  return organizationId
    ? `${KILO_CODE_DISCOVERY_BASE}/api/organizations/${organizationId}`
    : `${KILO_CODE_DISCOVERY_BASE}/api/openrouter`;
}

function discoveryHeaders(options: DiscoveryOptions, apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (options.organizationId) headers[KILO_CODE_ORGANIZATION_HEADER] = options.organizationId;
  return headers;
}

function modelsFromResponse(items: OpenRouterModel[] | undefined, npm: string): Record<string, KiloModel> {
  const models: Record<string, KiloModel> = {};
  for (const item of items ?? []) {
    if (typeof item.id !== "string" || item.id.length === 0) continue;
    models[item.id] = toKiloModel(item, npm);
  }
  return models;
}

export async function discoverKiloCodeModels(options: DiscoveryOptions = {}): Promise<Record<string, KiloModel>> {
  const npm = options.providerNpm ?? new URL("./provider.js", import.meta.url).href;
  const apiKey = options.apiKey ?? readOpenCodeApiKey(options.providerID ?? KILO_CODE_PROVIDER_ID);

  const url = `${discoveryURL(options.organizationId).replace(/\/$/, "")}/models`;
  const response = await (options.fetch ?? fetch)(url, { headers: discoveryHeaders(options, apiKey) });
  if (!response.ok) return {};

  const body = (await response.json()) as { data?: OpenRouterModel[] };
  return modelsFromResponse(body.data, npm);
}
