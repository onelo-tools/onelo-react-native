require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# Native iOS App Attest module for @onelo/react-native.
#
# React Native autolinking discovers this podspec by its presence in the package
# root, so a host app only needs `pod install` — no manual Podfile edit. The
# module is iOS-only; on Android autolinking finds no native code and does
# nothing (Play Integrity is a separate future task).
Pod::Spec.new do |s|
  s.name         = "onelo-react-native"
  s.version      = package["version"].sub("-staging", "")
  s.summary      = package["description"]
  s.description  = "Apple App Attest support for the Onelo React Native SDK."
  s.homepage     = "https://onelo.tools"
  s.license      = { :type => "MIT" }
  s.authors      = { "Onelo" => "hello@onelo.tools" }
  s.platforms    = { :ios => "14.0" }
  s.source       = { :git => "https://github.com/onelo-tools/onelo-react-native.git", :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"

  # DeviceCheck: DCAppAttestService. CryptoKit: SHA256 of the challenge.
  s.frameworks   = "DeviceCheck", "CryptoKit"

  s.swift_version = "5.0"

  # The Swift file resolves React bridge types via `import React` (a module
  # import), NOT a bridging header — bridging headers are unsupported when the
  # pod is built as a framework target (New Architecture / use_frameworks!, the
  # default on modern RN). DEFINES_MODULE lets the generated Swift umbrella
  # header be imported. See #22.
  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES"
  }

  s.dependency "React-Core"
end
