# Official alpha.3 integration and NAS device roles

## Scope and baselines

- Upstream is fixed at `dsh-v0.2.1-alpha.3`; the parent community baseline is preserved by
  `backup/pre-upstream-0.2.1-alpha.3`. The risk report was committed separately before integration.
- The integration branch is `merge/upstream-0.2.1-alpha.3`.
- Core packages follow alpha.3. The community Desktop release remains `0.2.1-alpha.2`.
- This work does not create release tags, installers, or public releases.

The [conflict ledger](2026-10-15-alpha3-conflict-ledger.json) records 167 initial conflict paths.
Its automatic-overlap review covers another 169 paths changed by both parents.
Static review and focused tests are distinct from native or cross-platform qualification.

## NAS permissions and migration

| Capability | Admin | User | Readonly |
|---|---|---|---|
| Shared history and allowed workspace files | Yes | Yes | Yes |
| New chats, prompts, uploads and ordinary questions | Yes | Yes | No |
| Stop own active task | Yes | Yes | No |
| Dangerous approval, credentials, plugins and configuration | Yes | No | No |
| Permanent deletion and raw session-log export | Yes | No | No |

Roles come from server-owned device records, never a client assertion. Each device has its own Peer.
Non-admin operations use explicit action and resource bindings; unclassified RPC and raw plugin routes are denied.
The WebServer guard covers named HTTP routes, fallback dispatch and upgrade handlers, including startup before admission exists.
The exact Gateway multiplex path still applies live admission and per-resource checks.
Readonly UI restrictions supplement server authorization, not replace it.

File access resolves canonical paths against registered shared workspaces and denies sensitive control files, the Harness
data directory and escaping symlinks. Local-owner behavior remains separate. Native Desktop IPC is not a NAS admin API.
Shared history is not private per-user storage; these roles are product authorization, not an OS sandbox for hostile tools.

Legacy device records migrate to administrators with a backup and atomic write, preserving identity and grants.
Invitations bind a server-selected role and are consumed once. Role changes, revocation and expiry invalidate live Peers.
Removing the last active administrator is refused. Trusted server-local recovery is available through
`dsh nas-admin-recovery`; there is no remote elevation endpoint.
See the [NAS deployment guide](../deploy/nas/README.md) for concrete pairing and recovery instructions.

## Community behavior and configuration

The community shell, diagnostics, candidate rollback, external writer wait, market-confirmed restart, mobile navigation,
archive page, model search, custom instructions, approval explanation/language and team onboarding remain integrated.
Resident Harness processes do not inherit candidate transaction delegation. A market `restartReason` is not restart consent.
Python and Office deployment policy is unchanged. SSH helper, Worker and persistent Node PTC resources are explicitly checked.

Configuration conversion backs up changed input and only converts provably equivalent fields. Unsupported model customization
and legacy persona/tool-filter values retain their original configuration and produce actionable diagnostics.
`--from-default-profile` has replacement semantics, not a lossless import guarantee.

Historical community event fixes are retained. NAS source attribution is documented by the
[same-version persistence review](../docs/persistence-changes/2026-10-15-nas-device-principal.md).
Saved principals are historical metadata, not live permission grants. No frozen historical format is rewritten.
The known v0 `summary requires notice form` refusal is deliberately unchanged.

## Preinstalled plugins

The [compatibility inventory](2026-10-15-alpha3-preset-compatibility.json) records archive versions, sources,
integrities and static API findings. The new preset has nine production entries.
Smooth-stream is excluded from the new preset because reviewed published versions reference the removed ImageGallery API;
the examined prerelease fallback does not establish working image rendering. Existing user installations and archived packages
are not deleted, and no third-party source is patched.
Installation, Host activation and real renderer activation are separate evidence levels.

## Validation evidence

- `build:artifacts --profile community-desktop`: six gates passed; 337 client artifacts recorded.
- `build:check`: Host and Client aggregate checks passed. Desktop typecheck and `build:desktop` passed.
- Full repository lint passed. `doc-sync`: all 43 gates passed.
- Desktop tests: 117 files passed, one file skipped; 834 tests passed and two skipped under existing rules.
- Focused NAS permissions, file access and current-format restoration: six files, 51 tests passed.
- Gateway stream suite: 51 tests passed, including real NAS WebSocket admission and restricted unknown-stream denial.
- Real workspace-file watcher suite: 43 tests passed in an independent run with native host permissions.
- Desktop smoke orchestration: 12 Node tests passed, including failure evidence and teardown contracts.
- External-tool compatibility: reviewed alpha.3 Codex and Claude provider archives passed identity/integrity verification.
- New macOS arm64 runtime/Profile preparation passed after fixing missing SSH resource closure.
  Preparation took 384.01 seconds; 21,879 Profile resources were sealed, relocated startup and client HTTP passed,
  and warm-cache offline removal passed. This does not qualify cold-cache offline plugin installation.
- Bundled Python imports and pip consistency passed. The current Office engine performed native DOCX-to-PDF conversion.
- A separate Chinese/space-path probe verified exact installed versions and nine active Host plugin fibers on both starts.
  Profile doctor reported healthy with zero conflicts, issues or quarantined entries.
  New native-probe Profile deployment took 12.310 seconds; subsequent idempotent deployment took 6.927 seconds.
  Headless first/second starts took 1.888/1.399 seconds; a Chinese-name Office conversion took 6.358 seconds.
  These are different phases, not an older-release performance comparison.
- Rebuilding after the final peer-dependency declarations took 226.81 seconds and sealed 21,879 resources.
  The final fresh deployment took 10.913 seconds; first/second starts took 3.619/1.914 seconds.
  Final installed versions and nine active Host fibers matched again; both HTTP checks returned 200 and doctor remained healthy.
  Final Office conversion took 5.471 seconds and produced a validated 21,707-byte PDF with an empty system PATH.
  Earlier phase measurements above remain historical observations, not final artifact identities or size comparisons.
- Native Electron received both renderer readiness phases, retained a populated application without a plugin-failure screen,
  stayed alive another 15 seconds and shut down Harness normally. A second isolated application-data run also passed.
  The first native attempt timed out waiting at the credential-free first-run welcome screen, not a renderer crash.
  Final native accessibility inspection confirmed that welcome screen; closing it entered the shared workspace normally.
  The failed unattended attempt is retained and not counted as a pass. No credential was entered and no product fix was needed.
  The [native evidence](2026-10-15-alpha3-native-evidence.json) records 80 client entries, including eight third-party Loader plugins.
  No optional client activation failure was emitted. Whale's Host-injected widget and controls were visible in native accessibility;
  its balance remained unavailable without credentials, as expected. External-service plugin functions are not claimed tested.

The resource archives are test/build inputs, not installers; their uncompressed sizes are not installer-size estimates.
Original failed checks were corrected and rerun rather than bypassed.

## Qualification boundaries

Windows, Linux, another macOS architecture, real NAS Docker deployment and final installers remain unqualified here.
No Playwright, `test:web`, browser replay, real user conversation or production credential was used.
This integration is not a declaration that three-platform release packages are ready.
