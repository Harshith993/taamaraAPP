#!/usr/bin/env bash
# Records both demo videos from a fresh seed. Needs the production build running on :3000.
# Usage: scripts/demo/record-all.sh [out-dir]   (default docs/demo)
set -euo pipefail
cd "$(dirname "$0")/../.."
out=${1:-docs/demo}
work=${DEMO_WORK:-/tmp/taamara-demo}
mkdir -p "$out"
scripts/demo/reset-db.sh
node scripts/demo/vendor.cjs "$work/vendor"
node scripts/demo/host.cjs "$work/host"
node scripts/demo/stitch.cjs "$work/vendor" "$out/taamara-vendor-demo.mp4"
node scripts/demo/stitch.cjs "$work/host" "$out/taamara-host-demo.mp4"
