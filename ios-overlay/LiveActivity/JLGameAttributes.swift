// Datos de la Live Activity de la partida. Se compila en la app y en la extensión JLLiveActivity
// (deben coincidir byte a byte). Todo cabe en 4 KB: la carátula va como JPEG diminuto.
import Foundation

#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.2, *)
public struct JLGameAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /** Inicio de la sesión (el contador del tiempo de juego se dibuja desde aquí). */
    public var startedAt: Date
    public var paused: Bool
    /** Texto corto del último guardado ("Guardado 14:32") o vacío. */
    public var lastSave: String

    public init(startedAt: Date, paused: Bool, lastSave: String) {
      self.startedAt = startedAt
      self.paused = paused
      self.lastSave = lastSave
    }
  }

  public var title: String
  public var console: String
  public var accentHex: String
  public var cover: Data?

  public init(title: String, console: String, accentHex: String, cover: Data?) {
    self.title = title
    self.console = console
    self.accentHex = accentHex
    self.cover = cover
  }
}
#endif
