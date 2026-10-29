#import "AnnyLensInternal.h"
#import <QuartzCore/QuartzCore.h>

uint64_t AnnyLensNow(void) { return (uint64_t)(CACurrentMediaTime()*1000); }
BOOL AnnyLensValidURL(NSURL *url, BOOL stream) {
  if (![url.scheme isEqualToString:@"http"] || url.user || url.password || !url.host.length) return NO;
  NSString *host = url.host.lowercaseString;
  NSArray<NSString *> *parts = [host componentsSeparatedByString:@"."];
  BOOL ip = parts.count == 4;
  NSCharacterSet *notDigits = NSCharacterSet.decimalDigitCharacterSet.invertedSet;
  for (NSString *p in parts) if (!p.length || [p rangeOfCharacterFromSet:notDigits].location != NSNotFound || p.integerValue > 255) ip = NO;
  BOOL local = ip && ([parts[0] integerValue] == 10 || ([parts[0] integerValue] == 192 && [parts[1] integerValue] == 168) ||
    ([parts[0] integerValue] == 172 && [parts[1] integerValue] >= 16 && [parts[1] integerValue] <= 31));
  if (!local) {
    NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:@"^[a-z0-9][a-z0-9-]*\\.local$" options:0 error:nil];
    local = [regex numberOfMatchesInString:host options:0 range:NSMakeRange(0,host.length)] == 1;
  }
  return local && (stream ? [url.path isEqualToString:@"/stream"] : ([url.path hasPrefix:@"/api/"] || [url.path isEqualToString:@"/capture"]));
}

