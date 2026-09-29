import AppKit
import ApplicationServices
import Foundation

public typealias SelectionEmit = @convention(c) (UnsafePointer<CChar>?, UnsafeMutableRawPointer?) -> Void

private final class EmitState: @unchecked Sendable {
  let lock = NSLock()
  var callback: SelectionEmit?
  var context: UnsafeMutableRawPointer?
}

private let emitState = EmitState()

private func emit(_ payload: [String: Any]) {
  guard JSONSerialization.isValidJSONObject(payload),
    let data = try? JSONSerialization.data(withJSONObject: payload),
    let line = String(data: data, encoding: .utf8)
  else { return }
  emitState.lock.lock()
  let callback = emitState.callback
  let context = emitState.context
  emitState.lock.unlock()
  if let callback { line.withCString { callback($0, context) } }
}

private func electronPoint(_ cocoa: NSPoint) -> (x: Double, y: Double) {
  let primary = NSScreen.screens.first { $0.frame.origin == .zero } ?? NSScreen.main
  return (Double(cocoa.x), Double((primary?.frame.maxY ?? cocoa.y) - cocoa.y))
}

private final class SelectionMonitor: @unchecked Sendable {
  private let lock = NSLock()
  private var excluded: Set<pid_t> = [pid_t(getpid())]
  private var press: NSPoint?
  private var dragged = false
  private var monitor: Any?

  func setExcluded(_ pids: Set<pid_t>) {
    lock.lock()
    excluded = pids
    lock.unlock()
  }

  func start() {
    if monitor != nil { return }
    guard AXIsProcessTrustedWithOptions([
      kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false,
    ] as CFDictionary) else {
      emit(["type": "untrusted"])
      return
    }
    monitor = NSEvent.addGlobalMonitorForEvents(matching: [
      .leftMouseDown, .leftMouseDragged, .leftMouseUp,
    ]) { [weak self] event in self?.handle(event) }
    if monitor != nil { emit(["type": "ready"]) }
  }

  func stop() {
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
    press = nil
    dragged = false
  }

  private func handle(_ event: NSEvent) {
    let location = NSEvent.mouseLocation
    switch event.type {
    case .leftMouseDown:
      press = location
      dragged = false
    case .leftMouseDragged:
      if let origin = press, hypot(location.x - origin.x, location.y - origin.y) >= 8 { dragged = true }
    case .leftMouseUp:
      let selected = press != nil && dragged
      press = nil
      dragged = false
      if !selected { return }
      let anchor = electronPoint(location)
      let sourcePid = NSWorkspace.shared.frontmostApplication?.processIdentifier
      DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(100)) { [weak self] in
        self?.readSelection(anchor: anchor, sourcePid: sourcePid)
      }
    default: return
    }
  }

  private func readSelection(anchor: (x: Double, y: Double), sourcePid: pid_t?) {
    guard monitor != nil, let sourcePid, sourcePid > 0,
      NSWorkspace.shared.frontmostApplication?.processIdentifier == sourcePid,
      AXIsProcessTrusted()
    else { return }
    lock.lock()
    let forbidden = excluded.contains(sourcePid)
    lock.unlock()
    if forbidden { return }
    let system = AXUIElementCreateSystemWide()
    var focused: CFTypeRef?
    guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
      let focused
    else { return }
    let element = focused as! AXUIElement
    var focusedPid: pid_t = 0
    guard AXUIElementGetPid(element, &focusedPid) == .success,
      focusedPid == sourcePid,
      NSWorkspace.shared.frontmostApplication?.processIdentifier == sourcePid
    else { return }
    var selected: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXSelectedTextAttribute as CFString, &selected) == .success,
      let text = selected as? String
    else { return }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty || trimmed.count > 8192 { return }
    emit(["type": "selection", "text": trimmed, "x": anchor.x, "y": anchor.y, "pid": Int(sourcePid)])
  }
}

private var selectionMonitor: SelectionMonitor?

@_cdecl("dsh_orb_selection_start")
public func dsh_orb_selection_start(_ callback: SelectionEmit?, _ context: UnsafeMutableRawPointer?) -> Int32 {
  emitState.lock.lock()
  emitState.callback = callback
  emitState.context = context
  emitState.lock.unlock()
  let start = {
    if selectionMonitor == nil { selectionMonitor = SelectionMonitor() }
    selectionMonitor?.start()
  }
  if Thread.isMainThread { start() } else { DispatchQueue.main.sync(execute: start) }
  return 0
}

@_cdecl("dsh_orb_selection_stop")
public func dsh_orb_selection_stop() {
  let stop = { selectionMonitor?.stop() }
  if Thread.isMainThread { stop() } else { DispatchQueue.main.sync(execute: stop) }
  emitState.lock.lock()
  emitState.callback = nil
  emitState.context = nil
  emitState.lock.unlock()
}

@_cdecl("dsh_orb_selection_exclude_pids")
public func dsh_orb_selection_exclude_pids(_ value: UnsafePointer<CChar>?) {
  var pids: Set<pid_t> = [pid_t(getpid())]
  if let value {
    for part in String(cString: value).split(separator: ",") {
      if let pid = Int32(part.trimmingCharacters(in: .whitespaces)), pid > 0 { pids.insert(pid_t(pid)) }
    }
  }
  let update = { selectionMonitor?.setExcluded(pids) }
  if Thread.isMainThread { update() } else { DispatchQueue.main.sync(execute: update) }
}
