import { describe, expect, test } from "bun:test";
import { modelFromOpenAIId, modelFromOpenRouterModel, discoverKiloCodeModels } from "../src/models";
import { KILO_CODE_ORGANIZATION_HEADER, KILO_CODE_PROVIDER_ID } from "../src/provider";

describe("model discovery", () => {
  test("fetches models from the Kilo OpenRouter-compatible endpoint with org", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const models = await discoverKiloCodeModels({
      apiKey: "secret-key",
      organizationId: "org_123",
      providerNpm: "file:///provider.js",
      fetch: async (url, init) => {
        seen.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
        return Response.json({
          data: [
            {
              id: "openai/gpt-5.1",
              name: "GPT-5.1",
              context_length: 200000,
              max_completion_tokens: 32768,
              pricing: { prompt: "0.000005", completion: "0.000015", input_cache_read: "0.000001", input_cache_write: "0.000003" },
              architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
              supported_parameters: ["tools", "temperature", "reasoning"],
            },
            {
              id: "anthropic/claude-sonnet-4.5",
              name: "Claude Sonnet 4.5",
              context_length: 200000,
              pricing: { prompt: "0.000003", completion: "0.000015" },
              supported_parameters: ["tools"],
            },
          ],
        });
      },
    });

    expect(seen).toEqual([
      {
        url: "https://api.kilo.ai/api/organizations/org_123/models",
        headers: {
          authorization: "Bearer secret-key",
          "x-kilocode-organizationid": "org_123",
        },
      },
    ]);
    expect(Object.keys(models)).toEqual(["openai/gpt-5.1", "anthropic/claude-sonnet-4.5"]);
    expect(models["openai/gpt-5.1"]?.api.npm).toBe("file:///provider.js");
    expect(models["openai/gpt-5.1"]?.cost.input).toBe(5);
    expect(models["openai/gpt-5.1"]?.cost.output).toBe(15);
    expect(models["openai/gpt-5.1"]?.cost.cache.read).toBe(1);
    expect(models["openai/gpt-5.1"]?.cost.cache.write).toBe(3);
    expect(models["openai/gpt-5.1"]?.limit.context).toBe(200000);
    expect(models["openai/gpt-5.1"]?.limit.output).toBe(32768);
    expect(models["openai/gpt-5.1"]?.capabilities.reasoning).toBe(true);
    expect(models["openai/gpt-5.1"]?.capabilities.attachment).toBe(true);
    expect(models["anthropic/claude-sonnet-4.5"]?.cost.input).toBe(3);
    expect(models["anthropic/claude-sonnet-4.5"]?.cost.cache.read).toBe(0);
  });

  test("fetches models from the public OpenRouter endpoint without org", async () => {
    const seen: Array<{ url: string }> = [];
    await discoverKiloCodeModels({
      apiKey: "secret-key",
      providerNpm: "file:///provider.js",
      fetch: async (url) => {
        seen.push({ url: String(url) });
        return Response.json({ data: [{ id: "kilo-auto/free" }] });
      },
    });

    expect(seen).toEqual([{ url: "https://api.kilo.ai/api/openrouter/models" }]);
  });

  test("builds OpenCode model metadata from OpenRouter model with pricing", () => {
    const model = modelFromOpenRouterModel(
      {
        id: "deepseek/deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        context_length: 128000,
        pricing: { prompt: "0.0000003", completion: "0.0000012" },
        supported_parameters: ["tools", "temperature"],
      },
      KILO_CODE_PROVIDER_ID,
      "file:///provider.js",
    );

    expect(model.id).toBe("deepseek/deepseek-v4-pro");
    expect(model.name).toBe("DeepSeek V4 Pro");
    expect(model.family).toBe("deepseek");
    expect(model.cost.input).toBe(0.3);
    expect(model.cost.output).toBe(1.2);
    expect(model.capabilities.toolcall).toBe(true);
    expect(model.capabilities.temperature).toBe(true);
    expect(model.limit.context).toBe(128000);
  });

  test("builds fallback model metadata for basic IDs", () => {
    const model = modelFromOpenAIId("kilo-auto", KILO_CODE_PROVIDER_ID, "file:///provider.js");

    expect(model.id).toBe("kilo-auto");
    expect(model.providerID).toBe(KILO_CODE_PROVIDER_ID);
    expect(model.api.npm).toBe("file:///provider.js");
    expect(model.capabilities.toolcall).toBe(true);
    expect(model.cost.input).toBe(0);
  });
});
