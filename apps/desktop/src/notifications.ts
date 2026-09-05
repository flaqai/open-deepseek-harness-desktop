/** Native notification policy for Harness restarts and recovery. */

/** User-facing notification content. */
interface DesktopNotificationCopy {
  title: string
  body: string
}

/** Localized desktop notification set. */
export interface DesktopNotificationDictionary {
  restart: DesktopNotificationCopy
  failed: DesktopNotificationCopy
  recovered: DesktopNotificationCopy
  startupWarning: DesktopNotificationCopy
}

/** Select desktop notification copy for the operating-system locale. */
export function desktopNotificationDictionary(locale: string): DesktopNotificationDictionary {
  if (locale.toLowerCase().startsWith('zh')) {
    return {
      restart: { title: 'DeepSeek Harness 正在恢复', body: 'Harness 意外退出，客户端正在自动重启。' },
      failed: { title: 'DeepSeek Harness 启动失败', body: 'Harness 连续启动失败，请打开客户端日志排查。' },
      recovered: { title: 'DeepSeek Harness 已恢复', body: '本地 Harness 已重新连接并可继续使用。' },
      startupWarning: { title: '部分启动检查已降级', body: '应用已继续启动。请在“设置 → 诊断”查看超时或插件安装问题。' },
    }
  }
  return {
    restart: { title: 'DeepSeek Harness is recovering', body: 'Harness exited unexpectedly and is restarting.' },
    failed: { title: 'DeepSeek Harness could not start', body: 'Harness failed repeatedly. Open the desktop log for details.' },
    recovered: { title: 'DeepSeek Harness recovered', body: 'The local Harness is connected and ready again.' },
    startupWarning: { title: 'Some startup checks were degraded', body: 'The app continued to start. Review timeouts or plugin install failures under Settings → Diagnostics.' },
  }
}

/** Create a per-notification-key throttle. */
export function createNotificationThrottle(intervalMs: number): (key: string, now: number) => boolean {
  const lastShown = new Map<string, number>()
  return (key, now) => {
    const previous = lastShown.get(key)
    if (previous !== undefined && now - previous < intervalMs) return false
    lastShown.set(key, now)
    return true
  }
}
