import { describe, expect, test } from "bun:test";
import { modelFromOpenAIId, discoverKiloCodeModels } from "../src/models";
import { KILO_CODE_BASE_URL, KILO_CODE_ORGANIZATION_HEADER, KILO_CODE_PROVIDER_ID } from "../src/provider";

export { KILO_CODE_ORGANIZATION_HEADER };

describe("model discovery", () => {
  test("fetches models from the Kilo OpenAI-compatible models endpoint", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const models = await discoverKiloCodeModels({
      apiKey: "secret-key",
      organizationId: "org_123",
      providerNpm: "file:///provider.js",
      fetch: async (url, init) => {
        seen.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
        return Response.json({ data: [{ id: "openai/gpt-5.1" }, { id: "anthropic/claude-sonnet-4.5" }] });
      },
    });

    expect(seen).toEqual([
      {
        url: `${KILO_CODE_BASE_URL}/models`,
        headers: {
          authorization: "Bearer secret-key",
          "x-kilocode-organizationid": "org_123",
        },
      },
    ]);
    expect(Object.keys(models)).toEqual(["openai/gpt-5.1", "anthropic/claude-sonnet-4.5"]);
    expect(models["openai/gpt-5.1"]?.api.npm).toBe("file:///provider.js");
  });

  test("builds OpenCode model metadata for dynamic IDs", () => {
    const model = modelFromOpenAIId("kilo-auto", KILO_CODE_PROVIDER_ID, "file:///provider.js");

    expect(model.id).toBe("kilo-auto");
    expect(model.providerID).toBe(KILO_CODE_PROVIDER_ID);
    expect(model.api.id).toBe("kilo-auto");
    expect(model.api.npm).toBe("file:///provider.js");
    expect(model.capabilities.toolcall).toBe(true);
  });
});
