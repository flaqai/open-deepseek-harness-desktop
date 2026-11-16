/** Cold npm archive estimates; unmeasured recipes stay unknown. Refresh with scripts/generate-capability-download-sizes.ts. */
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
        '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.2.2-rc.3',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'darwin-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'win32-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'linux-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
      },
    },
    'browser-use-devtools-attach': {
      'specs': [
        '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp@0.2.2-rc.3',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'darwin-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'win32-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'linux-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
      },
    },
    'browser-use-stagehand': {
      'specs': [
        '@deepseek-ai/dsh-experimental-browser-use-stagehand-native@0.2.2-rc.3',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'darwin-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'win32-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'linux-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
      },
    },
    'auto-review': {
      'specs': [
        '@deepseek-ai/dsh-experimental-auto-review@0.2.2-rc.3',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'darwin-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'win32-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'linux-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
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
        '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.2.2-rc.3',
        '@deepseek-ai/dsh-browser-use@0.2.2-rc.3',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'darwin-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'win32-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'linux-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
      },
    },
    'browser-use-devtools-visible': {
      'specs': [
        '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp@0.2.2-rc.3',
        '@deepseek-ai/dsh-browser-use@0.2.2-rc.3',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'darwin-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'win32-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'linux-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
      },
    },
    'computer-use-native': {
      'specs': [
        '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native@0.2.2-rc.3',
        '@deepseek-ai/dsh-computer-use@0.2.2-rc.3',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'darwin-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'win32-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'linux-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
      },
    },
    'computer-use-mcp': {
      'specs': [
        '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp@0.2.2-rc.3',
        '@deepseek-ai/dsh-computer-use@0.2.2-rc.3',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
            'The standalone CUA Driver application is not measured by npm archive metadata',
          ],
        },
        'darwin-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
            'The standalone CUA Driver application is not measured by npm archive metadata',
          ],
        },
        'win32-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
            'The standalone CUA Driver application is not measured by npm archive metadata',
          ],
        },
        'linux-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
            'The standalone CUA Driver application is not measured by npm archive metadata',
          ],
        },
      },
    },
    'codex': {
      'specs': [
        '@deepseek-ai/dsh-subagent-codex@0.2.2-rc.3',
        '@openai/codex@0.153.4',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'darwin-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'win32-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'linux-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
      },
    },
    'claude-code': {
      'specs': [
        '@deepseek-ai/dsh-subagent-claude-code@0.2.2-rc.3',
        '@anthropic-ai/claude-agent-sdk@0.3.263',
      ],
      'targets': {
        'darwin-arm64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'darwin-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'win32-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
        'linux-x64': {
          'downloadBytes': null,
          'additionalUnknown': true,
          'packageCount': 0,
          'warnings': [
            'Recipe updated to 0.2.2-rc.3; dependency download size has not been measured',
          ],
        },
      },
    },
  },
}
