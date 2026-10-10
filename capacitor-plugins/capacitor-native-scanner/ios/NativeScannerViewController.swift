import AVFoundation
import UIKit

protocol NativeScannerViewControllerDelegate: AnyObject {
  func nativeScannerDidCancel(_ controller: NativeScannerViewController)
  func nativeScanner(_ controller: NativeScannerViewController, didFail message: String)
  func nativeScanner(_ controller: NativeScannerViewController, didScan text: String, format: String?)
}

final class NativeScannerViewController: UIViewController {
  weak var delegate: NativeScannerViewControllerDelegate?

  private let captureSession = AVCaptureSession()
  private let metadataOutput = AVCaptureMetadataOutput()
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private let requestedFormats: [String]
  private let initialTorchEnabled: Bool
  private var hasCompleted = false
  private let hintLabel = UILabel()
  private let closeButton = UIButton(type: .system)
  private let torchButton = UIButton(type: .system)

  init(formats: [String], torchEnabled: Bool) {
    self.requestedFormats = formats
    self.initialTorchEnabled = torchEnabled
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    setupCaptureSession()
    setupPreviewLayer()
    setupOverlay()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    previewLayer?.frame = view.bounds
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    DispatchQueue.global(qos: .userInitiated).async {
      if !self.captureSession.isRunning {
        self.captureSession.startRunning()
      }
      if self.initialTorchEnabled {
        DispatchQueue.main.async {
          self.setTorch(enabled: true)
        }
      }
    }
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    if captureSession.isRunning {
      captureSession.stopRunning()
    }
  }

  private func setupCaptureSession() {
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
      delegate?.nativeScanner(self, didFail: "Back camera is unavailable.")
      return
    }

    do {
      let input = try AVCaptureDeviceInput(device: device)
      guard captureSession.canAddInput(input) else {
        delegate?.nativeScanner(self, didFail: "Unable to access camera input.")
        return
      }
      captureSession.addInput(input)
    } catch {
      delegate?.nativeScanner(self, didFail: error.localizedDescription)
      return
    }

    guard captureSession.canAddOutput(metadataOutput) else {
      delegate?.nativeScanner(self, didFail: "Unable to configure barcode scanner.")
      return
    }

    captureSession.addOutput(metadataOutput)
    metadataOutput.setMetadataObjectsDelegate(self, queue: .main)

    let supportedTypes = Set(metadataOutput.availableMetadataObjectTypes)
    let mappedTypes = requestedFormats.isEmpty
      ? defaultMetadataTypes()
      : requestedFormats.compactMap(mapFormat)
    let activeTypes = mappedTypes.filter { supportedTypes.contains($0) }

