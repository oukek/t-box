require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))
Pod::Spec.new do |s|
  s.name = "TBoxCapacitorDeviceRuntime"
  s.version = package["version"]
  s.summary = "T Box device capabilities and durable shortcut runtime"
  s.license = "MIT"
  s.homepage = "https://capacitorjs.com"
  s.author = "T Box"
  s.source = { :path => "." }
  s.source_files = "ios/**/*.swift"
  s.ios.deployment_target = "15.4"
  s.dependency "Capacitor"
  s.frameworks = "EventKit", "EventKitUI", "Security", "UIKit"
  s.swift_version = "5.9"
end
