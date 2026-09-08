# Vendored from rust-ui

Source: <https://github.com/rust-ui/ui> — MIT, (c) 2026 Max Wells.
Upstream commit: 0c6b79e04a3ddc5fb9997e8cd9d9c8a6d9cbba9b (`main`).
Upstream licence retained verbatim at `LICENSE.rust-ui`.

`crates/{registry,icons,leptos_ui,tw_merge,autoform}` and `style/` are copies of
upstream. They are kept as close to byte-identical as possible so components,
typography, icons and the oklch palette stay exact — that was the explicit
requirement. Re-vendoring is therefore a copy, not a merge.

## Local patches

Everything that differs from upstream is listed here. Keep this list complete;
an undocumented edit is indistinguishable from upstream behaviour when the next
person re-vendors.

### 1. `MatchNestedRoutes` import in 7 sidenav blocks

Files: `src/blocks/sidenav0{1..7}.rs`

Added `use leptos_router::MatchNestedRoutes;`.

Upstream returns `impl MatchNestedRoutes + Clone` without importing the trait.
It builds there because the upstream app crate is compiled by cargo-leptos with
a router configuration that brings the trait into scope; under a plain Trunk CSR
build it is not, and the files fail with E0405.

`sidenav08..11` and `sidenav_routes_simplified.rs` already import the trait in a
braced group and are untouched.

## Deliberately not vendored

- `app/`, `server/`, `e2e/`, `src-tauri/`, `dioxus-ui/` — upstream's own site and
  shells; RUST-APP has its own.
- `crates/ui-cli` — the `ui add <component>` CLI. We vendor the whole registry
  instead, so there is nothing to fetch at build time.
- `crates/_markdown_crate` — not needed until chat prose rendering (Phase 2).
