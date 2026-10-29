#import "AnnyLensInternal.h"
#import "AnnyLensProtocol.h"
#import <AVFoundation/AVFoundation.h>
#import <VoxImplantSDK/VoxImplantSDK.h>
#import <react-native-voximplant/RNVICallManager.h>
#include <atomic>

@interface AnnyLensCallSession () <VICustomVideoSourceDelegate,AVCaptureVideoDataOutputSampleBufferDelegate>
@property(nonatomic,strong) VICustomVideoSource *source;
@property(nonatomic,copy) NSString *callId;
- (instancetype)initWithCall:(VICall *)call;
- (void)selectGlasses:(BOOL)glasses;
- (void)close;
- (void)enqueue:(UIImage *)image;
@end
static AnnyLensCallSession *activeSession;
@implementation AnnyLensCallSession {
  std::atomic<bool> _glasses, _started, _closed;
  dispatch_queue_t _queue; AVCaptureSession *_camera;
  UIImage *_pending; BOOL _processing; CVPixelBufferPoolRef _pool;
}
- (instancetype)initWithCall:(VICall *)call {
  if ((self=[super init])) {
    _callId=call.callId; _glasses=true; _started=false; _closed=false;
    _queue=dispatch_queue_create("anny.lens.call-video",DISPATCH_QUEUE_SERIAL);
    _source=[[VICustomVideoSource alloc] initWithVideoFormats:@[
      [[VIVideoFormat alloc] initWithFrame:CGSizeMake(640,480) fps:30],
      [[VIVideoFormat alloc] initWithFrame:CGSizeMake(480,640) fps:30]]];
    _source.delegate=self;
    call.videoSource=_source;
  }
  return self;
}
+ (void)offerImage:(UIImage *)image { AnnyLensCallSession *session; @synchronized(self) { session=activeSession; } [session enqueue:image]; }
- (void)startWithVideoFormat:(VIVideoFormat *)format { _started=true; [self updateCamera]; }
- (void)stop { _started=false; [self updateCamera]; }
- (void)selectGlasses:(BOOL)glasses { _glasses=glasses; @synchronized(self) { _pending=nil; } [self updateCamera]; }
- (void)updateCamera {
  dispatch_async(_queue,^{
    if (self->_closed || !self->_started || self->_glasses) { [self->_camera stopRunning]; self->_camera=nil; return; }
    if (self->_camera) return;
    AVCaptureDevice *device=[AVCaptureDevice defaultDeviceWithDeviceType:AVCaptureDeviceTypeBuiltInWideAngleCamera mediaType:AVMediaTypeVideo position:AVCaptureDevicePositionBack];
    NSError *error=nil; AVCaptureDeviceInput *input=device ? [AVCaptureDeviceInput deviceInputWithDevice:device error:&error] : nil;
    if (!input || error) return;
    AVCaptureSession *camera=[AVCaptureSession new];
    [camera beginConfiguration];
    if ([camera canSetSessionPreset:AVCaptureSessionPreset640x480]) camera.sessionPreset=AVCaptureSessionPreset640x480;
    AVCaptureVideoDataOutput *output=[AVCaptureVideoDataOutput new]; output.alwaysDiscardsLateVideoFrames=YES;
    output.videoSettings=@{(__bridge NSString *)kCVPixelBufferPixelFormatTypeKey:@(kCVPixelFormatType_420YpCbCr8BiPlanarFullRange)};
    [output setSampleBufferDelegate:self queue:self->_queue];
    if (![camera canAddInput:input] || ![camera canAddOutput:output]) { [camera commitConfiguration]; return; }
    [camera addInput:input]; [camera addOutput:output];
    AVCaptureConnection *connection=[output connectionWithMediaType:AVMediaTypeVideo];
    if (connection.isVideoOrientationSupported) connection.videoOrientation=AVCaptureVideoOrientationPortrait;
    if ([device lockForConfiguration:&error]) {
      for (AVFrameRateRange *range in device.activeFormat.videoSupportedFrameRateRanges) if (range.minFrameRate<=30 && range.maxFrameRate>=30) {
        device.activeVideoMinFrameDuration=CMTimeMake(1,30); device.activeVideoMaxFrameDuration=CMTimeMake(1,30); break;
      }
      [device unlockForConfiguration];
    }
    [camera commitConfiguration];
    if (self->_closed || self->_glasses || !self->_started) return;
    self->_camera=camera; [camera startRunning];
  });
}
- (void)captureOutput:(AVCaptureOutput *)output didOutputSampleBuffer:(CMSampleBufferRef)sample fromConnection:(AVCaptureConnection *)connection {
  if (_closed || _glasses || !_started) return;
  CVPixelBufferRef buffer=CMSampleBufferGetImageBuffer(sample); if (buffer) [_source sendVideoFrame:buffer rotation:VIRotation_0];
}
- (void)enqueue:(UIImage *)image {
  if (_closed || !_glasses || !_started) return;
  @synchronized(self) { _pending=image; if (_processing) return; _processing=YES; }
  dispatch_async(_queue,^{
    for (;;) { @autoreleasepool {
      UIImage *image;
      @synchronized(self) { image=self->_pending; self->_pending=nil; if (!image || self->_closed || !self->_glasses || !self->_started) { self->_processing=NO; return; } }
      [self sendImage:image];
    }}
  });
}
- (void)sendImage:(UIImage *)image {
  const size_t width=640,height=480;
  if (!_pool) {
    NSDictionary *attributes=@{(__bridge id)kCVPixelBufferPixelFormatTypeKey:@(kCVPixelFormatType_420YpCbCr8BiPlanarFullRange),
      (__bridge id)kCVPixelBufferWidthKey:@(width),(__bridge id)kCVPixelBufferHeightKey:@(height),(__bridge id)kCVPixelBufferIOSurfacePropertiesKey:@{}};
    if (CVPixelBufferPoolCreate(NULL,NULL,(__bridge CFDictionaryRef)attributes,&_pool)!=kCVReturnSuccess) return;
  }
  CVPixelBufferRef pixel=NULL;
  if (CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(NULL,_pool,(__bridge CFDictionaryRef)@{(__bridge id)kCVPixelBufferPoolAllocationThresholdKey:@3},&pixel)!=kCVReturnSuccess) return;
  std::vector<uint8_t> bgra(width*height*4,0);
  CGColorSpaceRef color=CGColorSpaceCreateDeviceRGB();
  CGContextRef context=CGBitmapContextCreate(bgra.data(),width,height,8,width*4,color,kCGImageAlphaPremultipliedFirst|kCGBitmapByteOrder32Little); CGColorSpaceRelease(color);
  if (!context) { CVPixelBufferRelease(pixel); return; }
  CGFloat iw=CGImageGetWidth(image.CGImage),ih=CGImageGetHeight(image.CGImage);
  CGFloat scale=MIN(width/iw,height/ih);
  CGContextDrawImage(context,CGRectMake((width-iw*scale)/2,(height-ih*scale)/2,iw*scale,ih*scale),image.CGImage); CGContextRelease(context);
  if (CVPixelBufferLockBaseAddress(pixel,0)!=kCVReturnSuccess) { CVPixelBufferRelease(pixel); return; }
  anny::bgraToNV12(bgra.data(),width*4,(uint8_t *)CVPixelBufferGetBaseAddressOfPlane(pixel,0),CVPixelBufferGetBytesPerRowOfPlane(pixel,0),
    (uint8_t *)CVPixelBufferGetBaseAddressOfPlane(pixel,1),CVPixelBufferGetBytesPerRowOfPlane(pixel,1),width,height);
  CVPixelBufferUnlockBaseAddress(pixel,0);
  if (!_closed && _glasses && _started) [_source sendVideoFrame:pixel rotation:VIRotation_0];
  CVPixelBufferRelease(pixel);
}
- (void)close {
  _closed=true; _started=false; _source.delegate=nil;
  @synchronized(self) { _pending=nil; }
  dispatch_async(_queue,^{ [self->_camera stopRunning]; self->_camera=nil; if (self->_pool) { CVPixelBufferPoolRelease(self->_pool); self->_pool=NULL; } });
}
@end

@interface LocalLensCallVideo : NSObject <RCTBridgeModule>
@end
@implementation LocalLensCallVideo
RCT_EXPORT_MODULE(LocalLensCallVideo)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
RCT_EXPORT_METHOD(setSource:(NSString *)callId glasses:(BOOL)glasses resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  VICall *call=[RNVICallManager getCallById:callId];
  if (!call) { reject(@"LENS_CALL",@"La llamada ya no está disponible.",nil); return; }
  @synchronized(AnnyLensCallSession.class) {
    if (activeSession && ![activeSession.callId isEqualToString:callId]) { [activeSession close]; activeSession=nil; }
    if (!activeSession) activeSession=[[AnnyLensCallSession alloc] initWithCall:call];
    [activeSession selectGlasses:glasses];
  }
  resolve(nil);
}
RCT_EXPORT_METHOD(stop:(NSString *)callId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  @synchronized(AnnyLensCallSession.class) { if ([activeSession.callId isEqualToString:callId]) { [activeSession close]; activeSession=nil; } }
  resolve(nil);
}
- (void)invalidate { @synchronized(AnnyLensCallSession.class) { [activeSession close]; activeSession=nil; } }
@end
