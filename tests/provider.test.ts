import { describe, expect, test } from "bun:test";
import { toKiloModel, discoverKiloCodeModels } from "../src/models";
import { KILO_CODE_ORGANIZATION_HEADER, KILO_CODE_PROVIDER_ID } from "../src/provider";

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
