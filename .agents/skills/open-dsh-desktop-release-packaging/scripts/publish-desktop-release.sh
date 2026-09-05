#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 [--publish] <owner/repo> <source-sha> <tag> <title> <notes-file> <release-directory>" >&2
  exit 2
}

publish=0
if [[ ${1:-} == --publish ]]; then
  publish=1
  shift
fi
[[ $# -eq 6 ]] || usage

repository=$1
source_sha=$2
tag=$3
title=$4
notes_file=$5
release_directory=$6
script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
version=$(basename "$release_directory")
expected_tag="odsh-v$version"
installers=(
  DeepSeek-Harness-linux-x64.deb
  DeepSeek-Harness-linux-x64.rpm
  DeepSeek-Harness-macos-arm64.dmg
  DeepSeek-Harness-macos-arm64.zip
  DeepSeek-Harness-macos-x64.dmg
  DeepSeek-Harness-macos-x64.zip
  DeepSeek-Harness-windows-x64.exe
)
assets=("${installers[@]}" SHA256SUMS)

for command_name in gh shasum wc awk; do
  command -v "$command_name" >/dev/null || { echo "missing command: $command_name" >&2; exit 1; }
done
[[ "$repository" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]] || { echo "invalid repository: $repository" >&2; exit 1; }
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || { echo "source SHA must be a full lowercase 40-character commit: $source_sha" >&2; exit 1; }
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || { echo "invalid release directory version: $version" >&2; exit 1; }
[[ "$tag" == "$expected_tag" ]] || { echo "tag $tag does not match release directory version $version" >&2; exit 1; }
[[ -n "$title" ]] || { echo "Release title must not be empty" >&2; exit 1; }
[[ -f "$notes_file" && -s "$notes_file" && ! -L "$notes_file" ]] || { echo "notes file must be a non-empty regular file: $notes_file" >&2; exit 1; }

"$script_directory/verify-release-directory.sh" "$release_directory"

remote_sha=$(gh api "repos/$repository/commits/$source_sha" --jq .sha)
[[ "$remote_sha" == "$source_sha" ]] || { echo "remote commit does not match $source_sha" >&2; exit 1; }

ensure_repository_access() {
  gh api "repos/$repository" --silent
}

read_tag_target() {
  local ref_sha ref_type
  if ! ref_sha=$(gh api "repos/$repository/git/ref/tags/$tag" --jq .object.sha); then return 1; fi
  if ! ref_type=$(gh api "repos/$repository/git/ref/tags/$tag" --jq .object.type); then return 1; fi
  if [[ "$ref_type" == tag ]]; then
    gh api "repos/$repository/git/tags/$ref_sha" --jq .object.sha
  else
    printf '%s\n' "$ref_sha"
  fi
}

tag_exists=0
if tag_sha=$(read_tag_target 2>/dev/null); then
  tag_exists=1
  [[ "$tag_sha" == "$source_sha" ]] || { echo "remote tag $tag points to $tag_sha, expected $source_sha" >&2; exit 1; }
else
  ensure_repository_access
fi

if gh release view "$tag" -R "$repository" >/dev/null 2>&1; then
  echo "refusing to update existing Release: $tag" >&2
  exit 1
else
  ensure_repository_access
fi

prerelease=0
case "$version" in *-*) prerelease=1 ;; esac

echo "Release publication plan"
printf '  repository: %s\n  source SHA: %s\n  tag: %s\n  title: %s\n  notes: %s\n  assets:\n' \
  "$repository" "$source_sha" "$tag" "$title" "$notes_file"
for filename in "${assets[@]}"; do
  printf '    %s  %s\n' "$(shasum -a 256 "$release_directory/$filename" | awk '{ print $1 }')" "$release_directory/$filename"
done
if [[ $publish -eq 0 ]]; then
  echo "validation complete; no tag, asset, or Release was created"
  exit 0
fi

create_args=(release create "$tag")
for filename in "${assets[@]}"; do create_args+=("$release_directory/$filename"); done
create_args+=(-R "$repository" --title "$title" --notes-file "$notes_file")
if [[ $tag_exists -eq 1 ]]; then create_args+=(--verify-tag)
else create_args+=(--target "$source_sha")
fi
if [[ $prerelease -eq 1 ]]; then create_args+=(--prerelease --latest=false)
else create_args+=(--latest)
fi

if ! gh "${create_args[@]}"; then
  if draft_url=$(gh release view "$tag" -R "$repository" --json isDraft,url --jq 'select(.isDraft) | .url' 2>/dev/null) && [[ -n "$draft_url" ]]; then
    echo "publication failed and GitHub retained a Draft; no automatic cleanup was attempted: $draft_url" >&2
  fi
  exit 1
fi

published_sha=$(read_tag_target)
[[ "$published_sha" == "$source_sha" ]] || { echo "published tag target mismatch: $published_sha" >&2; exit 1; }
release_state=$(gh release view "$tag" -R "$repository" --json isDraft,isPrerelease,name,url \
  --jq '[.isDraft, .isPrerelease, .name, .url] | @tsv')
IFS=$'\t' read -r is_draft is_prerelease published_title release_url <<< "$release_state"
[[ "$is_draft" == false ]] || { echo "Release is still a Draft: $release_url" >&2; exit 1; }
[[ "$published_title" == "$title" ]] || { echo "Release title mismatch" >&2; exit 1; }
expected_prerelease=false
if [[ $prerelease -eq 1 ]]; then expected_prerelease=true; fi
[[ "$is_prerelease" == "$expected_prerelease" ]] || { echo "Release prerelease state mismatch" >&2; exit 1; }

remote_assets=$(mktemp "${TMPDIR:-/tmp}/odsh-release-assets.XXXXXX")
cleanup() { rm -f "$remote_assets"; }
trap cleanup EXIT
gh release view "$tag" -R "$repository" --json assets \
  --jq '.assets[] | [.name, (.size | tostring), .digest] | @tsv' > "$remote_assets"
[[ $(wc -l < "$remote_assets" | tr -d ' ') == 8 ]] || { echo "published Release does not contain exactly eight uploaded assets" >&2; exit 1; }
for filename in "${assets[@]}"; do
  expected_hash=$(shasum -a 256 "$release_directory/$filename" | awk '{ print $1 }')
  expected_size=$(wc -c < "$release_directory/$filename" | tr -d ' ')
  matches=$(awk -F '\t' -v name="$filename" -v size="$expected_size" -v digest="sha256:$expected_hash" \
    '$1 == name && $2 == size && $3 == digest { count++ } END { print count + 0 }' "$remote_assets")
  [[ "$matches" == 1 ]] || { echo "remote asset identity mismatch for $filename" >&2; exit 1; }
  echo "$filename: remote SHA-256 and size OK"
done
if [[ $prerelease -eq 0 ]]; then
  latest_tag=$(gh api "repos/$repository/releases/latest" --jq .tag_name)
  [[ "$latest_tag" == "$tag" ]] || { echo "stable Release is not marked Latest" >&2; exit 1; }
fi
echo "published verified Release: $release_url"
