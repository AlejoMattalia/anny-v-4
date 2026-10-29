#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <optional>
#include <string>
#include <vector>

// Wire format shared with lente-wifi-2 and the Android receiver. This file has
// no Apple dependencies so malformed packets/FEC can be tested on every host.
namespace anny {
constexpr size_t headerSize = 32, payloadSize = 1400, maxUDPFrame = 65536;
inline uint16_t u16(const uint8_t *p) { return uint16_t(p[0]) << 8 | p[1]; }
inline uint32_t u32(const uint8_t *p) { return uint32_t(p[0]) << 24 | uint32_t(p[1]) << 16 | uint32_t(p[2]) << 8 | p[3]; }
inline void put16(uint8_t *p, uint16_t n) { p[0] = n >> 8; p[1] = n; }
inline void put32(uint8_t *p, uint32_t n) { p[0] = n >> 24; p[1] = n >> 16; p[2] = n >> 8; p[3] = n; }
inline bool jpeg(const std::vector<uint8_t> &p) {
  return p.size() >= 4 && p[0] == 255 && p[1] == 216 && p[p.size()-2] == 255 && p.back() == 217;
}
struct Frame { std::vector<uint8_t> bytes; bool partial = false; unsigned recovered = 0; };
class Assembly {
 public:
  uint32_t id; size_t length, count, groupSize; bool finished = false;
  Assembly(uint32_t id, size_t length, size_t count, size_t group)
    : id(id), length(length), count(count), groupSize(group), bytes(length), present(count), parity((count+group-1)/group) {}
  std::optional<Frame> add(size_t index, const uint8_t *p, size_t size, bool repair) {
    if (finished) return {};
    if (repair) {
      if (index >= parity.size() || !parity[index].empty() || size != payloadSize) return {};
      parity[index].assign(p, p+size); recover(index);
    } else {
      if (index >= count || present[index] || size != std::min(payloadSize, length-index*payloadSize)) return {};
      std::copy(p, p+size, bytes.begin()+index*payloadSize); present[index] = true; received++; recover(index/groupSize);
    }
    return received == count ? finish() : std::nullopt;
  }
  std::optional<Frame> finish() {
    if (finished) return {};
    finished = true;
    if (!present[0] || bytes[0] != 255 || bytes[1] != 216) return {};
    if (received == count && jpeg(bytes)) return Frame{std::move(bytes), false, recovered};
    auto missing = std::find(present.begin(), present.end(), false);
    const auto intact = missing == present.end() ? length : size_t(missing-present.begin())*payloadSize;
    if (intact < 4) return {};
    bytes.resize(intact); bytes.push_back(255); bytes.push_back(217);
    return Frame{std::move(bytes), true, recovered};
  }
 private:
  std::vector<uint8_t> bytes; std::vector<bool> present; std::vector<std::vector<uint8_t>> parity;
  unsigned received = 0, recovered = 0;
  void recover(size_t group) {
    auto &repair = parity[group]; if (repair.empty()) return;
    const auto first = group*groupSize, end = std::min(first+groupSize, count);
    size_t missing = count;
    for (auto i = first; i < end; i++) if (!present[i]) { if (missing != count) return; missing = i; }
    if (missing == count) return;
    for (auto i = first; i < end; i++) if (i != missing)
      for (size_t b = 0; b < std::min(payloadSize, length-i*payloadSize); b++) repair[b] ^= bytes[i*payloadSize+b];
    std::copy_n(repair.begin(), std::min(payloadSize, length-missing*payloadSize), bytes.begin()+missing*payloadSize);
    present[missing] = true; received++; recovered++; repair.clear();
  }
};
class Receiver {
 public:
  std::array<uint8_t,16> token{}; int group = 2; bool partials = true;
  uint64_t lastPacket = 0, lastComplete = 0;
  unsigned complete = 0, incomplete = 0;
  explicit Receiver(std::array<uint8_t,16> t, int g, bool partial, uint64_t now)
    : token(t), group(g), partials(partial), lastPacket(now), lastComplete(now) {}
  // At most a retired partial and the current complete image can be returned.
  std::vector<Frame> receive(const uint8_t *p, size_t size, uint64_t now) {
    std::vector<Frame> result;
    if (size <= headerSize || size > headerSize+payloadSize || std::memcmp(p,"ALV1",4) || std::memcmp(p+4,token.data(),16)) return result;
    const auto id = u32(p+20), length = u32(p+24); const auto index = u16(p+28), count = u16(p+30);
    if (length < 4 || length > maxUDPFrame || count != (length+payloadSize-1)/payloadSize) return result;
    const auto n = size-headerSize; const auto g = group ? group : 4;
    const bool end = partials && index == 65535 && n == 9 && !std::memcmp(p+headerSize,"ENDENDEND",9);
    const bool repair = group && index >= 0x8000 && index < 0x8000+(count+g-1)/g && n == payloadSize;
    if (!end && !repair && (index >= count || n != std::min(payloadSize,size_t(length)-index*payloadSize))) return result;
    if (current && id != current->id && uint32_t(id-current->id) >= 0x80000000u) return result;
    if (!current || id != current->id) {
      if (current) { if (!current->finished) deliver(current->finish(), now, result); incomplete = std::min<uint64_t>(65535, uint64_t(incomplete)+uint32_t(id-current->id)-1); }
      current.emplace(id,length,count,g); endAt.reset();
    }
    if (current->length != length || current->count != count) return result;
    lastPacket = lastFragment = now;
    if (end) { if (!endAt) endAt = now; }
    else if (auto frame = current->add(repair ? index-0x8000 : index, p+headerSize, n, repair)) deliver(std::move(frame),now,result);
    return result;
  }
  std::vector<Frame> expire(uint64_t now) {
    std::vector<Frame> result;
    if (current && !current->finished && (endAt ? now-*endAt >= 12 : now-lastFragment >= 60)) deliver(current->finish(),now,result);
    return result;
  }
  std::vector<uint8_t> control(uint8_t command, uint64_t now) {
    std::vector<uint8_t> p(command == 4 ? 29 : 21); std::memcpy(p.data(),"ALC1",4); std::copy(token.begin(),token.end(),p.begin()+4); p[20] = command;
    if (command == 4) { put16(p.data()+21,complete); put16(p.data()+23,incomplete); put32(p.data()+25,std::min<uint64_t>(0xffffffffu,now-lastComplete)); complete = incomplete = 0; }
    return p;
  }
 private:
  std::optional<Assembly> current; uint64_t lastFragment = 0; std::optional<uint64_t> endAt;
  void deliver(std::optional<Frame> f, uint64_t now, std::vector<Frame> &out) {
    if (!f || f->partial) incomplete = std::min(65535u,incomplete+1);
    else { complete = std::min(65535u,complete+1); lastComplete = now; }
    if (f) out.push_back(std::move(*f));
  }
};
// Multipart parser tolerates arbitrary TCP chunk boundaries and bounds memory.
class MJPEG {
  std::vector<uint8_t> buffer; size_t expected = 0;
 public:
  bool append(const uint8_t *p, size_t n, std::vector<Frame> &out) {
    if (buffer.size()+n > 2*1048576) return false;
    buffer.insert(buffer.end(),p,p+n);
    for (;;) {
      if (!expected) {
        const std::string separator = "\r\n\r\n";
        auto end = std::search(buffer.begin(),buffer.end(),separator.begin(),separator.end());
        if (end == buffer.end()) return buffer.size() <= 32768;
        std::string head(buffer.begin(),end);
        std::transform(head.begin(),head.end(),head.begin(),[](unsigned char c){ return c >= 'A' && c <= 'Z' ? c+32 : c; });
        auto key = head.find("content-length:"); if (key == std::string::npos) return false;
        key += 15; while (key < head.size() && head[key] == ' ') key++;
        while (key < head.size() && head[key] >= '0' && head[key] <= '9') { expected = expected*10+head[key++]-'0'; if (expected > 1048576) return false; }
        if (expected < 4) return false;
        buffer.erase(buffer.begin(),end+4);
      }
      if (buffer.size() < expected) return true;
      std::vector<uint8_t> frame(buffer.begin(),buffer.begin()+expected);
      buffer.erase(buffer.begin(),buffer.begin()+expected); expected = 0;
      if (jpeg(frame)) out.push_back(Frame{std::move(frame)});
    }
  }
};
inline uint8_t clamp(int n) { return uint8_t(std::max(0,std::min(255,n))); }
// Full-range NV12 accepted by VICustomVideoSource. Strides may include padding.
inline void bgraToNV12(const uint8_t *src, size_t stride, uint8_t *y, size_t ys, uint8_t *uv, size_t uvs, size_t w, size_t h) {
  for (size_t j=0;j<h;j++) for (size_t i=0;i<w;i++) {
    auto p=src+j*stride+i*4; y[j*ys+i]=clamp((77*p[2]+150*p[1]+29*p[0]+128)>>8);
  }
  for (size_t j=0;j<h;j+=2) for (size_t i=0;i<w;i+=2) {
    int r=0,g=0,b=0; for (size_t dy=0;dy<2;dy++) for (size_t dx=0;dx<2;dx++) { auto p=src+(j+dy)*stride+(i+dx)*4; b+=p[0]; g+=p[1]; r+=p[2]; }
    r/=4; g/=4; b/=4; uv[j/2*uvs+i]=clamp(((-43*r-85*g+128*b+128)>>8)+128); uv[j/2*uvs+i+1]=clamp(((128*r-107*g-21*b+128)>>8)+128);
  }
}
}
