# pnpm proxy-policy A/B test

English | [中文](GUIDE.zh.md)

## Summary

Compare broad ChatGPT-proxy inheritance with Codex-only inheritance using the same Node and pnpm binaries. This tests package downloads, not two Desktop builds or complete plugin activation. The default fixture uses a real pnpm process and local HTTP servers; it deliberately rejects requests through the simulated wrong proxy. Its success-rate gain is not an Internet speed measurement.

## Table of Contents

- [Run locally](#run-locally)
- [macOS one-click run](#macos-one-click-run)
- [Windows](#windows)
- [Live network comparison](#live-network-comparison)
- [Read the report](#read-the-report)
- [Safety and limits](#safety-and-limits)

## Run locally

From the repository root with Node 24.11.1 and the checkout's desktop pnpm installed:

```sh
node apps/desktop/scripts/proxy-ab/benchmark.mjs --rounds 10 --output .local-user-errors/releases/v0.1.2-alpha.5/proxy-ab
```

The script alternates before/after order each round. Cold attempts have separate empty stores and metadata caches. Each warm attempt receives its own untimed successful preparation without the simulated wrong route. A failed preparation stops comparison rather than treating an empty cache as warm. The fixture requires IPv4-mapped IPv6 loopback support; unsupported hosts receive a failed/incomplete report, not an improvement claim.

## macOS one-click run

Extract the portable ZIP and double-click [run-macos.command](run-macos.command), keeping [benchmark.mjs](benchmark.mjs) beside it. The launcher matches the installed app version in `/Applications` or `~/Applications` to its extracted runtime. Launch the installed client once beforehand. It does not download a runtime or select an unrelated cached version. The default run uses the offline fixture, ten rounds, and both cache modes; it opens the reports folder afterward and waits for Return before closing the terminal.

Reports are saved beside the script in `proxy-ab-reports/run-*`. For a custom app location use `--app '/path/Open DeepSeek Harness Desktop.app'`; for an extracted runtime use `--runtime '/path/containing-package-runtime'`. The launcher forwards `--mode`, `--rounds`, `--cache`, and `--system-proxy` to the benchmark. `--output` selects the report folder; `--no-open --no-pause` disables Finder opening and the terminal pause for automated runs. Paths with spaces or non-ASCII characters must be quoted. If macOS blocks execution, inspect the script and use the system's per-file Open action; do not disable system security protections.

## Windows

Keep [benchmark.mjs](benchmark.mjs) and [run-windows.ps1](run-windows.ps1) in the same folder. Supply the installed client's actual Node executable and pnpm entry file; the script does not guess an installation path. It requires no rebuild, Administrator access, or pnpm source patch. Native Windows execution remains to be verified by the affected-machine operator; the example below uses placeholder paths.

```powershell
.\run-windows.ps1 -NodePath 'C:\path-to-runtime\node.exe' -PnpmPath 'C:\path-to-pnpm\bin\pnpm.mjs' -Rounds 10
```

PowerShell 5.1/7 can invoke this wrapper. If local policy blocks unsigned scripts, use the equivalent Node command with `--node` and `--pnpm` instead; do not weaken the machine's execution policy. Reports go into a new `proxy-ab-reports/run-*` directory unless `-OutputDirectory` is supplied.

## Live network comparison

```sh
node apps/desktop/scripts/proxy-ab/benchmark.mjs --mode live --rounds 3 --output .local-user-errors/releases/v0.1.2-alpha.5/proxy-ab
```

Live mode downloads only the fixed public package `is-number@7.0.0`, including metadata and archive, from npm. This dependency-free probe exercises pnpm's network path, not Harness plugin installation. `--system-proxy` accepts the credential-free ChatGPT proxy origin being investigated, or `DIRECT`; Windows uses `-Mode live -SystemProxy 'http://proxy-host:port'`. This is an explicit test input, not automatic PAC discovery. Do not guess a proxy port. Explicit inherited proxy variables take precedence in both variants, so those environments may produce no routing difference.

Without a proxy argument, live mode is a direct-policy baseline. Keep network, runtime files, and arguments identical across machines being compared. Do not benchmark during other downloads. Three rounds are a smoke test, not a statistically reliable performance estimate; use more rounds for a stable comparison.

## Read the report

Each run writes `report.json` and `summary.md`, containing Node/pnpm versions, the pnpm entry and implementation SHA-256 hashes, individual timings, error codes, exit signals, deadline/cancellation flags, installed-manifest verification, and cleanup results. No raw subprocess output, proxy address, environment values, or local user paths are stored. The console prints the local report location.

Success requires a normal zero exit and a separately read matching installed manifest. Cold fixture verification additionally requires observed proxy requests for failed before attempts and metadata/archive requests without proxy requests for successful after attempts. Cached installs can succeed even when pnpm emits a network warning; both facts remain in the report.

Success-rate change is reported in percentage points. Speed comparisons include only matching rounds where both variants succeeded. No paired successes means `null`/`N/A`, not an invented speed-up. Inspect `completed`, `runnerError`, `fixtureVerified`, `cleanup`, and `listenersClosed` before interpreting a report. Expected fixture failures do not themselves make the benchmark fail; a violated fixture assertion, runner failure, or cleanup failure returns nonzero.

## Safety and limits

The script isolates HOME, DSH_HOME, configuration, cache, and store under a newly allocated temporary directory. It ignores user `.npmrc`, forwards only selected system/proxy/CA variables in live mode, disables lifecycle scripts and pnpmfile loading, and never modifies the installed pnpm or real Profile. It does not validate private registry credentials, Git downloads, Codex connectivity, PAC discovery, or proxy authentication. Live mode intentionally does not reproduce every user configuration.

Each measured command has a 20-second deadline and a 5-second fetch timeout with retries disabled. Ctrl+C requests cancellation, waits for the owned child to close, closes the local servers, removes temporary data, and writes the partial report. Forced process termination or power loss can leave an `odsh-proxy-ab-*` directory in the operating system temporary directory; it never becomes a real Profile. Cleanup errors preserve the local location for manual inspection.

## Dev Note

The policy adapter is intentionally distributable without the repository. Its after-policy parity test imports the current desktop resolver so source drift is detectable. See the [proxy scope decision](../../../../.agents/notes/implemented/bug-fix/2026-09-03-desktop-codex-proxy-scope.md).
