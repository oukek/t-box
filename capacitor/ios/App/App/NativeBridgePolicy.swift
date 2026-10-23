import Foundation

/** No caller-supplied app ID, request options, or URL string can bypass frame/origin fencing. */
enum NativeBridgePolicy {
  static func allows(mainFrame: Bool, scheme: String, host: String, port: Int, allowed: [URL]) -> Bool {
    guard mainFrame else { return false }
    func effectivePort(_ scheme: String, _ port: Int?) -> Int { port ?? (scheme == "https" ? 443 : scheme == "http" ? 80 : 0) }
    return allowed.contains { url in
      let expectedScheme = url.scheme?.lowercased() ?? ""
      return scheme.lowercased() == expectedScheme && host.lowercased() == url.host?.lowercased() && effectivePort(scheme, port == 0 ? nil : port) == effectivePort(expectedScheme, url.port)
    }
  }
}
