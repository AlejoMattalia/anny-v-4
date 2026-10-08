#!/usr/bin/env python3
"""Run the pure Kotlin frame tests using the existing Gradle compiler cache."""
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
cache = Path(os.environ.get('GRADLE_USER_HOME', Path.home() / '.gradle')) / 'caches/modules-2/files-2.1'

def jar(group, artifact, version):
    matches = list((cache / group / artifact / version).glob('*/*.jar'))
    if not matches:
        raise SystemExit(f'Missing Gradle dependency: {group}:{artifact}:{version}; build Android first.')
    return str(matches[0])

stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', '2.1.20')
annotations = jar('org.jetbrains', 'annotations', '23.0.0')
compiler = [jar('org.jetbrains.kotlin', name, '2.1.20') for name in (
    'kotlin-compiler-embeddable', 'kotlin-script-runtime', 'kotlin-daemon-embeddable')]
compiler += [stdlib, annotations,
             jar('org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'),
             jar('org.jetbrains.intellij.deps', 'trove4j', '1.0.20200330'),
             jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.1')]
sources = [root / 'plugins/lens-wifi/android' / name for name in (
    'LocalLensUdpFrame.kt', 'LocalLensFramePolicy.kt')]
sources += [root / '__tests__/native/LocalLensFramePolicyTest.kt']
with tempfile.TemporaryDirectory(prefix='anny-frame-tests-') as directory:
    output = str(Path(directory) / 'tests.jar')
    subprocess.run(['java', '-cp', os.pathsep.join(compiler),
                    'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect',
                    '-jvm-target', '17', '-classpath', os.pathsep.join([stdlib, annotations]),
                    '-d', output, *map(str, sources)], check=True)
    subprocess.run(['java', '-cp', os.pathsep.join([output, stdlib]),
                    'com.anonymous.annyv4.lenswifi.LocalLensFramePolicyTestKt'], check=True)
