#import "AnnyLensInternal.h"
#import <Security/Security.h>

@interface LocalLensCredentials : NSObject <RCTBridgeModule>
@end
@implementation LocalLensCredentials
RCT_EXPORT_MODULE(LocalLensCredentials)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (NSMutableDictionary *)key {
  return [@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService:[NSBundle.mainBundle.bundleIdentifier stringByAppendingString:@".lens-pairing"],
            (__bridge id)kSecAttrAccount:@"paired-lens"} mutableCopy];
}
RCT_EXPORT_METHOD(get:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableDictionary *query=[self key]; query[(__bridge id)kSecReturnData]=@YES; query[(__bridge id)kSecMatchLimit]=(__bridge id)kSecMatchLimitOne;
  CFTypeRef result=NULL; OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)query,&result);
  if (status==errSecItemNotFound) { resolve(nil); return; }
  if (status!=errSecSuccess) { reject(@"PAIRING_STORAGE",@"No se pudo leer la vinculación segura de los lentes.",nil); return; }
  NSData *data=CFBridgingRelease(result); resolve([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]);
}
RCT_EXPORT_METHOD(set:(NSString *)value resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSData *data=[value dataUsingEncoding:NSUTF8StringEncoding];
  if (!data || data.length>16384) { reject(@"PAIRING_STORAGE",@"La vinculación no es válida.",nil); return; }
  NSDictionary *attributes=@{(__bridge id)kSecValueData:data,(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly};
  NSMutableDictionary *key=[self key]; OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)key,(__bridge CFDictionaryRef)attributes);
  if (status==errSecItemNotFound) { [key addEntriesFromDictionary:attributes]; status=SecItemAdd((__bridge CFDictionaryRef)key,NULL); }
  if (status==errSecSuccess) resolve(nil); else reject(@"PAIRING_STORAGE",@"No se pudo guardar la vinculación segura de los lentes.",nil);
}
@end

@implementation AnnyLensFrames {
  NSCondition *_condition; NSObject *_owner; NSString *_endpoint; NSString *_credential; NSData *_jpeg; uint64_t _received;
}
+ (instancetype)shared { static AnnyLensFrames *store; static dispatch_once_t once; dispatch_once(&once,^{store=[AnnyLensFrames new];}); return store; }
- (instancetype)init { if ((self=[super init])) _condition=[NSCondition new]; return self; }
- (void)begin:(NSObject *)owner endpoint:(NSString *)endpoint credential:(NSString *)credential { [_condition lock]; _owner=owner; _endpoint=endpoint; _credential=credential; _jpeg=nil; _received=0; [_condition broadcast]; [_condition unlock]; }
- (void)publish:(NSData *)jpeg owner:(NSObject *)owner { [_condition lock]; if (_owner==owner) { _jpeg=jpeg; _received=AnnyLensNow(); [_condition broadcast]; } [_condition unlock]; }
- (void)invalidate:(NSObject *)owner { [_condition lock]; if (_owner==owner) { _jpeg=nil; _received=0; [_condition broadcast]; } [_condition unlock]; }
- (void)clear:(NSObject *)owner { [_condition lock]; if (_owner==owner) { _owner=nil; _jpeg=nil; _credential=nil; _endpoint=nil; [_condition broadcast]; } [_condition unlock]; }
- (NSString *)capture:(NSString *)endpoint credential:(NSString *)credential wait:(BOOL)wait error:(NSError **)error {
  [_condition lock];
  if (!_owner || ![_endpoint isEqualToString:endpoint] || ![_credential isEqualToString:credential]) { [_condition unlock]; return nil; }
  NSObject *owner=_owner; uint64_t deadline=AnnyLensNow()+2000; NSData *frame;
  while (_owner==owner) {
    if (_jpeg && AnnyLensNow()-_received<=500) { frame=_jpeg; break; }
    if (!wait || AnnyLensNow()>=deadline) break;
    [_condition waitUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
  }
  BOOL same=_owner==owner; [_condition unlock];
  if (!frame || !same) {
    if (wait && error) *error=[NSError errorWithDomain:@"AnnyLens" code:1 userInfo:@{NSLocalizedDescriptionKey:same ? @"La cámara está demorada. Esperá una imagen nueva y reintentá." : @"La cámara se cerró. Volvé a abrirla para capturar."}];
    return nil;
  }
  NSString *encoded=[frame base64EncodedStringWithOptions:0];
  [_condition lock]; same=_owner==owner; [_condition unlock];
  if (!same) { if (error) *error=[NSError errorWithDomain:@"AnnyLens" code:1 userInfo:@{NSLocalizedDescriptionKey:@"Captura cancelada."}]; return nil; }
  return encoded;
}
@end
@interface LocalLensFrames : NSObject <RCTBridgeModule>
@end
@implementation LocalLensFrames
RCT_EXPORT_MODULE(LocalLensFrames)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { static dispatch_queue_t queue; static dispatch_once_t once; dispatch_once(&once,^{queue=dispatch_queue_create("anny.lens.captures",DISPATCH_QUEUE_SERIAL);}); return queue; }
RCT_EXPORT_METHOD(captureStreamFrame:(NSString *)endpoint credential:(NSString *)credential resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *error; NSString *frame=[[AnnyLensFrames shared] capture:endpoint credential:credential wait:YES error:&error];
  if (error) reject(@"E_LENS_FRAME",error.localizedDescription,error); else resolve(frame);
}
RCT_EXPORT_METHOD(getLatestFrame:(NSString *)endpoint credential:(NSString *)credential resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve([[AnnyLensFrames shared] capture:endpoint credential:credential wait:NO error:nil]);
}
@end
