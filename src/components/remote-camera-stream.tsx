import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewProps } from 'react-native-webview';

// Use the server's WebRTC player on both phones, with the full original frame.
const VIDEO_FORMAT_SCRIPT = `
  (function () {
    var style = document.createElement('style');
    style.textContent = 'html,body{margin:0!important;width:100%!important;height:100%!important;background:#000!important;overflow:hidden!important}video{width:100%!important;height:100%!important;object-fit:contain!important;transform:none!important}';
    document.head.appendChild(style);
  })(); true;
`;

export default function RemoteCameraStream({ streamUrl, injectedJavaScript = '', ...props }: Omit<WebViewProps, 'source'> & { streamUrl: string }) {
  // A refreshed token must not interrupt a healthy connection every few minutes.
  // Remount with a new key when retrying or selecting a different camera.
  const [source] = useState(() => ({ uri: streamUrl }));
  return <WebView
    allowsInlineMediaPlayback
    javaScriptEnabled
    mediaPlaybackRequiresUserAction={false}
    mixedContentMode="always"
    originWhitelist={['http://*', 'https://*']}
    scrollEnabled={false}
    accessibilityLabel="Cámara de los lentes"
    style={styles.video}
    {...props}
    injectedJavaScript={`${VIDEO_FORMAT_SCRIPT}\n${injectedJavaScript}`}
    source={source}
  />;
}
const styles = StyleSheet.create({ video: { flex: 1, backgroundColor: '#000' } });
