Pod::Spec.new do |s|
  s.name = 'AnnyLens'
  s.version = '1.0.0'
  s.summary = 'Anny local lens transport and shared call video'
  s.homepage = 'https://anny.com'
  s.license = { :type => 'Proprietary' }
  s.author = 'Anny'
  s.source = { :path => '.' }
  s.platform = :ios, '16.4'
  s.source_files = '*.{h,mm}'
  s.private_header_files = '*.h'
  s.requires_arc = true
  s.frameworks = 'UIKit', 'AVFoundation', 'CoreVideo', 'CoreMedia', 'ImageIO', 'Security', 'QuartzCore', 'Vision'
  s.dependency 'React-Core'
  s.dependency 'react-native-voximplant'
  s.pod_target_xcconfig = { 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20' }
end
