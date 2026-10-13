const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const files = git('ls-files', '-z').split('\0').filter(Boolean);
const findings = [];
for (const file of files) {
  const name = path.basename(file);
  if ((/^\.env(?:\.|$)/.test(name) && !/\.example$/.test(name)) ||
      /\.(?:pem|p12|p8|key|jks|keystore)$/i.test(name) ||
      /^(?:credentials\.json|.*service[-_]?account.*\.json)$/i.test(name)) {
    findings.push(`${file}: archivo de credenciales incluido en Git`);
    continue;
  }
  const content = git('show', `:${file}`);
  if (/AIza[0-9A-Za-z_-]{35}/.test(content) ||
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content) ||
      /AKIA[0-9A-Z]{16}/.test(content)) {
    findings.push(`${file}: posible credencial en el contenido`);
  }
}
if (findings.length) {
  console.error('Publicación bloqueada. No se modificó ni borró ningún archivo.');
  console.error(findings.join('\n'));
  console.error('Conservá los secretos localmente y excluilos del seguimiento de Git antes de publicar.');
  process.exitCode = 1;
} else {
  console.log('Control de secretos: sin hallazgos en el índice de Git.');
}
