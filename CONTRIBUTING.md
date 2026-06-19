# Contributing

Contributions are welcome. This project uses [Bun](https://bun.sh) only, no npm.

## Setup

```bash
git clone https://github.com/sachitv/opencode-kilo-code-provider.git
cd opencode-kilo-code-provider
bun install
```

## Development Commands

```bash
bun run check     # typecheck + tests + build (run before pushing)
bun test         # run tests only
bun run typecheck # TypeScript type checking only
bun run build     # build dist/ output
```

## Installing Locally for Testing

### Option 1: Local file:// reference

Build the package and reference it directly in your OpenCode config:

```bash
bun run build
```

In `~/.config/opencode/opencode.json`:

```jsonc
{
  "plugin": [
    [
      "file:///absolute/path/to/opencode-kilo-code-provider/dist/index.js",
      {
        "organizationId": "your_org_id"
      }
    ]
  ]
}
```

Restart OpenCode after changing the config.

### Option 2: From npm (published release)

```bash
bun add @sachitv/opencode-kilo-code-provider
```

```jsonc
{
  "plugin": [
    ["@sachitv/opencode-kilo-code-provider", { "organizationId": "your_org_id" }]
  ]
}
```

## Pull Request Checklist

- `bun run check` passes (typecheck + tests + build)
- No secrets, API keys, or credentials in code or config
- Tests cover new functionality
- README updated if user-facing behavior changed

## Releasing

Releases are published automatically via GitHub Actions on tag push:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The CI workflow builds, verifies, and publishes to npm. An `NPM_TOKEN` secret must be set in the GitHub repository settings.
