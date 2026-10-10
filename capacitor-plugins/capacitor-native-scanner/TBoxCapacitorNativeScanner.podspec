require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name = "TBoxCapacitorNativeScanner"
  s.version = package["version"]
  s.summary = "Native barcode scanner plugin for Capacitor"
  s.license = "MIT"
  s.homepage = "https://capacitorjs.com"
  s.author = "T Box"
  s.source = { :path => "." }
  s.source_files = "ios/**/*.{swift,h,m}"
  s.ios.deployment_target = "15.4"
  s.dependency "Capacitor"
  s.swift_version = "5.9"
end
