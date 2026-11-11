// A person's mouse and keys on a Mac, as system events, for checks of the real app window.
//   mac-input bounds              the app window: x y width height
//   mac-input click X Y [count]   count 2 is a double click
//   mac-input drag X1 Y1 X2 Y2
//   mac-input type TEXT
import Cocoa

let args = CommandLine.arguments
func post(_ event: CGEvent?) {
    event?.post(tap: .cghidEventTap)
    usleep(40_000)
}
func mouse(_ type: CGEventType, _ at: CGPoint, clicks: Int64 = 1) {
    let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: at, mouseButton: .left)
    event?.setIntegerValueField(.mouseEventClickState, value: clicks)
    post(event)
}
func point(_ i: Int) -> CGPoint { CGPoint(x: Double(args[i])!, y: Double(args[i + 1])!) }

switch args[1] {
case "bounds":
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
    let ours = windows.filter { ($0[kCGWindowOwnerName as String] as? String ?? "").lowercased().contains("polyzon") }
    let sizes = ours.compactMap { $0[kCGWindowBounds as String] as? [String: Double] }
    if let b = sizes.max(by: { $0["Width"]! * $0["Height"]! < $1["Width"]! * $1["Height"]! }) {
        print(Int(b["X"]!), Int(b["Y"]!), Int(b["Width"]!), Int(b["Height"]!))
    } else {
        print("no window")
        exit(1)
    }
case "click":
    let at = point(2)
    let count = Int64(args.count > 4 ? args[4] : "1")!
    mouse(.mouseMoved, at)
    for i in 1...count {
        mouse(.leftMouseDown, at, clicks: i)
        mouse(.leftMouseUp, at, clicks: i)
    }
case "drag":
    let (from, to) = (point(2), point(4))
    mouse(.mouseMoved, from)
    mouse(.leftMouseDown, from)
    for step in 1...12 {
        let t = Double(step) / 12
        mouse(.leftMouseDragged, CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t))
    }
    mouse(.leftMouseUp, to)
default:
    for unit in args[2].utf16 {
        var c = unit
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
            event?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &c)
            post(event)
        }
    }
}
