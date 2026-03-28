# Contributing to mcp-google-ads

Thanks for your interest in contributing! This project is maintained by one person alongside client work, so please keep the following in mind.

## Response Times

- **Issues**: Triaged within 7 days. Fixes ship when ready — no promised cadence.
- **Pull Requests**: Reviewed within 1-2 weeks. Keep PRs small and focused.
- **Feature Requests**: Open an issue first to discuss. No guarantee of implementation.

## What Gets Accepted

**Yes:**
- Bug fixes with tests
- New read-only tools (reporting, listing)
- Documentation improvements
- Test coverage improvements

**Probably not:**
- Large architectural changes
- New dependencies without strong justification
- Features that significantly increase maintenance burden

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Run tests
npm test
```

## Before Submitting a PR

1. Run `npm run build` — must compile cleanly
2. Run `npm test` — all tests must pass
3. If adding a new tool, add it to the tool table in README.md
4. Keep commits focused — one logical change per PR

## API Version Changes

This MCP tracks the Google Ads API. When Google deprecates an API version, a new major version of this package will be released. If you notice an upcoming sunset, please open an issue.

## Code of Conduct

Be respectful. This is a small project maintained in spare time. Constructive feedback is welcome; demands are not.
