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
  const googleMapKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY ||
    readEnvValue(legacyEnvPath, 'GOOGLE_MAP_KEY');

  return {
    ...config,
    plugins: [
      ...(config.plugins || []).map((plugin) => {
        // Both Ad Hoc and App Store builds use the production APNs environment.
        if (Array.isArray(plugin) && plugin[0] === 'onesignal-expo-plugin') {
          return [plugin[0], { ...plugin[1], mode: ['preview', 'production'].includes(process.env.EAS_BUILD_PROFILE) ? 'production' : 'development' }];
        }
        return plugin;
      }),
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