@implementation AnnyLensHTTPTask {
  NSURLSession *_session; NSURLSessionDataTask *_task; NSMutableData *_buffer;
  NSHTTPURLResponse *_response; AnnyLensHTTPCompletion _completion; BOOL (^_chunk)(NSData *);
  BOOL _done; NSUInteger _limit; NSTimeInterval _timeout;
}
- (instancetype)initWithURL:(NSURL *)url secret:(NSString *)secret body:(NSString *)body timeout:(NSTimeInterval)timeout
                      chunk:(BOOL (^)(NSData *))chunk completion:(AnnyLensHTTPCompletion)completion {
  if ((self = [super init])) {
    _completion = [completion copy]; _chunk = [chunk copy]; _buffer = [NSMutableData new];
    _limit = [url.path isEqualToString:@"/capture"] ? 1048576 : 16384;
    _timeout = MAX(1,MIN(timeout,30));
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:_timeout];
    NSString *auth = [[[@"admin:" stringByAppendingString:secret] dataUsingEncoding:NSUTF8StringEncoding] base64EncodedStringWithOptions:0];
    [request setValue:[@"Basic " stringByAppendingString:auth] forHTTPHeaderField:@"Authorization"];
    [request setValue:@"1" forHTTPHeaderField:@"X-Lentes-Request"];
    if (body) { request.HTTPMethod = @"POST"; request.HTTPBody = [body dataUsingEncoding:NSUTF8StringEncoding]; [request setValue:@"application/x-www-form-urlencoded" forHTTPHeaderField:@"Content-Type"]; }
    NSURLSessionConfiguration *config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    config.timeoutIntervalForRequest = _timeout;
    config.timeoutIntervalForResource = chunk ? 24*60*60 : _timeout;
    config.waitsForConnectivity = NO;
    NSOperationQueue *queue = [NSOperationQueue new]; queue.maxConcurrentOperationCount = 1;
    _session = [NSURLSession sessionWithConfiguration:config delegate:self delegateQueue:queue];
    _task = [_session dataTaskWithRequest:request];
  }
  return self;
}
- (void)start { @synchronized(self) { if (!_done) [_task resume]; } }
- (void)finish:(NSError *)error {
  AnnyLensHTTPCompletion completion; NSHTTPURLResponse *response; NSData *data;
  @synchronized(self) {
    if (_done) return; _done = YES;
    completion = _completion; _completion = nil; _chunk = nil; response = _response; data = [_buffer copy];
    [_session invalidateAndCancel]; _session = nil; _task = nil; _buffer = nil;
  }
  if (completion) completion(response,data,error);
}
- (void)cancel { [self finish:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorCancelled userInfo:@{NSLocalizedDescriptionKey:@"Conexión cancelada."}]]; }
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completionHandler {
  completionHandler(nil); // Never forward lens credentials to a redirect target.
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))handler {
  BOOL accepted;
  @synchronized(self) {
    _response = [response isKindOfClass:NSHTTPURLResponse.class] ? (NSHTTPURLResponse *)response : nil;
    accepted = !_done && _response && (_chunk ? (_response.statusCode == 200 && [_response.MIMEType.lowercaseString isEqualToString:@"multipart/x-mixed-replace"]) : response.expectedContentLength <= (long long)_limit);
  }
  handler(accepted ? NSURLSessionResponseAllow : NSURLSessionResponseCancel);
  if (!accepted) [self finish:[NSError errorWithDomain:@"AnnyLens" code:1 userInfo:@{NSLocalizedDescriptionKey:@"Los lentes no devolvieron una respuesta válida."}]];
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
  BOOL valid = YES;
  @synchronized(self) {
    if (_done) return;
    if (_chunk) valid = _chunk(data);
    else if (_buffer.length+data.length <= _limit) [_buffer appendData:data]; else valid = NO;
  }
  if (!valid) [self finish:[NSError errorWithDomain:@"AnnyLens" code:2 userInfo:@{NSLocalizedDescriptionKey:@"La imagen de los lentes está incompleta."}]];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error { [self finish:error]; }
@end

@interface LocalLensNetwork : NSObject <RCTBridgeModule>
@end
@implementation LocalLensNetwork { NSMutableDictionary<NSString *,AnnyLensHTTPTask *> *_requests; }
RCT_EXPORT_MODULE(LocalLensNetwork)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (instancetype)init { if ((self=[super init])) _requests=[NSMutableDictionary new]; return self; }
RCT_EXPORT_METHOD(request:(NSString *)identifier target:(NSString *)target secret:(NSString *)secret body:(NSString *)body timeout:(double)timeout resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSURL *url = [NSURL URLWithString:target];
  if (!AnnyLensValidURL(url,NO) || [body lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>16384) { reject(@"LENS_NETWORK",@"Dirección de los lentes no válida.",nil); return; }
  @synchronized(self) {
    if (_requests[identifier]) { reject(@"LENS_NETWORK",@"Solicitud duplicada.",nil); return; }
    __weak LocalLensNetwork *weakSelf = self;
    AnnyLensHTTPTask *pending = [[AnnyLensHTTPTask alloc] initWithURL:url secret:secret body:body timeout:timeout/1000 chunk:nil completion:^(NSHTTPURLResponse *response, NSData *data, NSError *error) {
      LocalLensNetwork *owner = weakSelf;
      if (owner) { @synchronized(owner) { [owner->_requests removeObjectForKey:identifier]; } }
      if (error) { reject(@"LENS_NETWORK",error.code == NSURLErrorCancelled ? @"Conexión cancelada." : @"No se pudo acceder a los lentes. Revisá el permiso de Red local y la conexión Wi-Fi.",error); return; }
      NSString *payload = [url.path isEqualToString:@"/capture"] ? [data base64EncodedStringWithOptions:0] : [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
      resolve(@{@"status":@(response.statusCode),@"contentType":response.MIMEType ?: @"",@"body":payload ?: @""});
    }];
    _requests[identifier] = pending; [pending start];
  }
}
RCT_EXPORT_METHOD(cancel:(NSString *)identifier) { AnnyLensHTTPTask *task; @synchronized(self) { task=_requests[identifier]; } [task cancel]; }
- (void)invalidate { NSArray *tasks; @synchronized(self) { tasks=_requests.allValues; [_requests removeAllObjects]; } for (AnnyLensHTTPTask *task in tasks) [task cancel]; }
@end
