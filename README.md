# @sachitv/opencode-kilo-code-provider

An OpenCode provider plugin for the [Kilo Code Gateway](https://kilo.ai/docs/gateway).

This package is a **separate** OpenCode provider (not the built-in `kilo` provider). It dynamically fetches the model list from Kilo's OpenAI-compatible `/models` endpoint at startup, so you never have to hand-maintain model entries in your config.

The API key stays in OpenCode's credential store. The organization id is non-secret config sent as:

```http
X-KiloCode-OrganizationId: your_org_id
```

The organization id is a UUID (e.g. `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) found in your Kilo dashboard URL.

## Install

### From npm

```bash
bun add @sachitv/opencode-kilo-code-provider
```

Then add it to your OpenCode config:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "@sachitv/opencode-kilo-code-provider",
      {
        "organizationId": "your_org_id",
        "defaultModel": "kilo-auto/free"
      }
    ]
  ]
}
```

### From source (local development)

```bash
git clone https://github.com/sachitv/opencode-kilo-code-provider.git
cd opencode-kilo-code-provider
bun install
bun run build
```

Then reference the built output via `file://`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "file:///absolute/path/to/opencode-kilo-code-provider/dist/index.js",
      {
        "organizationId": "your_org_id",
        "defaultModel": "kilo-auto/free"
      }
    ]
  ]
}
```

## Add the API Key

Run OpenCode and connect the custom provider id:

```text
/connect
```

Choose `kilo-code` and paste your Kilo Gateway API key. OpenCode stores it in `~/.local/share/opencode/auth.json`. Do not put the key in `opencode.json`.

## Use Models

Restart OpenCode after installing the plugin, then run:

```text
/models
```

Models returned by Kilo's `/models` endpoint appear under `Kilo Code Gateway`. Use them as `kilo-code/<model-id>`:

```jsonc
{
  "model": "kilo-code/kilo-auto/free"
}
```

## How It Works

The package has two parts:

- **`dist/provider.js`** exports `createKiloCode`, an AI SDK provider factory wrapping Kilo's OpenAI-compatible gateway at `https://api.kilo.ai/api/gateway`.
- **`dist/index.js`** exports the OpenCode plugin. It registers auth for `kilo-code`, fetches models from `GET /models`, and points each discovered model at `createKiloCode`.

The provider reads the API key from OpenCode's auth store at request time. No keys are stored in config files.

## Configuration Options

| Option | Required | Description |
|--------|----------|-------------|
| `organizationId` | No | Kilo organization id sent as `X-KiloCode-OrganizationId`. Required for org-scoped requests. |
| `defaultModel` | No | Sets `config.model` if no model is already configured. |
| `providerID` | No | Override the provider id (default: `kilo-code`). |
| `baseURL` | No | Override the Kilo gateway base URL (default: `https://api.kilo.ai/api/gateway`). |

## Development

This project uses [Bun](https://bun.sh) only. No npm.

```bash
bun install      # install deps
bun run check    # typecheck + test + build
bun test         # run tests
bun run build    # build dist/
bun run typecheck # typecheck only
```

## License

MIT
