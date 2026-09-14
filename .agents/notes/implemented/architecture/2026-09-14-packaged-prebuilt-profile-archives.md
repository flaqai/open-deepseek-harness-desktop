# Agent Note: Package prebuilt desktop Profiles as verified archives

Status: implemented

English | [中文](2026-09-14-packaged-prebuilt-profile-archives.zh.md)

## Problem

The desktop release build prepares and verifies a complete native Profile so first launch does not depend on downloading preset plugins. Copying that Profile's dependency tree into the application resources exposes tens of thousands of small files to Electron Builder, signing tools, installers, and artifact upload. macOS signing can exhaust its file descriptor limit before it reaches the native files that require signatures, while every platform pays avoidable traversal and metadata costs.

## Decision

Each native CI runner installs the exact startup plugin set, signs native plugin resources where required, seals the relocatable Profile manifest, deploys it to a different temporary path, runs Profile diagnostics and Harness readiness, and removes one plugin offline. The runner then stores that verified directory as one uncompressed `desktop-prebuilt-<platform>-<arch>.tar` with a detached SHA-256 file. Electron Builder copies the archive, checksum, and the small preset plugin archive collection; it never copies the expanded prebuilt Profile.

The packaged host extracts the prebuilt archive only when first-start preparation needs it. It verifies the detached digest, accepts one expected platform root, rejects absolute paths, parent traversal, unsupported entry types, escaping links, excessive entry counts, and excessive expanded size, and extracts into a temporary sibling directory. The host validates the embedded Profile manifest before atomically publishing a versioned cache. Profile deployment still verifies every sealed file digest and relocates only the managed package metadata before replacing the active Profile.

macOS and Linux also carry the production Harness closure as an uncompressed archive and apply the same checksum, path, size, temporary extraction, and versioned-cache rules. Windows keeps its Harness and Node runtime expanded because the installed `dsh.cmd` command uses those stable application-resource paths; Windows packages only the prebuilt plugin Profile as an archive.

## Verification

Desktop unit tests cover expanded-runtime compatibility, cached runtimes, native archive-root selection, checksum failure, safe extraction, and Electron Builder resource mappings. Native package workflows build and verify each prebuilt Profile before archiving it, extract and redeploy the archive from the final application resources, then run the installed application smoke for the target platform. macOS and Windows smokes also inspect the final DMG, ZIP, or installer rather than accepting staging output.

## Alternatives considered

**Copy the expanded Profile and raise process limits.** Rejected because signing and packaging libraries can open the file tree independently of the shell limit, and the expanded representation keeps the same traversal cost in every downstream tool.

**Restore first-launch plugin installation from preset `.tgz` files.** Rejected because it moves package-manager work back to the user, lengthens first launch, and can fail after an installer has already passed release verification.

**Compress the inner archive.** Rejected because DMG, ZIP, NSIS, DEB, and RPM already compress their payloads. An uncompressed tar avoids duplicate compression work and favors fast sequential extraction while retaining one application resource.

**Archive the Windows Harness runtime too.** Rejected while the installed command-line wrapper depends on stable runtime paths inside the application directory. A future change can move that wrapper to a version-independent bootstrap before changing the Windows runtime layout.

## Consequences

Release builds still spend the time required to install and exercise every preset plugin on each native platform, but packaging and signing see one Profile archive instead of its complete dependency tree. A first-start deployment performs one local extraction before copying the verified Profile into the selected data directory. Corrupt or unsafe archives fail without replacing a valid cache or active Profile. The application stores versioned extracted caches in desktop user data, so a new desktop version does not trust an older release's template.
