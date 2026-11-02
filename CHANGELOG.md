# Changelog

All notable changes to this repository are documented here.

## [0.1.0] - 2026-11-03

### Added

- `@inlve/dsh-web-fetch-clash` 0.1.0
  - Fake-IP aware `web.fetch` provider (`clash-dns`) for Clash / Mihomo TUN environments
  - System-first resolution so Windows Hosts entries keep working
  - Clash `/dns/query` verification with public-unicast validation and connection pinning
  - `connect: fake | real` transport selection
  - Per-host verification cache (`cacheTtlMs`) with failure invalidation
  - Explicit LAN allowlist (`lanCidrs`)
  - Unit tests and GitHub Actions syntax/unit check workflow
