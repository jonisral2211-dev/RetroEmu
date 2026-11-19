// Target de la app: crea, actualiza y termina la Live Activity. El módulo nativo (Objective-C)
// la llama por nombre (NSClassFromString("JLLiveActivityBridge")), sin cabeceras Swift.
import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

@objc(JLLiveActivityBridge)
public final class JLLiveActivityBridge: NSObject {
  @objc public static func available() -> NSNumber {
    #if canImport(ActivityKit)
    if #available(iOS 16.2, *) {
      return NSNumber(value: ActivityAuthorizationInfo().areActivitiesEnabled)
    }
    #endif
    return NSNumber(value: false)
  }

  @objc public static func start(_ info: NSDictionary) -> NSNumber {
    #if canImport(ActivityKit)
    if #available(iOS 16.2, *) {
      return NSNumber(value: JLActivityController.shared.start(info))
    }
    #endif
    return NSNumber(value: false)
  }

  @objc public static func update(_ info: NSDictionary) -> NSNumber {
    #if canImport(ActivityKit)
    if #available(iOS 16.2, *) {
      JLActivityController.shared.update(info)
      return NSNumber(value: true)
    }
    #endif
    return NSNumber(value: false)
  }

  @objc public static func end() -> NSNumber {
    #if canImport(ActivityKit)
    if #available(iOS 16.2, *) {
      JLActivityController.shared.endAll()
      return NSNumber(value: true)
    }
    #endif
    return NSNumber(value: false)
  }
}

#if canImport(ActivityKit)
@available(iOS 16.2, *)
final class JLActivityController {
  static let shared = JLActivityController()
  private var activity: Activity<JLGameAttributes>?
  private var state = JLGameAttributes.ContentState(startedAt: Date(), paused: false, lastSave: "")

  private static func date(_ value: Any?) -> Date? {
    guard let ms = (value as? NSNumber)?.doubleValue, ms > 0 else { return nil }
    return Date(timeIntervalSince1970: ms / 1000.0)
  }

  func start(_ info: NSDictionary) -> Bool {
    endAll()
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
    let attributes = JLGameAttributes(
      title: (info["title"] as? String) ?? "JL Emulator",
      console: (info["console"] as? String) ?? "",
      accentHex: (info["accent"] as? String) ?? "#1A9FFF",
      cover: info["cover"] as? Data
    )
    state = JLGameAttributes.ContentState(
      startedAt: Self.date(info["startedAt"]) ?? Date(),
      paused: false,
      lastSave: ""
    )
    do {
      activity = try Activity.request(
        attributes: attributes,
        content: ActivityContent(state: state, staleDate: nil),
        pushType: nil
      )
      return true
    } catch {
      activity = nil
      return false
    }
  }

  func update(_ info: NSDictionary) {
    guard let activity else { return }
    if let paused = (info["paused"] as? NSNumber)?.boolValue { state.paused = paused }
    if let lastSave = info["lastSave"] as? String { state.lastSave = lastSave }
    if let started = Self.date(info["startedAt"]) { state.startedAt = started }
    let content = ActivityContent(state: state, staleDate: nil)
    Task { await activity.update(content) }
  }

  func endAll() {
    let all = Activity<JLGameAttributes>.activities
    activity = nil
    let final = ActivityContent(state: state, staleDate: nil)
    Task {
      for a in all { await a.end(final, dismissalPolicy: .immediate) }
    }
  }
}
#endif
