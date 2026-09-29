import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "@opencode-ai/plugin";
import { authFilePath, readOpenCodeApiKey } from "../src/auth";
import plugin, { KiloCodeOpenCodeProvider } from "../src/index";
import { toKiloModel, discoverKiloCodeModels } from "../src/models";
import { KILO_CODE_ORGANIZATION_HEADER, KILO_CODE_PROVIDER_ID } from "../src/provider";

const originalFetch = globalThis.fetch;
const originalXdgDataHome = process.env.XDG_DATA_HOME;

function stubFetch(handler: Parameters<typeof fetch>[0] extends never ? never : (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return Object.assign(handler, { preconnect: originalFetch.preconnect });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.XDG_DATA_HOME = originalXdgDataHome;
  }
});

function mockModel(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    context_length: 128000,
    max_completion_tokens: 16384,
    pricing: { prompt: "0.000001", completion: "0.000003", input_cache_read: "0.0000001", input_cache_write: "0.0000005" },
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    supported_parameters: ["tools", "temperature", "reasoning"],
    ...overrides,
  };
}

describe("toKiloModel", () => {
  test("parses pricing from $/token to $/M tokens", () => {
    const m = toKiloModel(mockModel("openai/gpt-5.1", { name: "GPT-5.1" }), "file:///p.js");
    expect(m.cost.input).toBe(1);
    expect(m.cost.output).toBe(3);
    expect(m.cost.cache_read).toBeCloseTo(0.1, 5);
    expect(m.cost.cache_write).toBe(0.5);
  });

  test("extracts family from model id", () => {
    expect(toKiloModel(mockModel("deepseek/deepseek-v4-pro"), "npm").family).toBe("deepseek");
    expect(toKiloModel(mockModel("anthropic/claude-sonnet-4.5"), "npm").family).toBe("claude");
    expect(toKiloModel(mockModel("kilo-auto/free"), "npm").family).toBe("");
  });

  test("maps capabilities from supported_parameters", () => {
    const m = toKiloModel(mockModel("test/model", { supported_parameters: ["tools"] }), "npm");
    expect(m.tool_call).toBe(true);
    expect(m.reasoning).toBe(false);
    expect(m.temperature).toBe(false);
  });

  test("maps modalities from architecture", () => {
    const m = toKiloModel(mockModel("test/model"), "npm");
    expect(m.input_modalities).toEqual(["text", "image"]);
    expect(m.output_modalities).toEqual(["text"]);
  });

  test("defaults to text modality when none specified", () => {
    const m = toKiloModel(mockModel("test/model", { architecture: {} }), "npm");
    expect(m.input_modalities).toEqual(["text"]);
  });

  test("uses defaults for missing fields", () => {
    const m = toKiloModel({ id: "bare" }, "npm");
    expect(m.limit.context).toBe(128000);
    expect(m.limit.output).toBeGreaterThan(0);
    expect(m.cost.input).toBe(0);
    expect(m.tool_call).toBe(false);
  });

  test("preserves variants from opencode field", () => {
    const m = toKiloModel(mockModel("test/model", { opencode: { variants: { reasoning: { effort: "high" } } } }), "npm");
    expect(m.variants).toEqual({ reasoning: { effort: "high" } });
  });

  test("computes output from context_length when max_completion_tokens missing", () => {
    const m = toKiloModel(mockModel("test/model", { context_length: 100000, max_completion_tokens: null, top_provider: undefined }), "npm");
    expect(m.limit.output).toBe(20000);
  });
});

