/* global __dirname */
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Keep the v3 native transport in source control across Expo prebuilds.
module.exports = function withWifiLens(config) {
  config = withDangerousMod(config, ['android', async (mod) => {
    const target = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java/com/anonymous/annyv4/lenswifi');
    fs.mkdirSync(target, { recursive: true });
    const source = path.join(__dirname, 'lens-wifi/android');
    for (const file of fs.readdirSync(source)) {
      if (file.endsWith('.kt')) fs.copyFileSync(path.join(source, file), path.join(target, file));
    }
    return mod;
  }]);
  config = withMainApplication(config, (mod) => {
    const registration = 'add(com.anonymous.annyv4.lenswifi.LocalLensPackage())';
    if (!mod.modResults.contents.includes(registration)) {
      const marker = 'PackageList(this).packages.apply {';
      if (!mod.modResults.contents.includes(marker)) throw new Error('No se encontró el registro de paquetes nativos de Anny.');
      mod.modResults.contents = mod.modResults.contents.replace(marker, `${marker}\n          ${registration}`);
    }
    return mod;
  });
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest['uses-permission'] ??= [];
    for (const permission of ['ACCESS_NETWORK_STATE', 'ACCESS_WIFI_STATE', 'CHANGE_WIFI_STATE', 'CHANGE_WIFI_MULTICAST_STATE', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_CONNECTED_DEVICE', 'WAKE_LOCK', 'POST_NOTIFICATIONS']) {
      const name = `android.permission.${permission}`;
      if (!manifest['uses-permission'].some((item) => item.$['android:name'] === name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }
    const app = manifest.application[0];
    app.$['android:usesCleartextTraffic'] = 'true';
    app.service ??= [];
    const name = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
    let service = app.service.find((item) => item.$['android:name'] === name);
    if (!service) { service = { $: { 'android:name': name } }; app.service.push(service); }
    service.$['android:foregroundServiceType'] = 'connectedDevice';
    return mod;
  });
};
