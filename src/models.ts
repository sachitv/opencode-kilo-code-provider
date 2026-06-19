import { readFile } from "node:fs/promises";
import { authFilePath } from "./auth";
import {
  KILO_CODE_BASE_URL,
  KILO_CODE_ORGANIZATION_HEADER,
  KILO_CODE_PROVIDER_ID,
} from "./provider";

type AuthRecord = { type: "api"; key?: string } | { type: "oauth"; access?: string };

export type Model = {
  id: string;
  providerID: string;
  api: { id: string; url: string; npm: string };
  name: string;
  family?: string;
  capabilities: {
    temperature: boolean;
    reasoning: boolean;
    attachment: boolean;
    toolcall: boolean;
    input: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean };
    output: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean };
    interleaved: boolean | { field: "reasoning_content" | "reasoning_details" };
  };
  cost: {
    input: number;
    output: number;
    cache: { read: number; write: number };
  };
  limit: { context: number; input?: number; output: number };
  status: "alpha" | "beta" | "deprecated" | "active";
  options: Record<string, unknown>;
  headers: Record<string, string>;
  release_date: string;
  variants?: Record<string, Record<string, unknown>>;
};

const DEFAULT_CONTEXT = 128_000;
const DEFAULT_OUTPUT = 16_384;

const KILO_API_BASE = "https://api.kilo.ai";

type OpenRouterPricing = {
  prompt?: string | null;
  completion?: string | null;
  input_cache_write?: string | null;
  input_cache_read?: string | null;
};

type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number;
  max_completion_tokens?: number | null;
  pricing?: OpenRouterPricing;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
  top_provider?: { max_completion_tokens?: number | null };
  isFree?: boolean;
  opencode?: {
    family?: string;
    variants?: Record<string, Record<string, unknown>>;
  };
};

type OpenRouterModelsResponse = {
  data?: OpenRouterModel[];
};

type DiscoveryOptions = {
  apiKey?: string;
  organizationId?: string;
  baseURL?: string;
  discoveryURL?: string;
  providerID?: string;
  providerNpm?: string;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  authFile?: string;
};

