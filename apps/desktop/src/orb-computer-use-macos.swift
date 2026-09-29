import AppKit
import ApplicationServices
import Foundation

private struct ForegroundWindow {
  let id: CGWindowID
  let pid: pid_t
  let name: String
  let title: String?
  let bounds: CGRect
}

private func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data(("orb computer use: \(message)\n").utf8))
  exit(1)
}

private func emit(_ value: [String: Any]) {
  guard JSONSerialization.isValidJSONObject(value),
    let data = try? JSONSerialization.data(withJSONObject: value) else { fail("could not encode native result") }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([10]))
}

private func permissions() -> (capture: Bool, input: Bool) {
  (CGPreflightScreenCaptureAccess(), AXIsProcessTrustedWithOptions([
    kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false,
  ] as CFDictionary))
}

private func foregroundWindow() -> ForegroundWindow? {
  guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
  let pid = app.processIdentifier
  guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] else { return nil }
  for window in windows {
    guard let owner = window[kCGWindowOwnerPID as String] as? NSNumber, owner.int32Value == pid,
      let layer = window[kCGWindowLayer as String] as? NSNumber, layer.intValue == 0,
      let number = window[kCGWindowNumber as String] as? NSNumber,
      let rectangle = window[kCGWindowBounds as String] as? [String: NSNumber],
      let x = rectangle["X"]?.doubleValue, let y = rectangle["Y"]?.doubleValue,
      let width = rectangle["Width"]?.doubleValue, let height = rectangle["Height"]?.doubleValue,
      width >= 2, height >= 2, width <= 16384, height <= 16384
    else { continue }
    let name = app.localizedName ?? (window[kCGWindowOwnerName as String] as? String) ?? ""
    if name.isEmpty { continue }
    return ForegroundWindow(id: CGWindowID(number.uint32Value), pid: pid, name: name,
      title: window[kCGWindowName as String] as? String,
      bounds: CGRect(x: x, y: y, width: width, height: height))
  }
  return nil
}

private func requiredWindow(_ expected: String? = nil) -> ForegroundWindow {
  guard let window = foregroundWindow() else { fail("no eligible foreground window") }
  if let expected, String(window.id) != expected { fail("frontmost window changed; observe again before input") }
  return window
}

private func postMouse(_ type: CGEventType, point: CGPoint, button: CGMouseButton, clicks: Int64) {
  guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button)
  else { fail("could not create mouse event") }
  event.setIntegerValueField(.mouseEventClickState, value: clicks)
  event.post(tap: .cghidEventTap)
}

private func postKey(_ code: CGKeyCode, down: Bool, flags: CGEventFlags = [], text: [UniChar]? = nil) {
  guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)
  else { fail("could not create keyboard event") }
  event.flags = flags
  if let text {
    text.withUnsafeBufferPointer { characters in
      if let base = characters.baseAddress { event.keyboardSetUnicodeString(stringLength: characters.count, unicodeString: base) }
    }
  }
  event.post(tap: .cghidEventTap)
}

private func keyPair(_ code: CGKeyCode, flags: CGEventFlags = [], text: [UniChar]? = nil) {
  postKey(code, down: true, flags: flags, text: text)
  postKey(code, down: false, flags: flags, text: text)
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("missing command") }
let permission = permissions()
switch args[1] {
case "permissions":
  emit(["screenCapture": permission.capture, "inputControl": permission.input])
case "focus":
  guard permission.capture else { fail("screen capture permission is required") }
  emit(["windowId": String(requiredWindow().id)])
case "capture":
  guard permission.capture else { fail("screen capture permission is required") }
  let window = requiredWindow()
  guard let image = CGWindowListCreateImage(.null, [.optionIncludingWindow], window.id, [.boundsIgnoreFraming]),
    let destinationData = CFDataCreateMutable(nil, 0),
    let destination = CGImageDestinationCreateWithData(destinationData, "public.png" as CFString, 1, nil)
  else { fail("could not capture foreground window") }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination), let data = destinationData as Data?,
    !data.isEmpty, data.count <= 32 * 1024 * 1024 else { fail("captured image exceeds supported size") }
  var result: [String: Any] = [
    "windowId": String(window.id), "appName": window.name,
    "x": window.bounds.origin.x, "y": window.bounds.origin.y,
    "width": Int(window.bounds.width), "height": Int(window.bounds.height),
    "png": data.base64EncodedString(),
  ]
  if let title = window.title { result["windowTitle"] = title }
  emit(result)
case "click", "type":
  guard permission.capture else { fail("screen capture permission is required") }
  guard permission.input else { fail("input control permission is required") }
  guard args.count >= 5, let x = Double(args[3]), let y = Double(args[4]),
    x.isFinite, y.isFinite else { fail("invalid input position") }
  let window = requiredWindow(args[2])
  guard window.bounds.contains(CGPoint(x: x, y: y)) else { fail("input position left captured window") }
  let point = CGPoint(x: x, y: y)
  if args[1] == "click" {
    guard args.count == 7, let count = Int64(args[6]), count == 1 || count == 2,
      args[5] == "left" || args[5] == "right" else { fail("invalid click") }
    let button: CGMouseButton = args[5] == "left" ? .left : .right
    let down: CGEventType = args[5] == "left" ? .leftMouseDown : .rightMouseDown
    let up: CGEventType = args[5] == "left" ? .leftMouseUp : .rightMouseUp
    for click in 1...count {
      postMouse(down, point: point, button: button, clicks: click)
      postMouse(up, point: point, button: button, clicks: click)
    }
  } else {
    guard args.count == 8, let data = Data(base64Encoded: args[5]), data.count <= 32768,
      let value = String(data: data, encoding: .utf8),
      (args[6] == "0" || args[6] == "1"), (args[7] == "0" || args[7] == "1")
    else { fail("invalid text input") }
    postMouse(.leftMouseDown, point: point, button: .left, clicks: 1)
    postMouse(.leftMouseUp, point: point, button: .left, clicks: 1)
    _ = requiredWindow(args[2])
    if args[6] == "1" { keyPair(0, flags: .maskCommand) }
    let units = Array(value.utf16)
    var offset = 0
    while offset < units.count {
      _ = requiredWindow(args[2])
      var end = min(offset + 20, units.count)
      if end < units.count && units[end - 1] >= 0xD800 && units[end - 1] <= 0xDBFF { end -= 1 }
      keyPair(0, text: Array(units[offset..<end]))
      offset = end
    }
    if args[7] == "1" { keyPair(36) }
  }
  emit(["ok": true])
default:
  fail("unsupported command")
}