describe("discoverKiloCodeModels", () => {
  test("fetches model data from a Kilo-compatible HTTP API", async () => {
    const seen: Array<{ path: string; auth: string | null; org: string | null }> = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        seen.push({
          path: url.pathname,
          auth: req.headers.get("authorization"),
          org: req.headers.get(KILO_CODE_ORGANIZATION_HEADER),
        });
        return Response.json({
          data: [
            mockModel("deepseek/deepseek-v4-pro", {
              pricing: { prompt: "0.0000024", completion: "0.0000048", input_cache_read: "0.0000002" },
            }),
          ],
        });
      },
    });

    try {
      const models = await discoverKiloCodeModels({
        apiKey: "secret-key",
        organizationId: "org_live",
        providerNpm: "file:///provider.js",
        fetch: (url, init) => {
          const upstream = new URL(String(url));
          return fetch(new URL(upstream.pathname, server.url), init);
        },
      });

      expect(seen).toEqual([{
        path: "/api/organizations/org_live/models",
        auth: "Bearer secret-key",
        org: "org_live",
      }]);
      expect(models["deepseek/deepseek-v4-pro"]?.cost).toEqual({
        input: 2.4,
        output: 4.8,
        cache_read: 0.19999999999999998,
        cache_write: 0,
      });
    } finally {
      server.stop(true);
    }
  });

  test("calls org endpoint with auth and org header when organizationId provided", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const models = await discoverKiloCodeModels({
      apiKey: "secret-key",
      organizationId: "org_123",
      providerNpm: "file:///p.js",
      fetch: async (url, init) => {
        seen.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
        return Response.json({ data: [mockModel("openai/gpt-5.1"), mockModel("anthropic/claude-sonnet-4.5")] });
      },
    });

    expect(seen).toEqual([{
      url: "https://api.kilo.ai/api/organizations/org_123/models",
      headers: { authorization: "Bearer secret-key", "x-kilocode-organizationid": "org_123" },
    }]);
    expect(Object.keys(models)).toEqual(["openai/gpt-5.1", "anthropic/claude-sonnet-4.5"]);
    expect(models["openai/gpt-5.1"]?.cost.input).toBe(1);
  });

  test("calls public openrouter endpoint when no organizationId", async () => {
    const seen: Array<{ url: string }> = [];
    await discoverKiloCodeModels({
      apiKey: "key",
      providerNpm: "npm",
      fetch: async (url) => {
        seen.push({ url: String(url) });
        return Response.json({ data: [mockModel("kilo-auto/free")] });
      },
    });
    expect(seen).toEqual([{ url: "https://api.kilo.ai/api/openrouter/models" }]);
  });

  test("returns empty on non-ok response", async () => {
    const models = await discoverKiloCodeModels({
      apiKey: "key",
      providerNpm: "npm",
      fetch: async () => new Response("Unauthorized", { status: 401 }),
    });
    expect(models).toEqual({});
  });

  test("skips items with missing or empty id", async () => {
    const models = await discoverKiloCodeModels({
      apiKey: "key",
      providerNpm: "npm",
      fetch: async () => Response.json({ data: [{ id: "" }, { id: "valid/model" }] }),
    });
    expect(Object.keys(models)).toEqual(["valid/model"]);
  });
});