async function readOpenCodeApiKey(providerID: string, authFile = authFilePath()) {
  try {
    const raw = await readFile(authFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, AuthRecord | undefined>;
    const auth = parsed[providerID];
    if (!auth) return undefined;
    if (auth.type === "api") return auth.key;
    if (auth.type === "oauth") return auth.access;
    return undefined;
  } catch {
    return undefined;
  }
}

function parseApiPrice(price: string | null | undefined): number {
  if (!price) return 0;
  const parsed = parseFloat(price);
  if (isNaN(parsed)) return 0;
  return parsed * 1_000_000;
}

function extractFamily(modelId: string): string {
  const parts = modelId.split("/");
  if (parts.length < 2) return "";
  const modelName = parts[1] ?? "";
  if (modelName.includes("claude")) return "claude";
  if (modelName.includes("gpt")) return "gpt";
  if (modelName.includes("gemini")) return "gemini";
  if (modelName.includes("llama")) return "llama";
  if (modelName.includes("mistral")) return "mistral";
  if (modelName.includes("deepseek")) return "deepseek";
  if (modelName.includes("kimi")) return "kimi";
  if (modelName.includes("glm")) return "glm";
  return "";
}

function mapModalities(modalities: string[] | undefined): Array<"text" | "audio" | "image" | "video" | "pdf"> {
  if (!modalities) return ["text"];
  const result: Array<"text" | "audio" | "image" | "video" | "pdf"> = [];
  for (const m of modalities) {
    if (m === "text" || m === "audio" || m === "image" || m === "video" || m === "pdf") {
      result.push(m);
    }
  }
  if (!result.includes("text")) result.unshift("text");
  return result;
}

export function modelFromOpenRouterModel(
  item: OpenRouterModel,
  providerID: string,
  providerNpm: string,
): Model {
  const id = item.id;
  const contextLength = item.context_length ?? DEFAULT_CONTEXT;
  const maxOutput =
    item.top_provider?.max_completion_tokens ??
    item.max_completion_tokens ??
    (Math.ceil(contextLength * 0.2) || DEFAULT_OUTPUT);

  const inputModalities = mapModalities(item.architecture?.input_modalities);
  const outputModalities = mapModalities(item.architecture?.output_modalities);
  const supportedParameters = item.supported_parameters ?? [];

  const inputPrice = parseApiPrice(item.pricing?.prompt);
  const outputPrice = parseApiPrice(item.pricing?.completion);
  const cacheReadPrice = parseApiPrice(item.pricing?.input_cache_read);
  const cacheWritePrice = parseApiPrice(item.pricing?.input_cache_write);

  return {
    id,
    providerID,
    name: item.name ?? id,
    family: item.opencode?.family ?? extractFamily(id),
    api: {
      id,
      url: KILO_CODE_BASE_URL,
      npm: providerNpm,
    },
    status: "active",
    headers: {},
    options: {},
    cost: {
      input: inputPrice,
      output: outputPrice,
      cache: {
        read: cacheReadPrice,
        write: cacheWritePrice,
      },
    },
    limit: {
      context: contextLength,
      output: maxOutput,
    },
    capabilities: {
      temperature: supportedParameters.includes("temperature"),
      reasoning: supportedParameters.includes("reasoning"),
      attachment: inputModalities.includes("image"),
      toolcall: supportedParameters.includes("tools"),
      input: {
        text: inputModalities.includes("text"),
        audio: inputModalities.includes("audio"),
        image: inputModalities.includes("image"),
        video: inputModalities.includes("video"),
        pdf: inputModalities.includes("pdf"),
      },
      output: {
        text: outputModalities.includes("text"),
        audio: outputModalities.includes("audio"),
        image: outputModalities.includes("image"),
        video: outputModalities.includes("video"),
        pdf: outputModalities.includes("pdf"),
      },
      interleaved: false,
    },
    release_date: "",
    ...(item.opencode?.variants ? { variants: item.opencode.variants } : {}),
  };
}

export function modelFromOpenAIId(id: string, providerID: string, providerNpm: string): Model {
  return {
    id,
    providerID,
    name: id,
    family: "",
    api: {
      id,
      url: KILO_CODE_BASE_URL,
      npm: providerNpm,
    },
    status: "active",
    headers: {},
    options: {},
    cost: {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context: DEFAULT_CONTEXT,
      output: DEFAULT_OUTPUT,
    },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  };
}

function buildDiscoveryURL(organizationId: string | undefined): string {
  if (organizationId) {
    return `${KILO_API_BASE}/api/organizations/${organizationId}`;
  }
  return `${KILO_API_BASE}/api/openrouter`;
}

export async function discoverKiloCodeModels(options: DiscoveryOptions = {}) {
  const providerID = options.providerID ?? KILO_CODE_PROVIDER_ID;
  const providerNpm = options.providerNpm ?? new URL("./provider.js", import.meta.url).href;
  const apiKey = options.apiKey ?? (await readOpenCodeApiKey(providerID, options.authFile));
  const discoveryBase = options.discoveryURL ?? buildDiscoveryURL(options.organizationId);
  const headers: Record<string, string> = {};

  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (options.organizationId) headers[KILO_CODE_ORGANIZATION_HEADER] = options.organizationId;

  const fetchFn = options.fetch ?? fetch;
  const modelsURL = `${discoveryBase.replace(/\/$/, "")}/models`;

  const response = await fetchFn(modelsURL, { headers });
  if (!response.ok) return {};

  const body = (await response.json()) as OpenRouterModelsResponse;
  const models: Record<string, Model> = {};

  for (const item of body.data ?? []) {
    if (typeof item.id !== "string" || item.id.length === 0) continue;
    models[item.id] = modelFromOpenRouterModel(item, providerID, providerNpm);
  }

  return models;
}
