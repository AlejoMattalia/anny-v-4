#import "AnnyLensInternal.h"
#import <Vision/Vision.h>

// Expo's scanFromURLAsync on iOS only detects QR. Vision also reads product
// barcodes from the SAME lens JPEG, without opening the phone camera.
@interface AnnyLensBarcode : NSObject <RCTBridgeModule>
@end
@implementation AnnyLensBarcode
RCT_EXPORT_MODULE(AnnyLensBarcode)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue {
  static dispatch_queue_t queue; static dispatch_once_t once;
  dispatch_once(&once,^{ queue=dispatch_queue_create("anny.lens.barcodes",DISPATCH_QUEUE_SERIAL); });
  return queue;
}
RCT_EXPORT_METHOD(scan:(NSString *)base64 resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (base64.length>1398104) { reject(@"LENS_CODE",@"La imagen es demasiado grande.",nil); return; }
  NSData *data=[[NSData alloc] initWithBase64EncodedString:base64 options:0];
  if (!data.length) { reject(@"LENS_CODE",@"La imagen de los lentes no es válida.",nil); return; }
  NSDictionary<VNBarcodeSymbology,NSString *> *types=@{
    VNBarcodeSymbologyQR:@"qr", VNBarcodeSymbologyEAN13:@"ean13", VNBarcodeSymbologyEAN8:@"ean8",
    VNBarcodeSymbologyUPCE:@"upc_e", VNBarcodeSymbologyCode128:@"code128", VNBarcodeSymbologyCode39:@"code39",
    VNBarcodeSymbologyCode93:@"code93", VNBarcodeSymbologyCodabar:@"codabar", VNBarcodeSymbologyITF14:@"itf14",
    VNBarcodeSymbologyPDF417:@"pdf417", VNBarcodeSymbologyAztec:@"aztec", VNBarcodeSymbologyDataMatrix:@"datamatrix"
  };
  NSError *error=nil;
  VNDetectBarcodesRequest *request=[VNDetectBarcodesRequest new];
  NSArray<VNBarcodeSymbology> *supported=[request supportedSymbologiesAndReturnError:&error];
  if (error) { reject(@"LENS_CODE",@"No se pudo preparar el lector de códigos.",error); return; }
  NSMutableArray *symbologies=[NSMutableArray new];
  for (VNBarcodeSymbology type in supported) if (types[type]) [symbologies addObject:type];
  request.symbologies=symbologies;
  VNImageRequestHandler *handler=[[VNImageRequestHandler alloc] initWithData:data options:@{}];
  if (![handler performRequests:@[request] error:&error]) {
    reject(@"LENS_CODE",@"No se pudo leer la imagen de los lentes. Volvé a apuntar al código.",error); return;
  }
  NSMutableArray *results=[NSMutableArray new];
  for (VNBarcodeObservation *code in request.results) {
    if (!code.payloadStringValue.length) continue;
    NSString *type=types[code.symbology], *value=code.payloadStringValue;
    // UPC-A is returned by Vision as EAN-13 with a leading zero, like AVFoundation.
    if ([type isEqualToString:@"ean13"] && value.length==13 && [value hasPrefix:@"0"]) {
      type=@"upc_a"; value=[value substringFromIndex:1];
    }
    if (type) [results addObject:@{@"type":type,@"data":value}];
  }
  resolve(results);
}
@end
