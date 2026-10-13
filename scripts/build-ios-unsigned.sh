#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Esta compilación requiere macOS y Xcode. Desde Linux usá el workflow iOS unsigned preview.' >&2
  exit 1
fi

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"
export ANNY_IOS_UNSIGNED_PREVIEW=1
export CI=1

# No credentials, provisioning profile, Apple account or exportArchive step.
# The JS bundle is included by the Release build; Metro is not needed at runtime.
npx expo prebuild --platform ios --no-install
(cd ios && pod install)

workspaces=(ios/*.xcworkspace)
if [[ ${#workspaces[@]} != 1 || ! -d "${workspaces[0]}" ]]; then
  echo 'Se esperaba un único workspace de iOS generado por Expo.' >&2
  exit 1
fi
workspace="${workspaces[0]}"
scheme="$(basename "$workspace" .xcworkspace)"
output_root="$project_root/dist/ios-unsigned"
mkdir -p "$output_root"
build_dir="$(mktemp -d "$output_root/build-XXXXXX")"

xcodebuild -workspace "$workspace" -scheme "$scheme" \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath "$build_dir/DerivedData" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO build

apps=("$build_dir/DerivedData/Build/Products/Release-iphoneos/"*.app)
if [[ ${#apps[@]} != 1 || ! -d "${apps[0]}" ]]; then
  echo 'No se encontró una única app compilada para iPhone.' >&2
  exit 1
fi
app="${apps[0]}"
test -f "$app/main.jsbundle"
if codesign -dv "$app" 2>/dev/null; then
  echo 'La app tiene una firma inesperada; no se entregará como unsigned.' >&2
  exit 1
fi
mkdir "$build_dir/Payload"
ditto "$app" "$build_dir/Payload/$(basename "$app")"
ditto -c -k --keepParent "$build_dir/Payload" "$build_dir/anny-v4-unsigned.ipa"
shasum -a 256 "$build_dir/anny-v4-unsigned.ipa" > "$build_dir/anny-v4-unsigned.ipa.sha256"
echo "IPA sin firmar: $build_dir/anny-v4-unsigned.ipa"
echo 'Para instalarla en un iPhone todavía se necesita firma personal.'
