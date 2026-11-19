# Support

## Where to ask

- **Usage and setup questions**: open a GitHub issue with the
  [question](https://github.com/DeliciousBuding/xunji-mcp/issues/new?template=bug_report.yml)
  template and describe your deployment shape.
- **Documentation or client compatibility**: open a feature request and name the
  client and transport you use.
- **Security issues**: do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## What to include

- The MCP client and how it connects (CIMD or DCR, browser flow or CLI).
- Whether `/authorize` is behind Cloudflare Access or uses the passphrase.
- The tool name and a redacted error code from the response.
- `npm run check` output if you are running from source.

Never include API keys, OAuth tokens, real training data, account identifiers or
private deployment hosts. Redact dates and weights if they are personal.

## What is not supported

- Multi-tenant deployments with several Xunji accounts in one Worker.
- Nutrition or body-data tools (separate vendor keys, not implemented).
- Recovery of deleted training data; the vendor exposes no delete API.
- Medical or training advice.
