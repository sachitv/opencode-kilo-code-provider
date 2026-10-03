import { afterEach, expect, spyOn, test } from "bun:test";
import type { Context } from "@opencode/plugin/promise/plugin";
import plugin from "../src/index";

const originalFetch = globalThis.fetch;
const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  globalThis.fetch = originalFetch;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Refresh did not finish");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function connection(id: string) {
  return { type: "credential" as const, id, label: id, method: "key" as const };
}

function harness(providerID = "kilo-code", connected = true) {
  type Event = { type: string; data?: { integrationID: string } };
  const queue: Array<{ event: Event; done: () => void }> = [];
  let wake = () => {};
  let transform: ((editor: any) => void) | undefined;
  const state = {
    connection: connected ? connection("A") : undefined,
    key: "key-A",
    registered: undefined as { models: Array<{ id: string }>; sourceConnection?: unknown } | undefined,
    reloads: 0,
    signal: undefined as AbortSignal | undefined,
  };
  const replay = () => transform?.({ add: (entry: typeof state.registered) => { state.registered = entry; } });
  const ctx = {
    options: { providerID, organizationId: "org" },
    event: {
      async *subscribe({ signal }: { signal: AbortSignal }) {
        state.signal = signal;
        const abort = () => wake();
        signal.addEventListener("abort", abort);
        try {
          while (!signal.aborted) {
            if (!queue.length) await new Promise<void>((resolve) => { wake = resolve; });
            const next = queue.shift();
            if (!next) continue;
            try { yield next.event; } finally { next.done(); }
          }
        } finally {
          signal.removeEventListener("abort", abort);
        }
      },
    },
    integration: {
      transform: async (callback: (editor: any) => void) => {
        callback({ update: () => {}, method: { update: () => {} } });
      },
      connection: {
        active: async () => state.connection,
        resolve: async () => ({ type: "key", key: state.key }),
      },
    },
    provider: {
      transform: async (callback: typeof transform) => { transform = callback; replay(); },
      reload: async () => { state.reloads++; replay(); },
    },
    model: { transform: async () => {} },
  } as unknown as Context;
  return {
    state,
    ctx,
    async setup() {
      const cleanup = await plugin.setup(ctx);
      if (cleanup) cleanups.push(cleanup);
      return cleanup as () => void;
    },
    emit(event: Event) {
      return new Promise<void>((done) => { queue.push({ event, done }); wake(); });
    },
  };
}

function mockDiscovery(handler?: (auth: string | null, signal?: AbortSignal | null) => Promise<Response>) {
  const seen: Array<string | null> = [];
  globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization");
    seen.push(auth);
    return handler ? handler(auth, init?.signal) : Response.json({ data: [{ id: auth ?? "public" }] });
  }, { preconnect: originalFetch.preconnect });
  return seen;
}

test("switching accounts replaces models and binds discovery to the new connection", async () => {
  const seen = mockDiscovery();
  const h = harness("custom-kilo");
  await h.setup();
  h.state.connection = connection("B");
  h.state.key = "key-B";
  await h.emit({ type: "credential.switched", data: { integrationID: "custom-kilo" } });
  await waitFor(() => h.state.reloads === 1);
  expect(seen).toEqual(["Bearer key-A", "Bearer key-B"]);
  expect(h.state.registered?.sourceConnection).toEqual(connection("B"));
  expect(h.state.registered?.models.map((m) => m.id)).toEqual(["Bearer key-B", "kilo-auto/free"]);
  expect(h.state.reloads).toBe(1);
});

test("connecting after unauthorized startup refreshes the full authenticated catalog", async () => {
  const h = harness("kilo-code", false);
  mockDiscovery(async () => h.state.connection
    ? Response.json({ data: [{ id: "account-model" }] })
    : new Response("Unauthorized", { status: 401 }));
  await h.setup();
  expect(h.state.registered?.models.map((m) => m.id)).toEqual(["kilo-auto/free"]);
  h.state.connection = connection("B");
  h.state.key = "key-B";
  await h.emit({ type: "integration.updated" });
  await waitFor(() => h.state.reloads === 1);
  expect(h.state.registered?.models.map((m) => m.id)).toEqual(["account-model", "kilo-auto/free"]);
  expect(h.state.registered?.sourceConnection).toEqual(connection("B"));
});

test("credential edits refresh even when the connection identity is unchanged", async () => {
  const seen = mockDiscovery();
  const h = harness();
  await h.setup();
  h.state.key = "rotated-key";
  await h.emit({ type: "credential.updated" });
  await waitFor(() => h.state.reloads === 1);
  expect(seen).toEqual(["Bearer key-A", "Bearer rotated-key"]);
  expect(h.state.registered?.sourceConnection).toEqual(connection("A"));
});

test("ignores other providers' switches and provider reload notifications", async () => {
  const seen = mockDiscovery();
  const h = harness();
  await h.setup();
  await h.emit({ type: "credential.switched", data: { integrationID: "other" } });
  await h.emit({ type: "provider.updated" });
  expect(seen).toEqual(["Bearer key-A"]);
  expect(h.state.reloads).toBe(0);
});

