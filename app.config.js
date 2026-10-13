const fs = require('fs');
const path = require('path');

function readEnvValue(filePath, key) {
  if (!fs.existsSync(filePath)) return '';

  const line = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${key}=`));

  return line
    ? line
        .slice(line.indexOf('=') + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '')
    : '';
}

module.exports = ({ config }) => {
  const projectRoot = path.dirname(require.resolve('./package.json'));
  const legacyEnvPath = path.resolve(projectRoot, '../anny-app-v3/.env');
  const unsignedIosPreview = process.env.ANNY_IOS_UNSIGNED_PREVIEW === '1';
  const googleMapKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY ||
    (unsignedIosPreview ? '' : readEnvValue(legacyEnvPath, 'GOOGLE_MAP_KEY'));

  return {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        // The existing test API uses HTTP, including an IP address. Keep this
        // exception limited to the explicitly selected personal iOS preview.
        ...(unsignedIosPreview ? {
          NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
        } : {}),
      },
    },
    plugins: [
      ...(config.plugins || []),
      [
        'react-native-maps',
        {
          androidGoogleMapsApiKey: googleMapKey || undefined,
        },
      ],
    ],
    extra: {
      ...config.extra,
      googleMapKey: googleMapKey || undefined,
    },
  };
};