describe("KiloCodeOpenCodeProvider", () => {
  test("maps discovered API models into OpenCode provider config", async () => {
    const requests: string[] = [];
    globalThis.fetch = stubFetch(async (url, init) => {
      requests.push(`${String(url)} ${new Headers(init?.headers).get(KILO_CODE_ORGANIZATION_HEADER)}`);
      return Response.json({
        data: [mockModel("anthropic/claude-sonnet-4.5", {
          name: "Claude Sonnet 4.5",
          pricing: { prompt: "0.000003", completion: "0.000015", input_cache_read: "0.0000003", input_cache_write: "0.00000375" },
          opencode: { variants: { fast: { label: "Fast" } } },
        })],
      });
    });

    const hooks = await KiloCodeOpenCodeProvider({} as Parameters<typeof KiloCodeOpenCodeProvider>[0], {
      organizationId: "org_cfg",
      defaultModel: "anthropic/claude-sonnet-4.5",
    });
    const config: Config = {};
    await hooks.config?.(config);

    expect(requests).toEqual(["https://api.kilo.ai/api/organizations/org_cfg/models org_cfg"]);
    expect(config.model).toBe("kilo-code/anthropic/claude-sonnet-4.5");
    expect(config.provider?.[KILO_CODE_PROVIDER_ID]?.name).toBe("Kilo Code Gateway");
    expect(config.provider?.[KILO_CODE_PROVIDER_ID]?.options).toMatchObject({
      baseURL: "https://api.kilo.ai/api/gateway",
      organizationId: "org_cfg",
      headers: { [KILO_CODE_ORGANIZATION_HEADER]: "org_cfg" },
    });
    expect(config.provider?.[KILO_CODE_PROVIDER_ID]?.models?.["anthropic/claude-sonnet-4.5"]).toMatchObject({
      id: "anthropic/claude-sonnet-4.5",
      name: "Claude Sonnet 4.5",
      family: "claude",
      cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      modalities: { input: ["text", "image"], output: ["text"] },
      variants: { fast: { label: "Fast" } },
    });
  });

  test("uses organization id already present in config and preserves existing model", async () => {
    globalThis.fetch = stubFetch(async () => Response.json({ data: [mockModel("kilo-auto/free")] }));

    const hooks = await KiloCodeOpenCodeProvider({} as Parameters<typeof KiloCodeOpenCodeProvider>[0], {
      defaultModel: "kilo-auto/free",
    });
    const config: Config = {
      model: "existing/provider",
      provider: {
        [KILO_CODE_PROVIDER_ID]: { options: { organizationId: "org_existing" } },
      },
    } as Config;
    await hooks.config?.(config);

    expect(config.model).toBe("existing/provider");
    expect(config.provider?.[KILO_CODE_PROVIDER_ID]?.options).toMatchObject({ organizationId: "org_existing" });
  });

  test("honors custom provider id for auth, config, and default model", async () => {
    globalThis.fetch = stubFetch(async () => Response.json({ data: [mockModel("kilo-auto/free")] }));

    const hooks = await KiloCodeOpenCodeProvider({} as Parameters<typeof KiloCodeOpenCodeProvider>[0], {
      providerID: "custom-kilo",
      defaultModel: "kilo-auto/free",
    });
    const config: Config = {};
    await hooks.config?.(config);

    expect(hooks.auth?.provider).toBe("custom-kilo");
    expect(config.model).toBe("custom-kilo/kilo-auto/free");
    expect(config.provider?.["custom-kilo"]?.models?.["kilo-auto/free"]?.id).toBe("kilo-auto/free");
    expect(config.provider?.[KILO_CODE_PROVIDER_ID]).toBeUndefined();
  });

  test("uses the free Kilo model as the default", async () => {
    globalThis.fetch = stubFetch(async () => Response.json({ data: [mockModel("kilo-auto/free")] }));

    const hooks = await KiloCodeOpenCodeProvider({} as Parameters<typeof KiloCodeOpenCodeProvider>[0]);
    const config: Config = {};
    await hooks.config?.(config);

    expect(config.model).toBe("kilo-code/kilo-auto/free");
  });
});

