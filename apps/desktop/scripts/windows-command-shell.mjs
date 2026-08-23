/**
 * Decide whether a child command requires Windows command-script mediation.
 * @param {NodeJS.Platform} platform Operating-system identifier for the child host.
 * @param {string} command Executable or command-script path.
 * @returns {boolean} Whether `spawn()` must use the platform command shell.
 */
export function requiresWindowsCommandShell(platform, command) {
  return platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)
}
