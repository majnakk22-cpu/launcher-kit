'use strict';
// Определение платформы в терминах Mojang (rules.os.name / arch) и Java-рантаймов.
const os = require('os');

function mcOsName(platform = process.platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'osx';
  return 'linux';
}

/** arch в правилах Mojang: "x86" — только 32-бит. Остальное нам важно лишь для arm64. */
function mcArch(arch = process.arch) {
  if (arch === 'ia32') return 'x86';
  if (arch === 'arm64') return 'arm64';
  return 'x86_64';
}

/** Битность для подстановки ${arch} в legacy natives ("natives-windows-${arch}"). */
function archBits(arch = process.arch) {
  return arch === 'ia32' || arch === 'arm' ? '32' : '64';
}

/** Ключ платформы в all.json Java-рантаймов Mojang. */
function javaRuntimePlatform(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return arch === 'arm64' ? 'windows-arm64' : arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return arch === 'ia32' ? 'linux-i386' : 'linux';
}

const classpathSeparator = process.platform === 'win32' ? ';' : ':';

module.exports = {
  mcOsName, mcArch, archBits, javaRuntimePlatform, classpathSeparator,
  osRelease: () => os.release(),
  totalMemoryMb: () => Math.floor(os.totalmem() / 1024 / 1024),
};
