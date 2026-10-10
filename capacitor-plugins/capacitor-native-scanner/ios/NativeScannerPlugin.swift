import AVFoundation
import Capacitor
import UIKit

@objc(NativeScannerPlugin)
public class NativeScannerPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "NativeScannerPlugin"
  public let jsName = "NativeScanner"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
  ]

  private var savedCall: CAPPluginCall?
  private weak var scannerViewController: NativeScannerViewController?

  @objc public func isSupported(_ call: CAPPluginCall) {
    call.resolve([
      "supported": true,
    ])
  }

  @objc public func scan(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      self.requestCameraAccessIfNeeded { granted in
        if !granted {
          call.reject("Camera permission denied.", "CAMERA_PERMISSION_DENIED")
          return
        }

        guard let presenter = self.bridge?.viewController else {
          call.reject("Unable to present scanner view controller.", "SCANNER_UNAVAILABLE")
          return
        }

        self.savedCall = call
        self.bridge?.saveCall(call)

        let controller = NativeScannerViewController(
          formats: call.getArray("formats", String.self) ?? [],
          torchEnabled: call.getBool("torch") ?? false
        )
        controller.delegate = self
        controller.modalPresentationStyle = .fullScreen
        self.scannerViewController = controller

        presenter.present(controller, animated: true)
      }
    }
  }

  private func requestCameraAccessIfNeeded(completion: @escaping (Bool) -> Void) {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      completion(true)
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async {
          completion(granted)
        }
      }
    case .denied, .restricted:
      completion(false)
    @unknown default:
      completion(false)
    }
  }

  private func finishCall() {
    if let call = savedCall {
      bridge?.releaseCall(call)
    }
    savedCall = nil
    scannerViewController = nil
  }
}

extension NativeScannerPlugin: NativeScannerViewControllerDelegate {
  func nativeScannerDidCancel(_ controller: NativeScannerViewController) {
    controller.dismiss(animated: true)
    savedCall?.reject("Scan canceled.", "SCAN_CANCELED")
    finishCall()
  }

  func nativeScanner(_ controller: NativeScannerViewController, didFail message: String) {
    controller.dismiss(animated: true)
    savedCall?.reject(message, "SCAN_FAILED")
    finishCall()
  }

  func nativeScanner(_ controller: NativeScannerViewController, didScan text: String, format: String?) {
    controller.dismiss(animated: true)
    savedCall?.resolve([
      "text": text,
      "format": format as Any,
      "cancelled": false,
    ])
    finishCall()
  }
}
