# Support

[English](SUPPORT.md) | [简体中文](SUPPORT.zh-CN.md)

## Where to ask

- Usage and setup questions: [open an issue](https://github.com/DeliciousBuding/xunji-mcp/issues/new/choose)
  and describe your deployment shape. There is no dedicated question template.
- Unexpected behaviour: use the [bug report template](https://github.com/DeliciousBuding/xunji-mcp/issues/new?template=bug_report.md).
- Capability requests or documentation improvements: use the
  [feature request template](https://github.com/DeliciousBuding/xunji-mcp/issues/new?template=feature_request.md).
- Vulnerabilities or sensitive disclosures: follow [Security](SECURITY.md)
  through a private report.

## What to include

- The bridge version/tag, MCP client and transport.
- Registration mode if known (CIMD or DCR), and browser or CLI authorization.
- Whether `/authorize` uses Cloudflare Access or a passphrase; whether writes,
  the index or the optional UI are enabled.
- The tool name, redacted error code and a synthetic reproduction.
- Checks you actually ran, with their scope. For source changes, `npm run check`
  is the local check suite.

Exclude API keys, OAuth tokens, real records or aggregates, account identifiers,
emails, private hosts and deployment IDs. Replace personal dates, weights and
counts with synthetic examples before sharing logs or screenshots.

## Capability and support boundaries

One Worker serves one Xunji account. Multi-tenant deployments, recovery of
deleted source records and medical/training advice are outside the project's
scope.

Body measurements, food records and food search have optional adapters. Their
matching secrets (`XUNJI_BODY_KEY`, `XUNJI_FOOD_KEY`, `XUNJI_FOOD_SEARCH_KEY`)
and domain configuration are required before registration. They remain
unverified against live upstream; check `xunji_capabilities` and the
[verification record](docs/acceptance.md) before assuming availability.

The MCP Apps overview is optional and disabled by default. Resource
registration has historical verification, but real ChatGPT rendering remains a
client-side pending item. Include the client/version when reporting UI issues.

Training writes are real, disabled by default, and require `xunji:write` plus
`confirmed: true`. There is no dry run or delete tool. Correct an existing
session with `localid`, or manage records in the Xunji app.

Operators manage keys, grants, backups and cleanup. Key rotation still needs
operator confirmation. See [Privacy](PRIVACY.md) for retained data and
[Deployment](docs/deployment.md) for instance setup.
