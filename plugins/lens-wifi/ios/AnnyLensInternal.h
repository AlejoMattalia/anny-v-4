#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <React/RCTBridgeModule.h>

BOOL AnnyLensValidURL(NSURL *url, BOOL stream);
uint64_t AnnyLensNow(void);
typedef void (^AnnyLensHTTPCompletion)(NSHTTPURLResponse *, NSData *, NSError *);
@interface AnnyLensHTTPTask : NSObject <NSURLSessionDataDelegate>
- (instancetype)initWithURL:(NSURL *)url secret:(NSString *)secret body:(NSString *)body timeout:(NSTimeInterval)timeout
                      chunk:(BOOL (^)(NSData *))chunk completion:(AnnyLensHTTPCompletion)completion;
- (void)start;
- (void)cancel;
@end

@interface AnnyLensFrames : NSObject
+ (instancetype)shared;
- (void)begin:(NSObject *)owner endpoint:(NSString *)endpoint credential:(NSString *)credential;
- (void)publish:(NSData *)jpeg owner:(NSObject *)owner;
- (void)invalidate:(NSObject *)owner;
- (void)clear:(NSObject *)owner;
- (NSString *)capture:(NSString *)endpoint credential:(NSString *)credential wait:(BOOL)wait error:(NSError **)error;
@end

@interface AnnyLensCallSession : NSObject
+ (void)offerImage:(UIImage *)image;
@end
