/** Generated cold npm archive estimates. Refresh with scripts/generate-capability-download-sizes.ts. */
export const downloadSizeData: {
  schema: number
  generatedAt: string
  scope: string
  choices: Record<string, {
    specs: readonly string[]
    targets: Record<string, {
      downloadBytes: number | null
      additionalUnknown: boolean
      packageCount: number
      warnings: readonly string[]
    }>
  }>
} = {
  'schema': 1,
  'generatedAt': '2026-11-06T02:50:56.358Z',
  'scope': 'npm-tarballs-no-cache',
  'choices': {
    'browser-use-playwright-attach': {
      'specs': [
        '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.2.2-rc.1',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': 4113259,
          'additionalUnknown': false,
          'packageCount': 8,
          'warnings': [],
        },
        'darwin-x64': {
          'downloadBytes': 4113259,
          'additionalUnknown': false,
          'packageCount': 8,
          'warnings': [],
        },
        'win32-x64': {
          'downloadBytes': 4113259,
          'additionalUnknown': false,
          'packageCount': 8,
          'warnings': [],
        },
        'linux-x64': {
          'downloadBytes': 4113259,
          'additionalUnknown': false,
          'packageCount': 8,
          'warnings': [],
        },
      },
    },
    'browser-use-devtools-attach': {
      'specs': [
        '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp@0.2.2-rc.1',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': 2531268,
          'additionalUnknown': false,
          'packageCount': 6,
          'warnings': [],
        },
        'darwin-x64': {
          'downloadBytes': 2531268,
          'additionalUnknown': false,
          'packageCount': 6,
          'warnings': [],
        },
        'win32-x64': {
          'downloadBytes': 2531268,
          'additionalUnknown': false,
          'packageCount': 6,
          'warnings': [],
        },
        'linux-x64': {
          'downloadBytes': 2531268,
          'additionalUnknown': false,
          'packageCount': 6,
          'warnings': [],
        },
      },
    },
    'browser-use-stagehand': {
      'specs': [
        '@deepseek-ai/dsh-experimental-browser-use-stagehand-native@0.2.1-alpha.1',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': 8206089,
          'additionalUnknown': false,
          'packageCount': 84,
          'warnings': [],
        },
        'darwin-x64': {
          'downloadBytes': 8206089,
          'additionalUnknown': false,
          'packageCount': 84,
          'warnings': [],
        },
        'win32-x64': {
          'downloadBytes': 8206089,
          'additionalUnknown': false,
          'packageCount': 84,
          'warnings': [],
        },
        'linux-x64': {
          'downloadBytes': 8206089,
          'additionalUnknown': false,
          'packageCount': 84,
          'warnings': [],
        },
      },
    },
    'auto-review': {
      'specs': [
        '@deepseek-ai/dsh-experimental-auto-review@0.2.1-alpha.1',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': 36684,
          'additionalUnknown': false,
          'packageCount': 2,
          'warnings': [],
        },
        'darwin-x64': {
          'downloadBytes': 36684,
          'additionalUnknown': false,
          'packageCount': 2,
          'warnings': [],
        },
        'win32-x64': {
          'downloadBytes': 36684,
          'additionalUnknown': false,
          'packageCount': 2,
          'warnings': [],
        },
        'linux-x64': {
          'downloadBytes': 36684,
          'additionalUnknown': false,
          'packageCount': 2,
          'warnings': [],
        },
      },
    },
    'workbuddy': {
      'specs': [
        'dsh-workbuddy-connect@0.5.0',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': 86952,
          'additionalUnknown': false,
          'packageCount': 1,
          'warnings': [],
        },
        'darwin-x64': {
          'downloadBytes': 86952,
          'additionalUnknown': false,
          'packageCount': 1,
          'warnings': [],
        },
        'win32-x64': {
          'downloadBytes': 86952,
          'additionalUnknown': false,
          'packageCount': 1,
          'warnings': [],
        },
        'linux-x64': {
          'downloadBytes': 86952,
          'additionalUnknown': false,
          'packageCount': 1,
          'warnings': [],
        },
      },
    },
    'browser-use-playwright-visible': {
      'specs': [
        '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.2.2-rc.1',
        '@deepseek-ai/dsh-browser-use@0.2.2-rc.1',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': 4119674,
          'additionalUnknown': false,
          'packageCount': 9,
          'warnings': [],
        },
        'darwin-x64': {
          'downloadBytes': 4119674,
          'additionalUnknown': false,
          'packageCount': 9,
          'warnings': [],
        },
        'win32-x64': {
          'downloadBytes': 4119674,
          'additionalUnknown': false,
          'packageCount': 9,
          'warnings': [],
        },
        'linux-x64': {
          'downloadBytes': 4119674,
          'additionalUnknown': false,
          'packageCount': 9,
          'warnings': [],
        },
      },
    },
    'browser-use-devtools-visible': {
      'specs': [
        '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp@0.2.2-rc.1',
        '@deepseek-ai/dsh-browser-use@0.2.2-rc.1',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': 2537683,
          'additionalUnknown': false,
          'packageCount': 7,
          'warnings': [],
        },
        'darwin-x64': {
          'downloadBytes': 2537683,
          'additionalUnknown': false,
          'packageCount': 7,
          'warnings': [],
        },
        'win32-x64': {
          'downloadBytes': 2537683,
          'additionalUnknown': false,
          'packageCount': 7,
          'warnings': [],
        },
        'linux-x64': {
          'downloadBytes': 2537683,
          'additionalUnknown': false,
          'packageCount': 7,
          'warnings': [],
        },
      },
    },
    'computer-use-native': {
      'specs': [
        '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native@0.2.2-rc.1',
        '@deepseek-ai/dsh-computer-use@0.2.2-rc.1',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': 22590778,
          'additionalUnknown': false,
          'packageCount': 26,
          'warnings': [],
        },
        'darwin-x64': {
          'downloadBytes': 22606640,
          'additionalUnknown': false,
          'packageCount': 26,
          'warnings': [],
        },
        'win32-x64': {
          'downloadBytes': 13494863,
          'additionalUnknown': false,
          'packageCount': 26,
          'warnings': [],
        },
        'linux-x64': {
          'downloadBytes': 17863389,
          'additionalUnknown': false,
          'packageCount': 26,
          'warnings': [],
        },
      },
    },
    'computer-use-mcp': {
      'specs': [
        '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp@0.2.0-rc.2',
        '@deepseek-ai/dsh-computer-use@0.2.0-rc.2',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': 3077322,
          'additionalUnknown': true,
          'packageCount': 20,
          'warnings': [
            'The standalone CUA Driver application is not measured by npm archive metadata',
          ],
        },
        'darwin-x64': {
          'downloadBytes': 3077322,
          'additionalUnknown': true,
          'packageCount': 20,
          'warnings': [
            'The standalone CUA Driver application is not measured by npm archive metadata',
          ],
        },
        'win32-x64': {
          'downloadBytes': 3077322,
          'additionalUnknown': true,
          'packageCount': 20,
          'warnings': [
            'The standalone CUA Driver application is not measured by npm archive metadata',
          ],
        },
        'linux-x64': {
          'downloadBytes': 3077322,
          'additionalUnknown': true,
          'packageCount': 20,
          'warnings': [
            'The standalone CUA Driver application is not measured by npm archive metadata',
          ],
        },
      },
    },
    'codex': {
      'specs': [
        '@deepseek-ai/dsh-subagent-codex@0.2.2-rc.1',
        '@openai/codex@0.153.4',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': 116569184,
          'additionalUnknown': false,
          'packageCount': 10,
          'warnings': [],
        },
        'darwin-x64': {
          'downloadBytes': 124440905,
          'additionalUnknown': false,
          'packageCount': 10,
          'warnings': [],
        },
        'win32-x64': {
          'downloadBytes': 142392258,
          'additionalUnknown': false,
          'packageCount': 10,
          'warnings': [],
        },
        'linux-x64': {
          'downloadBytes': 130169009,
          'additionalUnknown': false,
          'packageCount': 10,
          'warnings': [],
        },
      },
    },
    'claude-code': {
      'specs': [
        '@deepseek-ai/dsh-subagent-claude-code@0.2.2-rc.1',
        '@anthropic-ai/claude-agent-sdk@0.3.263',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': 93751884,
          'additionalUnknown': false,
          'packageCount': 108,
          'warnings': [],
        },
        'darwin-x64': {
          'downloadBytes': 97752598,
          'additionalUnknown': false,
          'packageCount': 108,
          'warnings': [],
        },
        'win32-x64': {
          'downloadBytes': 106272868,
          'additionalUnknown': false,
          'packageCount': 108,
          'warnings': [],
        },
        'linux-x64': {
          'downloadBytes': 103425883,
          'additionalUnknown': false,
          'packageCount': 108,
          'warnings': [],
        },
      },
    },
  },
}