    metadataOutput.metadataObjectTypes = activeTypes.isEmpty ? defaultMetadataTypes() : activeTypes
  }

  private func defaultMetadataTypes() -> [AVMetadataObject.ObjectType] {
    [.qr, .code128, .ean13, .ean8, .upce, .pdf417, .aztec, .dataMatrix]
  }

  private func setupPreviewLayer() {
    let layer = AVCaptureVideoPreviewLayer(session: captureSession)
    layer.videoGravity = .resizeAspectFill
    layer.frame = view.bounds
    view.layer.addSublayer(layer)
    previewLayer = layer
  }

  private func setupOverlay() {
    let overlay = UIView()
    overlay.translatesAutoresizingMaskIntoConstraints = false
    overlay.backgroundColor = UIColor.black.withAlphaComponent(0.25)
    view.addSubview(overlay)

    let frameView = UIView()
    frameView.translatesAutoresizingMaskIntoConstraints = false
    frameView.layer.borderWidth = 2
    frameView.layer.borderColor = UIColor.white.withAlphaComponent(0.9).cgColor
    frameView.layer.cornerRadius = 16
    frameView.backgroundColor = .clear
    view.addSubview(frameView)

    closeButton.translatesAutoresizingMaskIntoConstraints = false
    closeButton.setTitle("Close", for: .normal)
    closeButton.tintColor = .white
    closeButton.backgroundColor = UIColor.black.withAlphaComponent(0.45)
    closeButton.layer.cornerRadius = 10
    closeButton.contentEdgeInsets = UIEdgeInsets(top: 10, left: 14, bottom: 10, right: 14)
    closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
    view.addSubview(closeButton)

    torchButton.translatesAutoresizingMaskIntoConstraints = false
    torchButton.setTitle("Torch", for: .normal)
    torchButton.tintColor = .white
    torchButton.backgroundColor = UIColor.black.withAlphaComponent(0.45)
    torchButton.layer.cornerRadius = 10
    torchButton.contentEdgeInsets = UIEdgeInsets(top: 10, left: 14, bottom: 10, right: 14)
    torchButton.addTarget(self, action: #selector(torchTapped), for: .touchUpInside)
    torchButton.isHidden = !cameraHasTorch()
    view.addSubview(torchButton)

    hintLabel.translatesAutoresizingMaskIntoConstraints = false
    hintLabel.text = "Align the barcode inside the frame"
    hintLabel.textColor = .white
    hintLabel.font = .systemFont(ofSize: 14, weight: .medium)
    hintLabel.textAlignment = .center
    hintLabel.backgroundColor = UIColor.black.withAlphaComponent(0.45)
    hintLabel.layer.cornerRadius = 14
    hintLabel.layer.masksToBounds = true
    view.addSubview(hintLabel)

    NSLayoutConstraint.activate([
      overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      overlay.topAnchor.constraint(equalTo: view.topAnchor),
      overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),

      closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
      closeButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),

      torchButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
      torchButton.trailingAnchor.constraint(equalTo: closeButton.leadingAnchor, constant: -12),

      frameView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      frameView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      frameView.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.82),
      frameView.heightAnchor.constraint(equalTo: frameView.widthAnchor, multiplier: 0.62),

      hintLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
      hintLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
      hintLabel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
      hintLabel.heightAnchor.constraint(greaterThanOrEqualToConstant: 48),
    ])
  }

  @objc private func closeTapped() {
    delegate?.nativeScannerDidCancel(self)
  }

  @objc private func torchTapped() {
    guard let device = AVCaptureDevice.default(for: .video), device.hasTorch else {
      return
    }
    setTorch(enabled: !device.isTorchActive)
  }

  private func setTorch(enabled: Bool) {
    guard let device = AVCaptureDevice.default(for: .video), device.hasTorch else {
      return
    }

    do {
      try device.lockForConfiguration()
      if enabled {
        try device.setTorchModeOn(level: AVCaptureDevice.maxAvailableTorchLevel)
      } else {
        device.torchMode = .off
      }
      device.unlockForConfiguration()
      torchButton.setTitle(enabled ? "Torch Off" : "Torch", for: .normal)
    } catch {
      delegate?.nativeScanner(self, didFail: error.localizedDescription)
    }
  }

  private func cameraHasTorch() -> Bool {
    AVCaptureDevice.default(for: .video)?.hasTorch == true
  }

  private func mapFormat(_ format: String) -> AVMetadataObject.ObjectType? {
    switch format {
    case "aztec":
      return .aztec
    case "code_128":
      return .code128
    case "code_39":
      return .code39
    case "code_93":
      return .code93
    case "data_matrix":
      return .dataMatrix
    case "ean_13", "upc_a":
      return .ean13
    case "ean_8":
      return .ean8
    case "itf":
      return .itf14
    case "pdf_417":
      return .pdf417
    case "qr_code":
      return .qr
    case "upc_e":
      return .upce
    default:
      return nil
    }
  }
}

extension NativeScannerViewController: AVCaptureMetadataOutputObjectsDelegate {
  func metadataOutput(
    _ output: AVCaptureMetadataOutput,
    didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    if hasCompleted {
      return
    }

    guard let code = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first,
          let value = code.stringValue,
          !value.isEmpty else {
      return
    }

    hasCompleted = true
    captureSession.stopRunning()
    delegate?.nativeScanner(self, didScan: value, format: code.type.rawValue)
  }
}
