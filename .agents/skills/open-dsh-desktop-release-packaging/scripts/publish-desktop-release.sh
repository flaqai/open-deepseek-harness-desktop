#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 [--publish] [--resume-draft] --release-state <stable|prerelease> <owner/repo> <source-sha> <tag> <title> <notes-file> <release-directory>" >&2
  exit 2
}

publish=0
resume_draft=0
release_state=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish)
      publish=1
      shift
      ;;
    --resume-draft)
      resume_draft=1
      shift
      ;;
    --release-state)
      [[ $# -ge 2 ]] || usage
      release_state=$2
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -*) usage ;;
    *) break ;;
  esac
done
[[ $# -eq 6 ]] || usage
[[ "$release_state" == stable || "$release_state" == prerelease ]] || usage

repository=$1
source_sha=$2
tag=$3
title=$4
notes_file=$5
release_directory=$6
script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$script_directory/configure-cli-proxy.sh"
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
  DeepSeek-Harness-windows-x64.zip
)
assets=("${installers[@]}" SHA256SUMS)

asset_path() {
  local filename=$1
  printf '%s/%s\n' "$release_directory" "$filename"
}

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

prerelease=0
if [[ "$release_state" == prerelease ]]; then prerelease=1; fi
expected_prerelease=false
if [[ $prerelease -eq 1 ]]; then expected_prerelease=true; fi

existing_release=0
existing_release_state=
if existing_release_state=$(gh release view "$tag" -R "$repository" --json isDraft,isPrerelease,name,url \
  --jq '[.isDraft, .isPrerelease, .name, .url] | @tsv' 2>/dev/null); then
  existing_release=1
  IFS=$'\t' read -r existing_is_draft existing_is_prerelease existing_title existing_url <<< "$existing_release_state"
  [[ "$existing_is_draft" == true ]] || { echo "refusing to update existing published Release: $tag" >&2; exit 1; }
  [[ $resume_draft -eq 1 ]] || {
    echo "matching Draft exists; inspect it, then rerun with --resume-draft to upload only missing verified assets: $existing_url" >&2
    exit 1
  }
  [[ "$existing_is_prerelease" == "$expected_prerelease" ]] || { echo "existing Draft prerelease state mismatch" >&2; exit 1; }
  [[ "$existing_title" == "$title" ]] || { echo "existing Draft title mismatch" >&2; exit 1; }
else
  ensure_repository_access
  [[ $resume_draft -eq 0 ]] || { echo "--resume-draft requires an existing matching Draft: $tag" >&2; exit 1; }
fi

echo "Release publication plan"
printf '  repository: %s\n  source SHA: %s\n  tag: %s\n  title: %s\n  release state: %s\n  notes: %s\n  assets:\n' \
  "$repository" "$source_sha" "$tag" "$title" "$release_state" "$notes_file"
for filename in "${assets[@]}"; do
  path=$(asset_path "$filename")
  printf '    %s  %s\n' "$(shasum -a 256 "$path" | awk '{ print $1 }')" "$path"
done
if [[ $existing_release -eq 1 ]]; then printf '  recovery: resume verified Draft %s\n' "$existing_url"; fi
if [[ $existing_release -eq 1 ]]; then
  draft_assets=$(gh release view "$tag" -R "$repository" --json assets \
    --jq '.assets[] | [.name, (.size | tostring), .digest] | @tsv')
  matching_assets=0
  missing_assets=0
  while IFS=$'\t' read -r remote_name _; do
    [[ -z "$remote_name" ]] && continue
    expected=0
    for filename in "${assets[@]}"; do [[ "$remote_name" == "$filename" ]] && expected=1; done
    [[ $expected -eq 1 ]] || { echo "Draft contains an unexpected asset: $remote_name" >&2; exit 1; }
  done <<< "$draft_assets"
  for filename in "${assets[@]}"; do
    path=$(asset_path "$filename")
    expected_hash=$(shasum -a 256 "$path" | awk '{ print $1 }')
    expected_size=$(wc -c < "$path" | tr -d ' ')
    named=$(awk -F '\t' -v name="$filename" '$1 == name { count++ } END { print count + 0 }' <<< "$draft_assets")
    matches=$(awk -F '\t' -v name="$filename" -v size="$expected_size" -v digest="sha256:$expected_hash" \
      '$1 == name && $2 == size && $3 == digest { count++ } END { print count + 0 }' <<< "$draft_assets")
    [[ "$named" -le 1 ]] || { echo "Draft contains duplicate assets named $filename" >&2; exit 1; }
    [[ "$named" == 0 || "$matches" == 1 ]] || { echo "Draft asset identity mismatch for $filename; refusing to clobber it" >&2; exit 1; }
    if [[ "$matches" == 1 ]]; then matching_assets=$((matching_assets + 1)); else missing_assets=$((missing_assets + 1)); fi
  done
  printf '  Draft assets: %s matching, %s missing\n' "$matching_assets" "$missing_assets"
fi
if [[ $publish -eq 0 ]]; then
  echo "validation complete; no tag, asset, Draft, or Release was created or changed"
  exit 0
fi

if [[ $existing_release -eq 0 ]]; then
  create_args=(release create "$tag" -R "$repository" --draft --title "$title" --notes-file "$notes_file")
  if [[ $tag_exists -eq 1 ]]; then create_args+=(--verify-tag)
  else create_args+=(--target "$source_sha")
  fi
  if [[ $prerelease -eq 1 ]]; then create_args+=(--prerelease --latest=false); fi
  echo "creating GitHub Draft for $tag"
  gh "${create_args[@]}"
fi

remote_assets=$(mktemp "${TMPDIR:-/tmp}/odsh-release-assets.XXXXXX")
cleanup() { rm -f "$remote_assets"; }
trap cleanup EXIT

refresh_remote_assets() {
  gh release view "$tag" -R "$repository" --json assets \
    --jq '.assets[] | [.name, (.size | tostring), .digest] | @tsv' > "$remote_assets"
}

report_retained_draft() {
  local draft_url
  if draft_url=$(gh release view "$tag" -R "$repository" --json isDraft,url --jq 'select(.isDraft) | .url' 2>/dev/null) && [[ -n "$draft_url" ]]; then
    echo "GitHub retained the Draft; rerun the reviewed command with --resume-draft: $draft_url" >&2
  fi
}

refresh_remote_assets
while IFS=$'\t' read -r remote_name _; do
  [[ -z "$remote_name" ]] && continue
  expected=0
  for filename in "${assets[@]}"; do [[ "$remote_name" == "$filename" ]] && expected=1; done
  [[ $expected -eq 1 ]] || { echo "Draft contains an unexpected asset: $remote_name" >&2; exit 1; }
done < "$remote_assets"

for filename in "${assets[@]}"; do
  path=$(asset_path "$filename")
  expected_hash=$(shasum -a 256 "$path" | awk '{ print $1 }')
  expected_size=$(wc -c < "$path" | tr -d ' ')
  named=$(awk -F '\t' -v name="$filename" '$1 == name { count++ } END { print count + 0 }' "$remote_assets")
  matches=$(awk -F '\t' -v name="$filename" -v size="$expected_size" -v digest="sha256:$expected_hash" \
    '$1 == name && $2 == size && $3 == digest { count++ } END { print count + 0 }' "$remote_assets")
  [[ "$named" -le 1 ]] || { echo "Draft contains duplicate assets named $filename" >&2; exit 1; }
  if [[ "$matches" == 1 ]]; then
    echo "$filename: already uploaded with matching SHA-256 and size"
    continue
  fi
  [[ "$named" == 0 ]] || { echo "Draft asset identity mismatch for $filename; refusing to clobber it" >&2; exit 1; }
  started_at=$(date +%s)
  echo "$filename: upload started"
  if ! gh release upload "$tag" "$path" -R "$repository"; then
    report_retained_draft
    exit 1
  fi
  refresh_remote_assets
  matches=$(awk -F '\t' -v name="$filename" -v size="$expected_size" -v digest="sha256:$expected_hash" \
    '$1 == name && $2 == size && $3 == digest { count++ } END { print count + 0 }' "$remote_assets")
  [[ "$matches" == 1 ]] || { echo "uploaded asset identity mismatch for $filename" >&2; report_retained_draft; exit 1; }
  elapsed=$(( $(date +%s) - started_at ))
  echo "$filename: upload verified in ${elapsed}s"
done
[[ $(wc -l < "$remote_assets" | tr -d ' ') == ${#assets[@]} ]] || { echo "Draft does not contain exactly ${#assets[@]} verified assets" >&2; exit 1; }

edit_args=(release edit "$tag" -R "$repository" --draft=false --title "$title" --notes-file "$notes_file")
if [[ $prerelease -eq 1 ]]; then edit_args+=(--prerelease --latest=false)
else edit_args+=(--prerelease=false --latest)
fi
echo "all assets verified; publishing GitHub Release"
gh "${edit_args[@]}"

published_sha=$(read_tag_target)
[[ "$published_sha" == "$source_sha" ]] || { echo "published tag target mismatch: $published_sha" >&2; exit 1; }
published_state=$(gh release view "$tag" -R "$repository" --json isDraft,isPrerelease,name,url \
  --jq '[.isDraft, .isPrerelease, .name, .url] | @tsv')
IFS=$'\t' read -r is_draft is_prerelease published_title release_url <<< "$published_state"
[[ "$is_draft" == false ]] || { echo "Release is still a Draft: $release_url" >&2; exit 1; }
[[ "$published_title" == "$title" ]] || { echo "Release title mismatch" >&2; exit 1; }
[[ "$is_prerelease" == "$expected_prerelease" ]] || { echo "Release prerelease state mismatch" >&2; exit 1; }
refresh_remote_assets
[[ $(wc -l < "$remote_assets" | tr -d ' ') == ${#assets[@]} ]] || { echo "published Release does not contain exactly ${#assets[@]} uploaded assets" >&2; exit 1; }
for filename in "${assets[@]}"; do
  path=$(asset_path "$filename")
  expected_hash=$(shasum -a 256 "$path" | awk '{ print $1 }')
  expected_size=$(wc -c < "$path" | tr -d ' ')
  matches=$(awk -F '\t' -v name="$filename" -v size="$expected_size" -v digest="sha256:$expected_hash" \
    '$1 == name && $2 == size && $3 == digest { count++ } END { print count + 0 }' "$remote_assets")
  [[ "$matches" == 1 ]] || { echo "remote asset identity mismatch for $filename" >&2; exit 1; }
  echo "$filename: published SHA-256 and size OK"
done
if [[ $prerelease -eq 0 ]]; then
  latest_tag=$(gh api "repos/$repository/releases/latest" --jq .tag_name)
  [[ "$latest_tag" == "$tag" ]] || { echo "stable Release is not marked Latest" >&2; exit 1; }
fi
echo "published verified Release: $release_url"
