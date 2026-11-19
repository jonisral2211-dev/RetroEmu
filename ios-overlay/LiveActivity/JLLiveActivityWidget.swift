// Extensión de widgets (JLLiveActivity): dibuja la partida en la Dynamic Island y en la pantalla
// de bloqueo. Los botones abren la app con jlemu://save (guardar estado) o jlemu://resume.
import ActivityKit
import SwiftUI
import UIKit
import WidgetKit

private let saveURL = URL(string: "jlemu://save")!
private let resumeURL = URL(string: "jlemu://resume")!

private extension Color {
  init(hex: String) {
    let clean = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    var value: UInt64 = 0x1A9FFF
    Scanner(string: clean).scanHexInt64(&value)
    self.init(
      red: Double((value >> 16) & 0xFF) / 255.0,
      green: Double((value >> 8) & 0xFF) / 255.0,
      blue: Double(value & 0xFF) / 255.0
    )
  }
}

private struct CoverView: View {
  let data: Data?
  let size: CGFloat
  let accent: Color

  var body: some View {
    Group {
      if let data, let image = UIImage(data: data) {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        ZStack {
          LinearGradient(colors: [accent, accent.opacity(0.35)], startPoint: .topLeading, endPoint: .bottomTrailing)
          Image(systemName: "gamecontroller.fill").foregroundColor(.white).font(.system(size: size * 0.45))
        }
      }
    }
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
  }
}

private struct SessionTimer: View {
  let state: JLGameAttributes.ContentState

  var body: some View {
    if state.paused {
      Text("En pausa")
    } else {
      Text(timerInterval: state.startedAt...Date.distantFuture, countsDown: false)
        .monospacedDigit()
    }
  }
}

private struct ActionButton: View {
  let title: String
  let symbol: String
  let url: URL
  let tint: Color

  var body: some View {
    Link(destination: url) {
      HStack(spacing: 6) {
        Image(systemName: symbol)
        Text(title).fontWeight(.semibold)
      }
      .font(.system(size: 13))
      .foregroundColor(.white)
      .padding(.vertical, 7)
      .frame(maxWidth: .infinity)
      .background(tint, in: Capsule())
    }
  }
}

private struct LockScreenView: View {
  let context: ActivityViewContext<JLGameAttributes>

  var body: some View {
    let accent = Color(hex: context.attributes.accentHex)
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 12) {
        CoverView(data: context.attributes.cover, size: 54, accent: accent)
        VStack(alignment: .leading, spacing: 2) {
          Text(context.attributes.title).font(.headline).foregroundColor(.white).lineLimit(1)
          Text(context.attributes.console.uppercased())
            .font(.caption2).fontWeight(.heavy).foregroundColor(accent)
          if !context.state.lastSave.isEmpty {
            Text(context.state.lastSave).font(.caption2).foregroundColor(.white.opacity(0.6))
          }
        }
        Spacer(minLength: 4)
        VStack(alignment: .trailing, spacing: 2) {
          Text("SESIÓN").font(.system(size: 9, weight: .heavy)).foregroundColor(.white.opacity(0.5))
          SessionTimer(state: context.state).font(.system(size: 20, weight: .bold)).foregroundColor(.white)
            .frame(maxWidth: 96, alignment: .trailing)
        }
      }
      HStack(spacing: 10) {
        ActionButton(title: "Guardar estado", symbol: "square.and.arrow.down.fill", url: saveURL,
                     tint: Color.white.opacity(0.18))
        ActionButton(title: "Volver al juego", symbol: "play.fill", url: resumeURL,
                     tint: Color(red: 0.36, green: 0.72, blue: 0.16))
      }
    }
    .padding(14)
  }
}

struct JLGameLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: JLGameAttributes.self) { context in
      LockScreenView(context: context)
        .activityBackgroundTint(Color(red: 0.04, green: 0.06, blue: 0.09).opacity(0.92))
        .activitySystemActionForegroundColor(.white)
        .widgetURL(resumeURL)
    } dynamicIsland: { context in
      let accent = Color(hex: context.attributes.accentHex)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          CoverView(data: context.attributes.cover, size: 50, accent: accent).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          SessionTimer(state: context.state)
            .font(.system(size: 17, weight: .bold)).foregroundColor(accent)
            .frame(maxWidth: 80, alignment: .trailing)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(spacing: 2) {
            Text(context.attributes.title).font(.subheadline).fontWeight(.semibold).lineLimit(1)
            Text(context.attributes.console.uppercased()).font(.caption2).foregroundColor(.secondary)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack(spacing: 10) {
            ActionButton(title: "Guardar", symbol: "square.and.arrow.down.fill", url: saveURL,
                         tint: Color.white.opacity(0.18))
            ActionButton(title: "Volver", symbol: "play.fill", url: resumeURL,
                         tint: Color(red: 0.36, green: 0.72, blue: 0.16))
          }
          .padding(.top, 4)
        }
      } compactLeading: {
        CoverView(data: context.attributes.cover, size: 22, accent: accent)
      } compactTrailing: {
        SessionTimer(state: context.state)
          .font(.system(size: 13, weight: .semibold)).foregroundColor(accent)
          .frame(maxWidth: 52)
      } minimal: {
        CoverView(data: context.attributes.cover, size: 22, accent: accent)
      }
      .widgetURL(resumeURL)
      .keylineTint(accent)
    }
  }
}

@main
struct JLLiveActivityBundle: WidgetBundle {
  var body: some Widget {
    JLGameLiveActivity()
  }
}
