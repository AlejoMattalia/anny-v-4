#import "AnnyLensInternal.h"
#import "AnnyLensProtocol.h"
#import <React/RCTViewManager.h>
#import <React/RCTComponent.h>
#import <ImageIO/ImageIO.h>
#import <QuartzCore/QuartzCore.h>
#import <sys/socket.h>
#import <sys/select.h>
#import <netinet/in.h>
#import <netdb.h>
#import <unistd.h>
#include <atomic>
#include <memory>

@interface AnnyLensReceiver : NSObject
@property(atomic) BOOL stopped;
@property(nonatomic,copy) void (^image)(UIImage *);
- (instancetype)initWithEndpoint:(NSString *)endpoint credential:(NSString *)credential;
- (void)start;
- (void)stop;
@end
@implementation AnnyLensReceiver {
  NSString *_endpoint, *_credential; AnnyLensHTTPTask *_task;
  NSData *_pending; BOOL _pendingPartial, _decoding;
  std::atomic<uint64_t> _lastDecoded;
}
- (instancetype)initWithEndpoint:(NSString *)endpoint credential:(NSString *)credential {
  if ((self=[super init])) { _endpoint=[endpoint copy]; _credential=[credential copy]; _lastDecoded=AnnyLensNow(); }
  return self;
}
- (void)stop {
  self.stopped=YES; AnnyLensHTTPTask *task;
  @synchronized(self) { task=_task; _task=nil; _pending=nil; }
  [task cancel]; [[AnnyLensFrames shared] clear:self];
}
- (void)start {
  [[AnnyLensFrames shared] begin:self endpoint:_endpoint credential:_credential];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{ @autoreleasepool {
    if (!AnnyLensValidURL([NSURL URLWithString:self->_endpoint],YES)) { [self stop]; return; }
    [self receiveUDP];
    while (!self.stopped) { [self receiveHTTP]; for (int i=0;i<15 && !self.stopped;i++) usleep(50000); }
  }});
}
- (void)offer:(const anny::Frame &)frame {
  if (self.stopped) return;
  @synchronized(self) {
    _pending=[NSData dataWithBytes:frame.bytes.data() length:frame.bytes.size()]; _pendingPartial=frame.partial;
    if (_decoding) return; _decoding=YES;
  }
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{
    for (;;) { @autoreleasepool {
      NSData *data; BOOL partial;
      @synchronized(self) {
        data=self->_pending; partial=self->_pendingPartial; self->_pending=nil;
        if (self.stopped || !data) { self->_decoding=NO; return; }
      }
      CGImageSourceRef source=CGImageSourceCreateWithData((__bridge CFDataRef)data,NULL);
      CGImageRef cg=source ? CGImageSourceCreateImageAtIndex(source,0,(__bridge CFDictionaryRef)@{(__bridge id)kCGImageSourceShouldCacheImmediately:@YES}) : NULL;
      if (source) CFRelease(source);
      if (!cg) continue;
      UIImage *image=[UIImage imageWithCGImage:cg]; CGImageRelease(cg);
      if (self.stopped) continue;
      self->_lastDecoded.store(AnnyLensNow());
      if (!partial) [[AnnyLensFrames shared] publish:data owner:self];
      if (self.image) self.image(image);
    }}
  });
}
- (void)receiveHTTP {
  _lastDecoded.store(AnnyLensNow());
  [[AnnyLensFrames shared] invalidate:self];
  auto parser=std::make_shared<anny::MJPEG>(); dispatch_semaphore_t done=dispatch_semaphore_create(0);
  __weak AnnyLensReceiver *weakSelf=self;
  AnnyLensHTTPTask *task=[[AnnyLensHTTPTask alloc] initWithURL:[NSURL URLWithString:_endpoint] secret:_credential body:nil timeout:8 chunk:^BOOL(NSData *data) {
    AnnyLensReceiver *owner=weakSelf; if (!owner || owner.stopped) return NO;
    std::vector<anny::Frame> frames;
    if (!parser->append((const uint8_t *)data.bytes,data.length,frames)) return NO;
    for (const auto &frame:frames) [owner offer:frame];
    return AnnyLensNow()-owner->_lastDecoded.load()<15000;
  } completion:^(NSHTTPURLResponse *response, NSData *data, NSError *error) { dispatch_semaphore_signal(done); }];
  @synchronized(self) { if (self.stopped) { [task cancel]; return; } _task=task; }
  [task start];
  while (!self.stopped && dispatch_semaphore_wait(done,dispatch_time(DISPATCH_TIME_NOW,100*NSEC_PER_MSEC))) {
    if (AnnyLensNow()-_lastDecoded.load()>15000) break;
  }
  [task cancel]; @synchronized(self) { if (_task==task) _task=nil; }
}
- (NSDictionary *)negotiate:(int)port {
  NSURL *url=[NSURL URLWithString:@"/api/stream/udp" relativeToURL:[NSURL URLWithString:_endpoint]].absoluteURL;
  NSString *body=[NSString stringWithFormat:@"port=%d&partial=1&ack=0&fec=1&fec_group=2&feedback=1",port];
  uint64_t deadline=AnnyLensNow()+6000;
  while (!self.stopped) {
    dispatch_semaphore_t done=dispatch_semaphore_create(0);
    __block NSDictionary *reply; __block NSInteger status=0;
    AnnyLensHTTPTask *task=[[AnnyLensHTTPTask alloc] initWithURL:url secret:_credential body:body timeout:8 chunk:nil completion:^(NSHTTPURLResponse *response,NSData *data,NSError *error) {
      status=response.statusCode;
      if (!error && status==200) { id json=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil]; if ([json isKindOfClass:NSDictionary.class]) reply=json; }
      dispatch_semaphore_signal(done);
    }];
    @synchronized(self) { if (self.stopped) { [task cancel]; return nil; } _task=task; }
    [task start]; dispatch_semaphore_wait(done,DISPATCH_TIME_FOREVER);
    @synchronized(self) { if (_task==task) _task=nil; }
    if (reply || status!=409 || AnnyLensNow()>=deadline) return reply;
    for (int i=0;i<5 && !self.stopped;i++) usleep(50000);
  }
  return nil;
}
- (void)receiveUDP {
  int fd=socket(AF_INET,SOCK_DGRAM,0); if (fd<0) return;
  // fd is closed only by this worker. stop() invalidates its owner and lets
  // the 10 ms select deadline unwind, avoiding reuse of a closed descriptor.
  std::unique_ptr<int,void(*)(int *)> socketOwner(&fd,[](int *s){ close(*s); });
  sockaddr_in local{}; local.sin_family=AF_INET; local.sin_addr.s_addr=htonl(INADDR_ANY);
  if (bind(fd,(sockaddr *)&local,sizeof(local))) return;
  socklen_t localSize=sizeof(local); if (getsockname(fd,(sockaddr *)&local,&localSize)) return;
  int receiveSize=256*1024; setsockopt(fd,SOL_SOCKET,SO_RCVBUF,&receiveSize,sizeof(receiveSize));
  NSDictionary *config=[self negotiate:ntohs(local.sin_port)]; if (!config || self.stopped) return;
  auto number=[&](NSString *key)->NSInteger { id value=config[key]; return [value isKindOfClass:NSNumber.class] ? [value integerValue] : -1; };
  if (number(@"version")!=1 || number(@"payload")!=1400 || number(@"max_frame")!=65536 || number(@"port")<1024 || number(@"port")>65535) return;
  NSString *token=config[@"token"];
  if (![token isKindOfClass:NSString.class] || token.length!=32 || [token rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"].invertedSet].location!=NSNotFound) return;
  std::array<uint8_t,16> bytes{};
  for (unsigned i=0;i<16;i++) { unsigned value=0; [[NSScanner scannerWithString:[token substringWithRange:NSMakeRange(i*2,2)]] scanHexInt:&value]; bytes[i]=value; }
  NSInteger fec=number(@"fec"); if (fec<0) fec=0; if (fec!=0 && fec!=2 && fec!=4) return;
  NSURL *url=[NSURL URLWithString:_endpoint]; addrinfo hints{}, *addresses=nullptr; hints.ai_family=AF_INET; hints.ai_socktype=SOCK_DGRAM;
  if (getaddrinfo(url.host.UTF8String,NULL,&hints,&addresses)) return;
  sockaddr_in remote=*(sockaddr_in *)addresses->ai_addr; freeaddrinfo(addresses); remote.sin_port=htons(number(@"port"));
  if (connect(fd,(sockaddr *)&remote,sizeof(remote))) return;
  anny::Receiver receiver(bytes,(int)fec,number(@"partial")==1,AnnyLensNow());
  const bool feedback=number(@"feedback")==1; uint64_t heartbeat=0;
  std::array<uint8_t,anny::headerSize+anny::payloadSize+1> packet{};
  _lastDecoded.store(AnnyLensNow());
  while (!self.stopped) {
    auto now=AnnyLensNow();
    if (!heartbeat || now-heartbeat>=1000) { auto p=receiver.control(feedback?4:1,now); send(fd,p.data(),p.size(),0); heartbeat=now; }
    if (now-receiver.lastPacket>=5000 || now-_lastDecoded.load()>=15000) break;
    for (const auto &frame:receiver.expire(now)) [self offer:frame];
    fd_set readSet; FD_ZERO(&readSet); FD_SET(fd,&readSet); timeval wait{0,10000};
    int ready=select(fd+1,&readSet,NULL,NULL,&wait); if (ready<0) break; if (!ready) continue;
    ssize_t size=recv(fd,packet.data(),packet.size(),0); if (size<=0) break;
    for (const auto &frame:receiver.receive(packet.data(),(size_t)size,AnnyLensNow())) [self offer:frame];
  }
  auto stop=receiver.control(2,AnnyLensNow()); send(fd,stop.data(),stop.size(),0);
}
@end

@interface AnnyLensDisplayTarget : NSObject
@property(nonatomic,weak) id target;
- (void)tick:(CADisplayLink *)link;
@end
@interface LocalLensStreamView : UIView
@property(nonatomic,copy) NSString *endpoint;
@property(nonatomic,copy) NSString *credential;
@property(nonatomic,copy) RCTDirectEventBlock onStreamReady;
@property(nonatomic,copy) RCTDirectEventBlock onStreamFrame;
- (void)tick:(CADisplayLink *)link;
@end
@implementation AnnyLensDisplayTarget
- (void)tick:(CADisplayLink *)link { [self.target tick:link]; }
@end
@implementation LocalLensStreamView {
  UIImageView *_image; UILabel *_status; AnnyLensReceiver *_receiver; CADisplayLink *_display;
  UIImage *_pendingImage; BOOL _announced; uint64_t _lastNotice; NSString *_configuration;
}
- (instancetype)initWithFrame:(CGRect)frame {
  if ((self=[super initWithFrame:frame])) {
    self.backgroundColor=UIColor.blackColor; _image=[UIImageView new]; _image.contentMode=UIViewContentModeScaleAspectFit; [self addSubview:_image];
    _status=[UILabel new]; _status.textColor=UIColor.whiteColor; _status.backgroundColor=[UIColor.blackColor colorWithAlphaComponent:0.6]; _status.text=@"Conectando video…"; [self addSubview:_status];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(pause) name:UIApplicationDidEnterBackgroundNotification object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(refresh) name:UIApplicationDidBecomeActiveNotification object:nil];
  }
  return self;
}
- (void)layoutSubviews { [super layoutSubviews]; _image.frame=self.bounds; _status.frame=CGRectMake(6,6,MIN(260,self.bounds.size.width-12),28); }
- (void)setEndpoint:(NSString *)endpoint { _endpoint=[endpoint copy]; }
- (void)setCredential:(NSString *)credential { _credential=[credential copy]; }
// React delivers both props before starting a connection with their new values.
- (void)didSetProps:(NSArray<NSString *> *)changedProps { [self refresh]; }
- (void)didMoveToWindow { [super didMoveToWindow]; if (self.window) [self refresh]; else [self pause]; }
- (void)pause {
  AnnyLensReceiver *receiver;
  @synchronized(self) { receiver=_receiver; _receiver=nil; _pendingImage=nil; }
  [receiver stop]; _configuration=nil; [_display invalidate]; _display=nil;
}
- (void)refresh {
  if (!self.window || !_endpoint.length || !_credential.length || UIApplication.sharedApplication.applicationState==UIApplicationStateBackground) return;
  NSString *configuration=[NSString stringWithFormat:@"%@\n%@",_endpoint,_credential]; if ([_configuration isEqualToString:configuration]) return;
  [self pause]; _configuration=configuration; _announced=NO; _lastNotice=0; _image.image=nil; _status.text=@"Conectando video…";
  AnnyLensReceiver *receiver=[[AnnyLensReceiver alloc] initWithEndpoint:_endpoint credential:_credential];
  @synchronized(self) { _receiver=receiver; }
  __weak LocalLensStreamView *weakSelf=self; __weak AnnyLensReceiver *weakReceiver=receiver;
  receiver.image=^(UIImage *image) {
    LocalLensStreamView *view=weakSelf; AnnyLensReceiver *source=weakReceiver;
    if (!view || !source || source.stopped) return;
    @synchronized(view) { if (view->_receiver==source) view->_pendingImage=image; }
  };
  AnnyLensDisplayTarget *target=[AnnyLensDisplayTarget new]; target.target=self;
  _display=[CADisplayLink displayLinkWithTarget:target selector:@selector(tick:)]; [_display addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
  [receiver start];
}
- (void)tick:(CADisplayLink *)link {
  UIImage *image; @synchronized(self) { image=_pendingImage; _pendingImage=nil; }
  if (!image) { if (_announced && AnnyLensNow()-_lastNotice>5000) _status.text=@"Reconectando video…"; return; }
  _image.image=image; _status.text=@"En vivo";
  [AnnyLensCallSession offerImage:image];
  if (!_announced || AnnyLensNow()-_lastNotice>=2000) {
    _lastNotice=AnnyLensNow(); if (self.onStreamFrame) self.onStreamFrame(@{});
    if (!_announced) { _announced=YES; if (self.onStreamReady) self.onStreamReady(@{}); }
  }
}
- (void)dealloc { [self pause]; [[NSNotificationCenter defaultCenter] removeObserver:self]; }
@end
@interface LocalLensStreamManager : RCTViewManager
@end
@implementation LocalLensStreamManager
RCT_EXPORT_MODULE(LocalLensStream)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (UIView *)view { return [LocalLensStreamView new]; }
RCT_EXPORT_VIEW_PROPERTY(endpoint,NSString)
RCT_EXPORT_VIEW_PROPERTY(credential,NSString)
RCT_EXPORT_VIEW_PROPERTY(onStreamReady,RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onStreamFrame,RCTDirectEventBlock)
@end
