/** Build-owned product versions, independent of Electron's development application identity. */
export function desktopVersionIdentity(metadata: unknown, packaged: boolean, applicationVersion: string): {
  desktopVersion: string
  harnessVersion: string
} {
  if (metadata === null || typeof metadata !== 'object' || !('version' in metadata)
    || !('desktopVersion' in metadata) || typeof metadata.version !== 'string'
    || typeof metadata.desktopVersion !== 'string' || metadata.version.length === 0 || metadata.desktopVersion.length === 0) {
    throw new Error('desktop: missing build version metadata; rebuild the desktop application')
  }
  return { desktopVersion: packaged ? applicationVersion : metadata.desktopVersion, harnessVersion: metadata.version }
}
