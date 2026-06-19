import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type AuthRecord = { type: "api"; key?: string } | { type: "oauth"; access?: string };

export function authFilePath(): string {
  const dataHome = process.env.XDG_DATA_HOME;
  return dataHome ? join(dataHome, "opencode", "auth.json") : join(homedir(), ".local", "share", "opencode", "auth.json");
}

export function readOpenCodeApiKeySync(providerID: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(authFilePath(), "utf8")) as Record<string, AuthRecord | undefined>;
    const auth = parsed[providerID];
    if (!auth) return undefined;
    if (auth.type === "api") return auth.key;
    if (auth.type === "oauth") return auth.access;
    return undefined;
  } catch {
    return undefined;
  }
}
