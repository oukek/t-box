require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))
Pod::Spec.new do |s|
  s.name = "TBoxCapacitorWechatPay"
  s.version = package["version"]
  s.summary = "T Box WeChat APP payment bridge"
  s.license = "MIT"
  s.homepage = "https://capacitorjs.com"
  s.author = "T Box"
  s.source = { :path => "." }
  s.source_files = "ios/**/*.{swift,h,m}"
  s.ios.deployment_target = "15.4"
  s.dependency "Capacitor"
  s.dependency "WechatOpenSDK-XCFramework", "2.0.9"
  s.static_framework = true
  s.swift_version = "5.9"
end
