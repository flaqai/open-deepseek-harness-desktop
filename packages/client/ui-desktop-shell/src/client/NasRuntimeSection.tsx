/** Desktop-owned NAS runtime settings page. */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopNasBridge, NasDeviceSummary, NasDiscoveryCandidate, NasRuntimeStatus } from './bridge.ts'
import type { NasRole } from '@deepseek-ai/dsh-nas-protocol'
import { createNasPairingCeremony } from './nas-pairing-ceremony.ts'
import css from './NasRuntimeSection.module.css'

export type NasRuntimeSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'desktop-shell'>
  & { readonly bridge: DesktopNasBridge }

export function NasRuntimeSection({ bridge, t }: NasRuntimeSectionProps) {
  const [status, setStatus] = useState<NasRuntimeStatus>()
  const [busy, setBusy] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [devices, setDevices] = useState<Readonly<Record<string, readonly NasDeviceSummary[]>>>({})
  const [identities, setIdentities] = useState<Readonly<Record<string, NasDeviceSummary>>>({})
  const [inviteRoles, setInviteRoles] = useState<Readonly<Record<string, NasRole>>>({})
  const [invitations, setInvitations] = useState<Readonly<Record<string, { readonly code: string; readonly expiresAt: string }>>>({})
  const [discovered, setDiscovered] = useState<readonly NasDiscoveryCandidate[]>([])
  const pairingCeremony = useMemo(() => createNasPairingCeremony(bridge), [bridge])
  const pairing = useSyncExternalStore(
    listener => pairingCeremony.subscribe(listener),
    () => pairingCeremony.getSnapshot(),
    () => pairingCeremony.getSnapshot(),
  )
  const operationBusy = busy !== undefined || pairing.busy
  const inspection = pairing.stage.phase === 'reviewing' || pairing.stage.phase === 'pairing'
    ? pairing.stage.inspection
    : undefined
  const trusted = pairing.stage.phase === 'reviewing'
    ? pairing.stage.trusted
    : pairing.stage.phase === 'pairing'

  useEffect(() => () => { pairingCeremony.dispose() }, [pairingCeremony])

  useEffect(() => {
    let live = true
    void bridge.get().then((value) => { if (live) setStatus(value) }, (error: unknown) => {
      if (live) setMessage(error instanceof Error ? error.message : String(error))
    })
    const dispose = bridge.onStatus((value) => { if (live) setStatus(value) })
    return () => { live = false; dispose() }
  }, [bridge])

  useEffect(() => {
    if (status === undefined) return
    let live = true
    for (const server of status.servers) {
      void bridge.me(server.id).then((identity) => {
        if (live) setIdentities(current => ({ ...current, [server.id]: identity }))
      }, () => {
        if (live) setIdentities((current) => { const { [server.id]: _old, ...rest } = current; return rest })
      })
    }
    return () => { live = false }
  }, [bridge, status])

  const clearMessage = (): void => {
    setMessage(undefined)
    pairingCeremony.send({ type: 'dismiss-error' })
  }
  const discover = async (): Promise<void> => {
    setBusy('discover'); clearMessage()
    try {
      const candidates = await bridge.discover()
      setDiscovered(candidates)
      if (candidates.length === 0) setMessage(t('nas.discovery.empty'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setBusy(undefined) }
  }
  const pair = async (): Promise<void> => {
    clearMessage()
    const next = await pairingCeremony.pair()
    if (next !== undefined) {
      setStatus(next)
      setMessage(t('nas.paired'))
    }
  }
  const select = async (serverId?: string): Promise<void> => {
    setBusy(serverId ?? 'local'); clearMessage()
    try { await bridge.select(serverId === undefined ? { kind: 'local' } : { kind: 'nas', serverId }) } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error)); setBusy(undefined)
    }
  }
  const test = async (serverId: string): Promise<void> => {
    setBusy(`test:${serverId}`); clearMessage()
    try {
      const result = await bridge.test(serverId)
      setMessage(t('nas.test.success', { version: result.version }))
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(undefined) }
  }
  const remove = async (serverId: string): Promise<void> => {
    setBusy(`remove:${serverId}`); clearMessage()
    try { setStatus(await bridge.remove(serverId)) } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setBusy(undefined) }
  }
  const loadDevices = async (serverId: string): Promise<void> => {
    setBusy(`devices:${serverId}`); clearMessage()
    try {
      const next = await bridge.devices(serverId)
      setDevices(current => ({ ...current, [serverId]: next }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setBusy(undefined) }
  }
  const refreshRole = async (serverId: string): Promise<void> => {
    setBusy(`role:${serverId}`); clearMessage()
    setIdentities((current) => { const { [serverId]: _old, ...rest } = current; return rest })
    setDevices((current) => { const { [serverId]: _old, ...rest } = current; return rest })
    setInvitations((current) => { const { [serverId]: _old, ...rest } = current; return rest })
    try { const identity = await bridge.me(serverId); setIdentities(current => ({ ...current, [serverId]: identity })) }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(undefined) }
  }
  const invite = async (serverId: string): Promise<void> => {
    setBusy(`invite:${serverId}`); clearMessage()
    try {
      const invitation = await bridge.invite(serverId, inviteRoles[serverId] ?? 'user')
      setInvitations(current => ({ ...current, [serverId]: invitation }))
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(undefined) }
  }
  const changeRole = async (serverId: string, deviceId: string, role: NasRole): Promise<void> => {
    setBusy(`role:${deviceId}`); clearMessage()
    try {
      const next = await bridge.setDeviceRole(serverId, deviceId, role)
      setDevices(current => ({ ...current, [serverId]: next }))
      if (identities[serverId]?.id === deviceId) await refreshRole(serverId)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(undefined) }
  }
  const revokeDevice = async (serverId: string, deviceId: string): Promise<void> => {
    setBusy(`revoke:${deviceId}`); clearMessage()
    try {
      const next = await bridge.revokeDevice(serverId, deviceId)
      setDevices(current => ({ ...current, [serverId]: next }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setBusy(undefined) }
  }

  return (
    <section className={css.page}>
      <header>
        <div className={css.titleRow}>
          <h2>{t('nas.title')}</h2>
          <span className={css.experimentalBadge}>{t('nas.experimental')}</span>
        </div>
        <p>{t('nas.description')}</p>
      </header>
      <div className={css.betaNotice}>{t('nas.experimentalNotice')}</div>
      <p>{t('nas.role.notice')}</p>
      {status?.secureStorageAvailable === false && <div className={css.warning}>{t('nas.secureStorageUnavailable')}</div>}
      {(message ?? pairing.error) !== undefined && <div className={css.message}>{message ?? pairing.error}</div>}

      <div className={css.card}>
        <div className={css.cardHeader}>
          <div><strong>{t('nas.local.title')}</strong><p>{t('nas.local.description')}</p></div>
          <span className={css.badge}>{status?.selection.kind === 'local' ? t('nas.current') : t('nas.available')}</span>
        </div>
        {status?.selection.kind !== 'local' && (
          <Button variant="outline" disabled={operationBusy} onClick={() => { void select() }}>{t('nas.useLocal')}</Button>
        )}
      </div>

      {status?.servers.map((server) => {
        const role = identities[server.id]?.role
        const invitation = invitations[server.id]
        return (
          <div className={css.card} key={server.id}>
            <div className={css.cardHeader}>
              <div><strong>{server.name}</strong><p className={css.mono}>{server.baseUrl}</p></div>
              <span className={css.badge}>{status.selection.kind === 'nas' && status.selection.serverId === server.id ? t('nas.selected') : t('nas.saved')}</span>
            </div>
            {server.certificateFingerprint !== undefined && <p className={css.fingerprint}>{t('nas.fingerprint')}: {server.certificateFingerprint}</p>}
            <p>{t('nas.role')}: {role === undefined ? t('nas.role.unknown') : t(`nas.role.${role}`)}</p>
            <div className={css.actions}>
              <Button variant="outline" disabled={operationBusy} onClick={() => { void test(server.id) }}>{t('nas.test')}</Button>
              <Button variant="outline" disabled={operationBusy} onClick={() => { void refreshRole(server.id) }}>{t('nas.role.check')}</Button>
              {identities[server.id]?.role === 'admin' && <Button variant="outline" disabled={operationBusy} onClick={() => { void loadDevices(server.id) }}>{t('nas.devices')}</Button>}
              <Button disabled={operationBusy} onClick={() => { void select(server.id) }}>{t('nas.connect')}</Button>
              <Button variant="outline" disabled={operationBusy || status.selection.kind === 'nas' && status.selection.serverId === server.id} onClick={() => { void remove(server.id) }}>{t('nas.remove')}</Button>
            </div>
            {identities[server.id]?.role === 'admin' && <>
              {identities[server.id]?.rolesMigrated === true && <p>{t('nas.role.migrated')}</p>}
              <div className={css.actions}>
                <label className={css.field}><span>{t('nas.invite.role')}</span><select disabled={operationBusy} value={inviteRoles[server.id] ?? 'user'} onChange={(event) => {
                  const role = event.target.value
                  if (role === 'admin' || role === 'user' || role === 'readonly') setInviteRoles(current => ({ ...current, [server.id]: role }))
                }}>{(['user', 'readonly', 'admin'] as const).map(role => <option key={role} value={role}>{t(`nas.role.${role}`)}</option>)}</select></label>
                <Button variant="outline" disabled={operationBusy} onClick={() => { void invite(server.id) }}>{t('nas.invite.create')}</Button>
              </div>
              {invitation !== undefined && <p role="status">{t('nas.invite.code', { code: invitation.code, date: new Date(invitation.expiresAt).toLocaleString() })}</p>}
            </>}
            {identities[server.id]?.role === 'admin' && devices[server.id] !== undefined && <div className={css.devices}>
              <strong>{t('nas.devices.title')}</strong>
              {devices[server.id]?.map(device => <div className={css.device} key={device.id}>
                <span>{device.name}<small>{t('nas.devices.expires', { date: new Date(device.expiresAt).toLocaleDateString() })}</small></span>
                <label className={css.field}><span>{t('nas.role')}</span><select disabled={operationBusy} value={device.role ?? 'admin'} onChange={(event) => {
                  const role = event.target.value
                  if (role === 'admin' || role === 'user' || role === 'readonly') void changeRole(server.id, device.id, role)
                }}>{(['admin', 'user', 'readonly'] as const).map(role => <option key={role} value={role}>{t(`nas.role.${role}`)}</option>)}</select></label>
                <Button variant="outline" disabled={operationBusy} onClick={() => { void revokeDevice(server.id, device.id) }}>{t('nas.devices.revoke')}</Button>
              </div>)}
              {devices[server.id]?.length === 0 && <p>{t('nas.devices.empty')}</p>}
            </div>}
          </div>
        )
      })}

      <div className={css.card}>
        <h3>{t('nas.add.title')}</h3>
        <p>{t('nas.add.description')}</p>
        <div className={css.actions}>
          <Button variant="outline" disabled={operationBusy} onClick={() => { void discover() }}>
            {busy === 'discover' ? t('nas.discovery.searching') : t('nas.discovery.search')}
          </Button>
        </div>
        {discovered.length > 0 && <div className={css.devices}>
          <strong>{t('nas.discovery.title')}</strong>
          {discovered.map(candidate => <button className={css.discovery} type="button" key={candidate.baseUrl} onClick={() => {
            pairingCeremony.send({ type: 'edit', field: 'baseUrl', value: candidate.baseUrl })
          }}><span>{candidate.name}</span><code>{candidate.baseUrl}</code></button>)}
          <p>{t('nas.discovery.untrusted')}</p>
        </div>}
        <label className={css.field}><span>{t('nas.address')}</span><input value={pairing.draft.baseUrl} placeholder={t('nas.address.placeholder')} onChange={(event) => { pairingCeremony.send({ type: 'edit', field: 'baseUrl', value: event.target.value }) }} /></label>
        <label className={css.field}><span>{t('nas.deviceName')}</span><input value={pairing.draft.deviceName} maxLength={80} onChange={(event) => { pairingCeremony.send({ type: 'edit', field: 'deviceName', value: event.target.value }) }} /></label>
        <label className={css.field}><span>{t('nas.code')}</span><input value={pairing.draft.code} inputMode="numeric" autoComplete="one-time-code" maxLength={9} onChange={(event) => { pairingCeremony.send({ type: 'edit', field: 'code', value: event.target.value }) }} /></label>
        <div className={css.actions}><Button variant="outline" disabled={busy !== undefined || !pairing.canInspect} onClick={() => { clearMessage(); void pairingCeremony.inspect() }}>{pairing.stage.phase === 'inspecting' ? t('nas.inspecting') : t('nas.inspect')}</Button></div>
        {inspection !== undefined && (
          <div className={css.trust}>
            <p>{t('nas.confirmCertificate')}</p><code>{inspection.fingerprint}</code>
            <label><input type="checkbox" checked={trusted} disabled={pairing.stage.phase === 'pairing'} onChange={(event) => { pairingCeremony.send({ type: 'trust', trusted: event.target.checked }) }} /> {t('nas.trustCertificate')}</label>
            <Button disabled={busy !== undefined || !pairing.canPair} onClick={() => { void pair() }}>{pairing.stage.phase === 'pairing' ? t('nas.pairing') : t('nas.pair')}</Button>
          </div>
        )}
      </div>
    </section>
  )
}
