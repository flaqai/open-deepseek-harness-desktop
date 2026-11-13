import { networkInterfaces } from 'node:os'
import type { Config, WebRuntimeValues } from './index.ts'

/**
 * Resolve one LAN-trust snapshot from the active server bind.
 *
 * Derived entries are port-less IP literals: DNS rebinding needs an
 * attacker-controlled name, while an IP-literal Host is safe on any port and
 * an OS-assigned port is unknowable before bind.
 * @param bindHost - the active webserver bind host.
 * @param extra - explicit `--trusted-host` values, in argument order.
 * @param nas - optional NAS deployment values retained in the Runtime snapshot.
 * @returns the LAN display addresses and invocation-derived fence authorities.
 */
export function resolveLanTrust(bindHost: string, extra: readonly string[], nas?: Config['nas']): WebRuntimeValues {
  const lanAddresses = nas !== undefined && bindHost === '0.0.0.0'
    ? Object.values(networkInterfaces()).flat()
      .filter((iface): iface is NonNullable<typeof iface> => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
      .map(iface => iface.address)
    : []
  return { lanAddresses, trustedHosts: [...lanAddresses, ...extra], ...(nas === undefined ? {} : { nas }) }
}
