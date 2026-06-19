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

type OpenAIModel = {
  id?: unknown;
  object?: unknown;
  owned_by?: unknown;
};

type OpenAIModelsResponse = {
  data?: OpenAIModel[];
};

type DiscoveryOptions = {
  apiKey?: string;
  organizationId?: string;
  baseURL?: string;
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

export async function discoverKiloCodeModels(options: DiscoveryOptions = {}) {
  const providerID = options.providerID ?? KILO_CODE_PROVIDER_ID;
  const providerNpm = options.providerNpm ?? new URL("./provider.js", import.meta.url).href;
  const baseURL = options.baseURL ?? KILO_CODE_BASE_URL;
  const apiKey = options.apiKey ?? (await readOpenCodeApiKey(providerID, options.authFile));
  const headers: Record<string, string> = {};

  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (options.organizationId) headers[KILO_CODE_ORGANIZATION_HEADER] = options.organizationId;

  const response = await (options.fetch ?? fetch)(`${baseURL.replace(/\/$/, "")}/models`, { headers });
  if (!response.ok) return {};

  const body = (await response.json()) as OpenAIModelsResponse;
  const models: Record<string, Model> = {};

  for (const item of body.data ?? []) {
    if (typeof item.id !== "string" || item.id.length === 0) continue;
    models[item.id] = modelFromOpenAIId(item.id, providerID, providerNpm);
  }

  return models;
}
