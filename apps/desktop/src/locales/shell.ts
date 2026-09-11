/** Bilingual copy for native dialogs and the community desktop shell. */
import { desktopDictionary } from '../desktop-locale.ts'
import { trayDictionaries, type TrayCopy } from './tray.ts'

const en = {
  productName: 'Open DeepSeek Harness Desktop',
  chooseSource: 'Choose DSH configuration directory',
  chooseTarget: 'Choose an empty folder for the configuration',
  buildBlockedTitle: 'Plugin build script blocked',
  buildBlockedMessage: 'A plugin needs to run a build script',
  recoveryFailedTitle: 'Plugin recovery failed',
  recoveryFailedMessage: 'The application can still start',
  transactionRecoveryFailed: 'Plugin activation could not be settled. The previous dependency state and recovery journal were retained.',
  processRecoveryFailed: (message: string) => `Background process recovery could not be completed. Open Diagnostics to reset the derived recovery record, then restart. ${message}`,
  chooseEmpty: 'Choose an empty folder for a new configuration',
  chooseExisting: 'Choose an existing DSH data directory',
  switchData: 'Switch or create a DSH data directory',
  recoveryPreview: 'Recovery workspace was opened manually from a development build. Harness is still running; you can choose Continue without making changes to return to the client.',
  exportDiagnostics: 'Export diagnostic report',
  choosePluginSource: 'Choose a local plugin source',
  pluginVersionDiffers: 'Plugin version differs from the imported configuration',
  permissionTitle: (name: string) => `${name} permission request`,
  permissionMessage: (capability: string) => `The current feature wants to ${capability}`,
  confirmPlugin: (name: string) => `Install ${name} anyway?`,
  initializeFailed: (message: string) => `Web Profile initialization failed: ${message}`,
}

const zh: typeof en = {
  productName: 'Open DeepSeek Harness Desktop',
  chooseSource: '选择 DSH 配置目录',
  chooseTarget: '选择空文件夹作为配置目录',
  buildBlockedTitle: '插件构建脚本被拦截',
  buildBlockedMessage: '一个插件需要运行构建脚本',
  recoveryFailedTitle: '插件恢复失败',
  recoveryFailedMessage: '应用仍可继续启动',
  transactionRecoveryFailed: '插件激活未能完成或回滚。已保留原依赖状态和恢复日志，请进入恢复模式处理。',
  processRecoveryFailed: (message: string) => `后台进程恢复未能完成。请在“导出诊断”中重置派生的进程恢复记录，然后重新启动。${message}`,
  chooseEmpty: '选择空文件夹以创建新配置',
  chooseExisting: '选择已有 DSH 配置目录',
  switchData: '切换或新建 DSH 配置目录',
  recoveryPreview: '已从开发模式手动进入恢复工作区。Harness 仍在运行，可以不做任何修改，直接点击“继续”返回客户端。',
  exportDiagnostics: '导出诊断报告',
  choosePluginSource: '选择插件本地来源',
  pluginVersionDiffers: '插件版本与原配置不同',
  permissionTitle: (name: string) => `${name} 权限请求`,
  permissionMessage: (capability: string) => `当前功能请求${capability}`,
  confirmPlugin: (name: string) => `仍要安装 ${name} 吗？`,
  initializeFailed: (message: string) => `Web Profile 初始化失败：${message}`,
}

/** Select native-shell copy. @param locale - Electron locale. @returns The matching dictionary. */
export function shellMessages(locale: string): typeof en {
  return locale.toLowerCase().startsWith('zh') ? zh : en
}

/** Select tray-menu copy. @param locale - Electron locale. @returns The matching tray labels. */
export function trayMessages(locale: string): TrayCopy {
  return desktopDictionary(locale, trayDictionaries)
}

/** Select import-result copy. @param locale - Electron locale. @returns The matching import messages. */
export function dataHomeMessages(locale: string): {
  completeTitle: string
  completeMessage: string
  failedTitle: string
} {
  return locale.toLowerCase().startsWith('zh')
    ? {
      completeTitle: '导入完成', completeMessage: '用户数据与插件恢复清单已复制到独立桌面目录。进入客户端后可选择重新安装插件。',
      failedTitle: '无法导入官方数据',
    }
    : {
      completeTitle: 'Import complete', completeMessage: 'User data and a plugin restore list were copied into the independent desktop directory. Choose plugins to reinstall after entering Desktop.',
      failedTitle: 'Could not import official data',
    }
}
