#include "../../plugins/lens-wifi/ios/AnnyLensProtocol.h"
#include <cassert>
#include <iostream>
#include <random>

using Bytes = std::vector<uint8_t>;
static std::array<uint8_t,16> token{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16};
static Bytes jpeg(size_t n) {
  Bytes result(n,42); result[0]=255; result[1]=216; result[n-2]=255; result[n-1]=217;
  return result;
}
static Bytes packet(uint32_t id, const Bytes &image, uint16_t index, const Bytes &body) {
  Bytes p(32+body.size()); std::memcpy(p.data(),"ALV1",4);
  std::copy(token.begin(),token.end(),p.begin()+4);
  anny::put32(p.data()+20,id); anny::put32(p.data()+24,image.size());
  anny::put16(p.data()+28,index); anny::put16(p.data()+30,(image.size()+1399)/1400);
  std::copy(body.begin(),body.end(),p.begin()+32); return p;
}
static Bytes data(uint32_t id, const Bytes &image, size_t index) {
  return packet(id,image,index,Bytes(image.begin()+index*1400,image.begin()+std::min(image.size(),(index+1)*1400)));
}
static Bytes repair(uint32_t id, const Bytes &image, size_t group, size_t groupSize) {
  Bytes parity(1400);
  for (size_t i=group*groupSize;i<std::min((image.size()+1399)/1400,(group+1)*groupSize);i++)
    for (size_t b=0;b<std::min(size_t(1400),image.size()-i*1400);b++) parity[b]^=image[i*1400+b];
  return packet(id,image,0x8000+group,parity);
}
static auto receive(anny::Receiver &r,const Bytes &p,uint64_t now=100) { return r.receive(p.data(),p.size(),now); }
static auto receiver(int group=2) { return anny::Receiver(token,group,true,0); }

