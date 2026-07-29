#import <React/RCTBridgeModule.h>

// ObjC bridge that exposes the Swift `OneloAttest` class to the React Native
// bridge. `RCT_EXTERN_MODULE` registers the module under the JS name
// `NativeModules.OneloAttest`; each `RCT_EXTERN_METHOD` mirrors a Swift method
// signature exactly (selector pieces + argument labels must match, or the call
// silently no-ops at runtime).
@interface RCT_EXTERN_MODULE(OneloAttest, NSObject)

RCT_EXTERN_METHOD(isSupported:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getBundleId:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(generateKey:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(attestKey:(NSString *)keyId
                  challenge:(NSString *)challenge
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(generateAssertion:(NSString *)keyId
                  clientData:(NSString *)clientData
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Keep off the main queue — App Attest does no UI work. Mirrors the Swift
// `requiresMainQueueSetup` so the bridge doesn't warn about an unspecified value.
+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