test("captures account changes during initial discovery", async () => {
  const h = harness();
  let switched: Promise<void> | undefined;
  mockDiscovery(async (auth) => {
    if (auth === "Bearer key-A") {
      expect(h.state.signal).toBeDefined();
      h.state.connection = connection("B");
      h.state.key = "key-B";
      switched = h.emit({ type: "credential.switched", data: { integrationID: "kilo-code" } });
    }
    return Response.json({ data: [{ id: auth }] });
  });
  await h.setup();
  await switched;
  await waitFor(() => h.state.reloads === 1);
  expect(h.state.registered?.sourceConnection).toEqual(connection("B"));
  expect(h.state.registered?.models[0]?.id).toBe("Bearer key-B");
});

test("failed discovery binds a default and recovers without another event", async () => {
  let fail = false;
  mockDiscovery(async (auth) => {
    if (fail) throw new Error("Network unavailable");
    return Response.json({ data: [{ id: auth }] });
  });
  const h = harness();
  await h.setup();
  h.state.connection = connection("B");
  h.state.key = "key-B";
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    fail = true;
    await h.emit({ type: "credential.updated" });
    await waitFor(() => h.state.reloads === 1);
    expect(h.state.registered?.sourceConnection).toEqual(connection("B"));
    expect(h.state.registered?.models.map((m) => m.id)).toEqual(["kilo-auto/free"]);
    fail = false;
    await waitFor(() => h.state.reloads === 2);
    expect(h.state.registered?.models[0]?.id).toBe("Bearer key-B");
    expect(h.state.registered?.sourceConnection).toEqual(connection("B"));
  } finally { log.mockRestore(); }
});

test("a stalled account refresh cannot block the next account or publish a late result", async () => {
  const started = deferred<AbortSignal | null | undefined>();
  const response = deferred<Response>();
  const seen = mockDiscovery(async (auth, signal) => {
    if (auth === "Bearer key-B") { started.resolve(signal); return response.promise; }
    return Response.json({ data: [{ id: auth }] });
  });
  const h = harness();
  await h.setup();
  h.state.connection = connection("B");
  h.state.key = "key-B";
  const second = h.emit({ type: "credential.switched", data: { integrationID: "kilo-code" } });
  const signal = await started.promise;
  h.state.connection = connection("C");
  h.state.key = "key-C";
  const third = h.emit({ type: "credential.switched", data: { integrationID: "kilo-code" } });
  await Promise.all([second, third]);
  await waitFor(() => h.state.registered?.models[0]?.id === "Bearer key-C");
  expect(signal?.aborted).toBe(true);
  response.resolve(Response.json({ data: [{ id: "B-model" }] }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(seen).toEqual(["Bearer key-A", "Bearer key-B", "Bearer key-C"]);
  expect(h.state.registered?.sourceConnection).toEqual(connection("C"));
  expect(h.state.registered?.models[0]?.id).toBe("Bearer key-C");
});

test("an unavailable catalog at startup recovers automatically from HTTP errors", async () => {
  let unavailable = true;
  mockDiscovery(async () => unavailable
    ? new Response("Unavailable", { status: 503 })
    : Response.json({ data: [{ id: "recovered-model" }] }));
  const h = harness();
  await h.setup();
  expect(h.state.registered?.sourceConnection).toEqual(connection("A"));
  expect(h.state.registered?.models.map((m) => m.id)).toEqual(["kilo-auto/free"]);
  unavailable = false;
  await waitFor(() => h.state.registered?.models[0]?.id === "recovered-model");
  expect(h.state.reloads).toBe(1);
});

test("unloading cancels scheduled retries after a discovery failure", async () => {
  const seen = mockDiscovery(async (auth) => auth === "Bearer key-B"
    ? new Response("Unavailable", { status: 503 })
    : Response.json({ data: [{ id: "A-model" }] }));
  const h = harness();
  const cleanup = await h.setup();
  h.state.connection = connection("B");
  h.state.key = "key-B";
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    await h.emit({ type: "credential.updated" });
    await waitFor(() => h.state.reloads === 1);
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(seen).toEqual(["Bearer key-A", "Bearer key-B"]);
    expect(h.state.reloads).toBe(1);
  } finally { log.mockRestore(); }
});

test("unloading aborts discovery and prevents a pending refresh from publishing", async () => {
  const started = deferred<AbortSignal | null | undefined>();
  const response = deferred<Response>();
  mockDiscovery(async (auth, signal) => {
    if (auth === "Bearer key-B") { started.resolve(signal); return response.promise; }
    return Response.json({ data: [{ id: "A-model" }] });
  });
  const h = harness();
  const cleanup = await h.setup();
  h.state.connection = connection("B");
  h.state.key = "key-B";
  const refreshed = h.emit({ type: "credential.updated" });
  const signal = await started.promise;
  cleanup();
  expect(signal?.aborted).toBe(true);
  expect(h.state.signal?.aborted).toBe(true);
  response.resolve(Response.json({ data: [{ id: "B-model" }] }));
  await refreshed;
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(h.state.reloads).toBe(0);
  expect(h.state.registered?.sourceConnection).toEqual(connection("A"));
});