static void completeAndReordered() {
  for (size_t length: {size_t(4),size_t(1400),size_t(1401),size_t(4200),size_t(65536)}) {
    const auto image=jpeg(length); auto r=receiver(); std::vector<anny::Frame> frames;
    for (size_t i=(length+1399)/1400;i>0;i--) {
      auto result=receive(r,data(10,image,i-1)); frames.insert(frames.end(),result.begin(),result.end());
    }
    assert(frames.size()==1 && frames[0].bytes==image && !frames[0].partial);
    assert(receive(r,data(10,image,0)).empty()); // Duplicate frames do not reappear.
    assert(receive(r,data(9,image,0)).empty());
    assert(r.complete==1 && r.incomplete==0);
  }
}
static void fecRecoversEveryPosition() {
  for (int group: {2,4}) for (size_t length: {size_t(1401),size_t(6500),size_t(65536)}) {
    const auto image=jpeg(length); size_t count=(length+1399)/1400;
    for (size_t missing=0;missing<count;missing++) {
      auto r=receiver(group); std::vector<anny::Frame> frames;
      // Include parity before data to exercise out-of-order UDP delivery.
      auto result=receive(r,repair(1,image,missing/group,group));
      frames.insert(frames.end(),result.begin(),result.end());
      for (size_t i=0;i<count;i++) if (i!=missing) {
        result=receive(r,data(1,image,i)); frames.insert(frames.end(),result.begin(),result.end());
      }
      assert(frames.size()==1 && frames[0].bytes==image && frames[0].recovered==1 && !frames[0].partial);
    }
  }
}
static void partialDeadlinesAndHoles() {
  auto image=jpeg(6000); auto r=receiver();
  receive(r,data(1,image,0),100); receive(r,data(1,image,2),101);
  assert(r.expire(160).empty()); auto frames=r.expire(161);
  assert(frames.size()==1 && frames[0].partial && frames[0].bytes.size()==1402);
  assert(anny::jpeg(frames[0].bytes)); // Never join the bytes after a hole.
  assert(r.expire(1000).empty());
  r=receiver(); receive(r,data(1,image,0),100);
  const Bytes end{'E','N','D','E','N','D','E','N','D'};
  receive(r,packet(1,image,65535,end),101);
  assert(r.expire(112).empty()); frames=r.expire(113);
  assert(frames.size()==1 && frames[0].partial); // Firmware sends NINE bytes.
  r=receiver(); receive(r,data(1,image,1)); assert(r.expire(160).empty());
  assert(r.incomplete==1); // No JPEG header: do not publish a fake image.
  r=receiver(); receive(r,data(1,image,0));
  frames=receive(r,data(2,jpeg(4),0));
  assert(frames.size()==2 && frames[0].partial && !frames[1].partial);
}
static void feedbackAndWrap() {
  auto image=jpeg(4); auto r=receiver();
  receive(r,data(0xfffffffe,image,0),100);
  receive(r,data(1,image,0),150); // Two skipped IDs, including wrapping to zero.
  assert(r.complete==2 && r.incomplete==2);
  assert(receive(r,data(0xffffffff,image,0),160).empty());
  auto p=r.control(4,200);
  assert(p.size()==29 && !std::memcmp(p.data(),"ALC1",4) && p[20]==4);
  assert(anny::u16(p.data()+21)==2 && anny::u16(p.data()+23)==2 && anny::u32(p.data()+25)==50);
  assert(r.complete==0 && r.incomplete==0);
  assert(r.control(1,200).size()==21 && r.control(2,200)[20]==2);
}
static void rejectsMalformed() {
  auto image=jpeg(4); auto good=data(1,image,0);
  for (size_t i: {size_t(0),size_t(4),size_t(24),size_t(28),size_t(30)}) {
    auto p=good; p[i]^=0x80; auto r=receiver(); assert(receive(r,p).empty());
    assert(r.lastPacket==0); // Invalid traffic cannot keep a dead stream alive.
  }
  auto r=receiver(); auto truncated=good; truncated.pop_back(); assert(receive(r,truncated).empty());
  auto large=good; large.resize(2000); assert(receive(r,large).empty());
  // Deterministic malformed traffic with sanitizers also checks all packet bounds.
  std::mt19937 random(100);
  for (int i=0;i<10000;i++) {
    Bytes p(random()%1600); for (auto &b:p) b=random();
    if (p.size()>=20) { std::memcpy(p.data(),"ALV1",4); std::copy(token.begin(),token.end(),p.begin()+4); }
    receive(r,p,i); r.expire(i);
  }
}
static void multipartChunks() {
  Bytes stream;
  const auto image=jpeg(2500);
  const std::string head="\r\n--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 2500\r\n\r\n";
  for (int n=0;n<3;n++) { stream.insert(stream.end(),head.begin(),head.end()); stream.insert(stream.end(),image.begin(),image.end()); }
  for (size_t chunk: {size_t(1),size_t(17),size_t(1400),stream.size()}) {
    anny::MJPEG parser; std::vector<anny::Frame> frames;
    for (size_t i=0;i<stream.size();i+=chunk) assert(parser.append(stream.data()+i,std::min(chunk,stream.size()-i),frames));
    assert(frames.size()==3); for (auto &f:frames) assert(f.bytes==image && !f.partial);
  }
  for (std::string header: std::vector<std::string>{"Content-Length: 99999999999999999999\r\n\r\n", "Content-Length: 0\r\n\r\n", "no-length\r\n\r\n", std::string(32769,'x')}) {
    anny::MJPEG parser; std::vector<anny::Frame> frames;
    assert(!parser.append((const uint8_t *)header.data(),header.size(),frames));
  }
}
static void colorAndStrides() {
  // Four independent 2x2 color patches, with padded source and output rows.
  const size_t width=4,height=4,stride=20,ys=6,uvs=6;
  Bytes bgra(stride*height,99),y(ys*height,77),uv(uvs*height/2,77);
  const std::array<std::array<uint8_t,3>,4> rgb{{{255,0,0},{0,255,0},{0,0,255},{255,255,255}}};
  for (size_t j=0;j<height;j++) for (size_t i=0;i<width;i++) {
    auto color=rgb[(j/2)*2+i/2]; auto p=bgra.data()+j*stride+i*4;
    p[0]=color[2]; p[1]=color[1]; p[2]=color[0]; p[3]=255;
  }
  anny::bgraToNV12(bgra.data(),stride,y.data(),ys,uv.data(),uvs,width,height);
  assert(y[0]==77 && y[2]==149 && y[2*ys]==29 && y[2*ys+2]==255);
  assert(uv[0]==85 && uv[1]==255 && uv[2]==43 && uv[3]==21);
  assert(uv[uvs]==255 && uv[uvs+1]==107 && uv[uvs+2]==128 && uv[uvs+3]==128);
  assert(y[4]==77 && y[5]==77 && uv[4]==77 && uv[5]==77); // Padding untouched.
}
int main() {
  completeAndReordered(); fecRecoversEveryPosition(); partialDeadlinesAndHoles();
  feedbackAndWrap(); rejectsMalformed(); multipartChunks(); colorAndStrides();
  std::cout << "iOS lens protocol: 7 groups passed (UDP, FEC, partials, feedback, malformed, MJPEG, NV12)\n";
}