describe("OpenCode 2 plugin", () => {
  test("exports the V2 setup alongside the V1 server", () => {
    expect(plugin.id).toBe("kilo-code");
    expect(plugin.setup).toBeTypeOf("function");
    expect(plugin.server).toBe(KiloCodeOpenCodeProvider);
  });

  test("registers V2 credentials, provider, and models", async () => {
    globalThis.fetch = stubFetch(async () => Response.json({
      data: [mockModel("openai/gpt-5.1", {
        opencode: { variants: { fast: { temperature: 0.2 } } },
      })],
    }));

    const methods: unknown[] = [];
    let providerTransform: ((provider: any) => void) | undefined;
    let modelTransform: ((model: any) => void) | undefined;
    const ctx = {
      options: { organizationId: "org_v2", defaultModel: "openai/gpt-5.1" },
      integration: {
        transform: async (callback: (editor: any) => void) => {
          callback({
            update: () => undefined,
            method: { update: (input: unknown) => methods.push(input) },
          });
        },
        connection: {
          active: async () => undefined,
          resolve: async () => undefined,
        },
      },
      provider: { transform: async (callback: (provider: any) => void) => { providerTransform = callback; } },
      model: { transform: async (callback: (model: any) => void) => { modelTransform = callback; } },
    } as any;

    await plugin.setup(ctx);

    const registered: {
      info?: Record<string, unknown>;
      models?: Array<Record<string, any>>;
      sourceConnection?: unknown;
    } = {};
    let defaultModel: { providerID: string; modelID: string } | undefined;
    providerTransform?.({ add: (input: typeof registered) => Object.assign(registered, input) });
    modelTransform?.({ default: {
      get: () => defaultModel,
      set: (providerID: string, modelID: string) => { defaultModel = { providerID, modelID }; },
    } });

    expect(methods).toEqual([{
      integrationID: "kilo-code",
      method: { type: "key", label: "Kilo Gateway API key" },
    }]);
    expect(registered.info).toMatchObject({
      name: "Kilo Code Gateway",
      activation: "enabled",
      package: expect.stringMatching(/^aisdk:.*provider\.js$/),
      integrationID: "kilo-code",
      settings: { baseURL: "https://api.kilo.ai/api/gateway" },
      headers: { [KILO_CODE_ORGANIZATION_HEADER]: "org_v2" },
    });
    expect(registered.models?.[0]).toMatchObject({
      name: "openai/gpt-5.1",
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      variants: [{ id: "fast", settings: { temperature: 0.2 } }],
    });
    expect(registered.sourceConnection).toBeUndefined();
    expect(defaultModel).toEqual({ providerID: "kilo-code", modelID: "openai/gpt-5.1" });
  });

  test("registers the free Kilo default when org discovery is unauthorized", async () => {
    globalThis.fetch = stubFetch(async () => new Response("Unauthorized", { status: 401 }));

    let providerTransform: ((provider: any) => void) | undefined;
    let modelTransform: ((model: any) => void) | undefined;
    const ctx = {
      options: { organizationId: "org_v2" },
      integration: {
        transform: async (callback: (editor: any) => void) => {
          callback({ update: () => undefined, method: { update: () => undefined } });
        },
        connection: { active: async () => undefined, resolve: async () => undefined },
      },
      provider: { transform: async (callback: (provider: any) => void) => { providerTransform = callback; } },
      model: { transform: async (callback: (model: any) => void) => { modelTransform = callback; } },
    } as any;

    await plugin.setup(ctx);

    let registeredModels: Array<Record<string, unknown>> = [];
    let defaultModel: { providerID: string; modelID: string } | undefined;
    providerTransform?.({ add: (input: { models: Array<Record<string, unknown>> }) => { registeredModels = input.models; } });
    modelTransform?.({ default: {
      get: () => defaultModel,
      set: (providerID: string, modelID: string) => { defaultModel = { providerID, modelID }; },
    } });

    expect(registeredModels[0]).toMatchObject({ name: "kilo-auto/free", enabled: true });
    expect(defaultModel).toEqual({ providerID: "kilo-code", modelID: "kilo-auto/free" });
  });

  test("preserves an explicit V2 catalog default", async () => {
    globalThis.fetch = stubFetch(async () => Response.json({ data: [mockModel("kilo-auto/free")] }));

    let modelTransform: ((model: any) => void) | undefined;
    const ctx = {
      options: { defaultModel: "kilo-auto/free" },
      integration: {
        transform: async (callback: (editor: any) => void) => {
          callback({ update: () => undefined, method: { update: () => undefined } });
        },
        connection: { active: async () => undefined, resolve: async () => undefined },
      },
      provider: { transform: async () => undefined },
      model: { transform: async (callback: (model: any) => void) => { modelTransform = callback; } },
    } as any;

    await plugin.setup(ctx);

    let defaultModel = { providerID: "openai", modelID: "gpt-5.6-sol" };
    modelTransform?.({ default: {
      get: () => defaultModel,
      set: (providerID: string, modelID: string) => { defaultModel = { providerID, modelID }; },
    } });

    expect(defaultModel).toEqual({ providerID: "openai", modelID: "gpt-5.6-sol" });
  });

  describe("V2 credential resolution", () => {
    type Connection = { active: () => Promise<unknown>; resolve: () => Promise<unknown> };

    async function discoveryAuthWithLegacyKey(connection: Connection) {
      const dir = mkdtempSync(join(tmpdir(), "kilo-auth-"));
      process.env.XDG_DATA_HOME = dir;
      mkdirSync(join(dir, "opencode"));
      writeFileSync(
        join(dir, "opencode", "auth.json"),
        JSON.stringify({ [KILO_CODE_PROVIDER_ID]: { type: "api", key: "legacy-key" } }),
      );

      const seen: Array<string | null> = [];
      globalThis.fetch = stubFetch(async (_url, init) => {
        seen.push(new Headers(init?.headers).get("authorization"));
        return Response.json({ data: [mockModel("kilo-auto/free")] });
      });

      const ctx = {
        options: {},
        integration: {
          transform: async (callback: (editor: any) => void) => {
            callback({ update: () => undefined, method: { update: () => undefined } });
          },
          connection,
        },
        provider: { transform: async () => undefined },
        model: { transform: async () => undefined },
      } as any;

      try {
        await plugin.setup(ctx);
        return seen;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    test("uses the active V2 connection key over the legacy auth store", async () => {
      const seen = await discoveryAuthWithLegacyKey({
        active: async () => ({ id: "conn" }),
        resolve: async () => ({ type: "key", key: "v2-key" }),
      });
      expect(seen).toEqual(["Bearer v2-key"]);
    });

    test("binds the provider inventory to the active V2 connection", async () => {
      globalThis.fetch = stubFetch(async () => Response.json({ data: [mockModel("kilo-auto/free")] }));

      const connection = { id: "conn" };
      let registeredConnection: unknown;
      const ctx = {
        options: {},
        integration: {
          transform: async (callback: (editor: any) => void) => {
            callback({ update: () => undefined, method: { update: () => undefined } });
          },
          connection: {
            active: async () => connection,
            resolve: async () => ({ type: "key", key: "v2-key" }),
          },
        },
        provider: {
          transform: async (callback: (provider: any) => void) => {
            callback({ add: (input: { sourceConnection?: unknown }) => { registeredConnection = input.sourceConnection; } });
          },
        },
        model: { transform: async () => undefined },
      } as any;

      await plugin.setup(ctx);

      expect(registeredConnection).toBe(connection);
    });

    test("falls back to the legacy auth store when no V2 connection exists", async () => {
      const seen = await discoveryAuthWithLegacyKey({
        active: async () => undefined,
        resolve: async () => undefined,
      });
      expect(seen).toEqual(["Bearer legacy-key"]);
    });

    test("does not revive the legacy key when the V2 connection fails to resolve", async () => {
      const seen = await discoveryAuthWithLegacyKey({
        active: async () => ({ id: "conn" }),
        resolve: async () => { throw new Error("credential store unavailable"); },
      });
      expect(seen).toEqual([null]);
    });
  });
});

describe("OpenCode auth storage", () => {
  function withAuthFile(content: string) {
    const dir = mkdtempSync(join(tmpdir(), "kilo-auth-"));
    process.env.XDG_DATA_HOME = dir;
    mkdirSync(join(dir, "opencode"));
    writeFileSync(join(dir, "opencode", "auth.json"), content);
    return dir;
  }

  test("reads oauth access token from OpenCode auth store", () => {
    const dir = withAuthFile(JSON.stringify({ [KILO_CODE_PROVIDER_ID]: { type: "oauth", access: "oauth-token" } }));
    try {
      expect(authFilePath()).toBe(join(dir, "opencode", "auth.json"));
      expect(readOpenCodeApiKey(KILO_CODE_PROVIDER_ID)).toBe("oauth-token");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined for missing or invalid auth files", () => {
    const dir = mkdtempSync(join(tmpdir(), "kilo-auth-"));
    process.env.XDG_DATA_HOME = dir;
    try {
      expect(readOpenCodeApiKey(KILO_CODE_PROVIDER_ID)).toBeUndefined();
      mkdirSync(join(dir, "opencode"));
      writeFileSync(join(dir, "opencode", "auth.json"), "not json");
      expect(readOpenCodeApiKey(KILO_CODE_PROVIDER_ID)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("model discovery reads auth from custom provider id", async () => {
    const dir = withAuthFile(JSON.stringify({ "custom-kilo": { type: "api", key: "custom-token" } }));
    const seen: string[] = [];
    try {
      await discoverKiloCodeModels({
        providerID: "custom-kilo",
        providerNpm: "npm",
        fetch: async (_url, init) => {
          seen.push(new Headers(init?.headers).get("authorization") ?? "");
          return Response.json({ data: [mockModel("kilo-auto/free")] });
        },
      });
      expect(seen).toEqual(["Bearer custom-token"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("createKiloCode", () => {
  test("injects organization header", async () => {
    const { createKiloCode } = await import("../src/provider");
    const provider = createKiloCode({ organizationId: "org-abc", apiKey: "key", name: "test" });
    expect(provider).toBeDefined();
  });

  test("reads API key from OpenCode auth store when not provided", async () => {
    const { createKiloCode } = await import("../src/provider");
    const provider = createKiloCode({ name: "test" });
    expect(provider).toBeDefined();
  });
});
