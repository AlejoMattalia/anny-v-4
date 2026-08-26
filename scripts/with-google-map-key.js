const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function readEnvValue(filePath, key) {
  if (!fs.existsSync(filePath)) return '';

  const line = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${key}=`));
  if (!line) return '';

  return line
    .slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

const childEnvironment = { ...process.env };

if (process.platform === 'linux') {
  const configuredJavaHome = childEnvironment.JAVA_HOME;
  const configuredCompiler = configuredJavaHome
    ? path.join(configuredJavaHome, 'bin', 'javac')
    : '';
  const fallbackJavaHome = '/usr/lib/jvm/java-17-openjdk-amd64';
  const fallbackCompiler = path.join(fallbackJavaHome, 'bin', 'javac');

  if (
    (!configuredCompiler || !fs.existsSync(configuredCompiler)) &&
    fs.existsSync(fallbackCompiler)
  ) {
    childEnvironment.JAVA_HOME = fallbackJavaHome;
    childEnvironment.PATH = `${path.join(fallbackJavaHome, 'bin')}${path.delimiter}${childEnvironment.PATH || ''}`;
  }
}

if (!childEnvironment.EXPO_PUBLIC_GOOGLE_MAP_KEY) {
  const legacyEnvPath = path.resolve(process.cwd(), '../anny-app-v3/.env');
  const legacyGoogleKey = readEnvValue(legacyEnvPath, 'GOOGLE_MAP_KEY');
  if (legacyGoogleKey) {
    childEnvironment.EXPO_PUBLIC_GOOGLE_MAP_KEY = legacyGoogleKey;
  } else {
    console.warn(
      'No se encontró EXPO_PUBLIC_GOOGLE_MAP_KEY ni GOOGLE_MAP_KEY en anny-app-v3.',
    );
  }
}

const expoCli = require.resolve('expo/bin/cli');
const child = spawn(process.execPath, [expoCli, ...process.argv.slice(2)], {
  env: childEnvironment,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
