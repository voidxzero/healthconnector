#!/usr/bin/env bash
# Builds the Android app.
#   ./build-apk.sh         the release build, left at ./healthconnector.apk
#                          (signed with the permanent key in ~/.config/healthconnector/keystore.properties,
#                          or HEALTHCONNECTOR_KEYSTORE_PROPERTIES; without it, with the throwaway debug key)
#   ./build-apk.sh debug   a debuggable build, left at ./healthconnector-debug.apk, for the emulator
#                          (its web view can be inspected; it can't update over a release build)
set -euo pipefail
cd "$(dirname "$0")/web"

variant="${1:-release}"
case "$variant" in release|debug) ;; *) echo "Usage: ./build-apk.sh [release|debug]" >&2; exit 1 ;; esac

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
if ! command -v javac >/dev/null && [ -x "$HOME/Android/jdk-21/bin/javac" ]; then
  export JAVA_HOME="$HOME/Android/jdk-21"
fi
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

[ -d node_modules ] || npm ci
npm run build
npx cap sync android
if [ "$variant" = release ]; then
  (cd android && ./gradlew assembleRelease --console=plain -q)
  cp android/app/build/outputs/apk/release/app-release.apk ../healthconnector.apk
  echo "Built $(cd .. && pwd)/healthconnector.apk (version $(node -p "require('./package.json').version"))"
else
  (cd android && ./gradlew assembleDebug --console=plain -q)
  cp android/app/build/outputs/apk/debug/app-debug.apk ../healthconnector-debug.apk
  echo "Built $(cd .. && pwd)/healthconnector-debug.apk"
fi
