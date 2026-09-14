#!/bin/zsh -f
# Double-click entry for the portable benchmark; never launches or modifies Harness.
set -u

benchmark_dir=${0:A:h}
app_bundle='/Applications/Open DeepSeek Harness Desktop.app'
if [[ ! -d "$app_bundle" && -d "$HOME/Applications/Open DeepSeek Harness Desktop.app" ]]; then
  app_bundle="$HOME/Applications/Open DeepSeek Harness Desktop.app"
elif [[ ! -d "$app_bundle" && -d '/Applications/DeepSeek Harness.app' ]]; then
  app_bundle='/Applications/DeepSeek Harness.app'
elif [[ ! -d "$app_bundle" && -d "$HOME/Applications/DeepSeek Harness.app" ]]; then
  app_bundle="$HOME/Applications/DeepSeek Harness.app"
fi
runtime_root=''
output_dir="$benchmark_dir/proxy-ab-reports"
show_reports=1
pause_at_end=1
typeset -a benchmark_args
benchmark_args=()

finish() {
  local result=$1
  if (( pause_at_end )) && [[ -t 0 ]]; then
    printf '\n按回车关闭 / Press Return to close… '
    read -r reply
  fi
  exit "$result"
}

fail() {
  printf '\n错误 / Error: %s\n' "$1" >&2
  finish 1
}

while (( $# )); do
  case "$1" in
    --no-open) show_reports=0; shift ;;
    --no-pause) pause_at_end=0; shift ;;
    --app|--runtime|--output|--rounds|--mode|--cache|--system-proxy)
      (( $# >= 2 )) || fail "$1 缺少参数 / requires a value"
      case "$1" in
        --app) app_bundle=${2:a} ;;
        --runtime) runtime_root=${2:a} ;;
        --output) output_dir=${2:a} ;;
        *) benchmark_args+=("$1" "$2") ;;
      esac
      shift 2 ;;
    *) fail "未知参数 / Unknown option: $1" ;;
  esac
done

[[ -f "$benchmark_dir/benchmark.mjs" ]] || fail '请保留 benchmark.mjs 在脚本旁 / Keep benchmark.mjs beside this script.'

if [[ -z "$runtime_root" ]]; then
  app_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_bundle/Contents/Info.plist" 2>/dev/null) || \
    fail '找不到安装版。使用 --app 指定应用，或 --runtime 指定包含 package-runtime 的目录。 / App not found; supply --app or --runtime.'
  [[ -n "$app_version" && "$app_version" != *'/'* && "$app_version" != '.' && "$app_version" != '..' ]] || fail '应用版本无效 / Invalid application version.'
  runtime_root="$HOME/Library/Application Support/open-deepseek-harness-desktop/runtime/$app_version"
  printf '匹配安装版 / Installed app: %s\n' "$app_version"
fi

node_bin="$runtime_root/package-runtime/bin/node"
pnpm_entry="$runtime_root/package-runtime/lib/node_modules/pnpm/bin/pnpm.mjs"
[[ -x "$node_bin" && -f "$pnpm_entry" ]] || \
  fail '对应运行时未就绪。请先启动一次安装版，或用 --runtime 指定已解压运行时。 / Runtime missing; launch the installed app once, or supply --runtime.'

printf 'Open DeepSeek Harness Desktop · pnpm 代理 A/B 测试 / Proxy A/B benchmark\n'
printf '默认：离线隔离场景，10 轮，冷/热缓存；不修改真实配置。\n'
printf 'Default: offline fixture, 10 rounds, cold/warm caches; real configuration is untouched.\n'
printf 'Node: %s\npnpm: %s\n' "$node_bin" "$pnpm_entry"
printf '报告目录 / Reports: %s\n\n' "$output_dir"

"$node_bin" "$benchmark_dir/benchmark.mjs" --node "$node_bin" --pnpm "$pnpm_entry" --output "$output_dir" "${benchmark_args[@]}"
benchmark_result=$?
if (( benchmark_result == 0 )); then
  printf '\n测试已完成，请查看 summary.md / Completed; read summary.md.\n'
else
  printf '\n测试失败或取消（%s），请检查输出及已有报告 / Failed or cancelled; inspect output and any report.\n' "$benchmark_result"
fi
if (( show_reports )) && [[ -d "$output_dir" ]]; then
  /usr/bin/open "$output_dir" || printf '无法打开报告目录，请手动打开 / Open the reports folder manually.\n' >&2
fi
finish "$benchmark_result"
