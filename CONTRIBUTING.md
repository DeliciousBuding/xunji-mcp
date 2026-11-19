# Contributing

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

Contributions should solve a concrete bridge, contract or documentation
problem. Keep the single-account design and the Xunji source of truth intact.
Community participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ground rules

- No real training data, API keys, tokens, domains, emails or account ids in
  code, tests, fixtures, docs, screenshots or commit history. Use synthetic
  fixtures and `example.com`.
- Do not invent upstream endpoints or fields. If the vendor contract is unclear,
  mark it unverified rather than guessing.
- Training writes stay disabled by default and require `WRITE_TOOLS_ENABLED=true`,
  `xunji:write` and `confirmed: true`. The vendor ignores `dry_run`; the bridge
  must never send it or claim preview safety. Do not add a delete tool.
- Optional body/food adapters require separate vendor keys and enabled domains.
  Keep implementation/configuration separate from live verification.
- Security-relevant changes need rejection-path tests, not just happy paths.

## Development

```bash
npm ci
cp wrangler.example.jsonc wrangler.jsonc
npm run cf-typegen
npm run typecheck
npm test
node scripts/secret-scan.mjs --history
```

Use Node 20+ and the lockfile's dependencies. Keep instance configuration
private. Set `PRIVATE_DOMAIN` to your deployment's domain when scanning locally
so the scanner can flag it without hardcoding a personal hostname.

Tests run inside workerd through `@cloudflare/vitest-pool-workers`. Upstream
HTTP is stubbed; no test touches a real Xunji account.

`npm run check` also runs lint and formatting checks. For a documentation-only
change, format the changed Markdown and check its links; report only the checks
you ran. Do not run production probes to validate prose.

## Pull requests

- One topic per PR.
- Describe the user-visible result and actual validation scope, including
  pending operator/client work.
- Update affected public docs, the acceptance record and changelog when
  behaviour, limits, scopes or storage change.
- Keep English and `.zh-CN.md` documents complete and aligned, with language
  navigation and translated links where available.
- CI checks typecheck, lint, formatting, tests, secret patterns and runtime
  dependency audit. Historical acceptance entries are not new test results.
- Preserve existing release tags. Release bodies must describe the tagged
  source, not later commits.

## Reporting issues

See [Support](SUPPORT.md) for issue templates and the information to include.
Use the private channel in [Security](SECURITY.md) for vulnerabilities.
