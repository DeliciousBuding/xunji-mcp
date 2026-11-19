# Contributing

Thanks for taking a look. This project is small on purpose; changes that add
surface area need a reason.

## Ground rules

- No real training data, API keys, tokens, domains, emails or account ids in
  code, tests, fixtures, docs, screenshots or commit history. Use synthetic
  fixtures and `example.com`.
- Do not invent upstream endpoints or fields. If the vendor contract is unclear,
  mark it unverified rather than guessing.
- Writes must stay opt-in and must never claim a dry run: the vendor ignores
  `dry_run`.
- Security-relevant changes need rejection-path tests, not just happy paths.

## Development

```bash
npm install
npm run typecheck
npm test
```

Tests run inside workerd through `@cloudflare/vitest-pool-workers`. Upstream
HTTP is stubbed; no test touches a real Xunji account.

## Pull requests

- One topic per PR.
- Describe the user-visible behavior and how you verified it.
- Update `docs/` when behavior, limits or scopes change.
- CI must pass: typecheck, tests, secret scan, dependency audit.

## Reporting issues

Use the issue templates. For vulnerabilities, follow [SECURITY.md](SECURITY.md)
instead of opening a public issue.
