#!/bin/bash
# Renders landing page compositions to WebM + MP4
# Output: ../site/public/demos/
set -e

OUT_DIR="../site/public/demos"
mkdir -p "$OUT_DIR"

COMPOSITIONS=(
  "LandingHero:hero"
  "LandingFeatureSearch:feature-search"
  "LandingFeatureMcp:feature-mcp"
  "LandingFeatureCli:feature-cli"
  "LandingCliShowcase:cli-showcase"
)

for entry in "${COMPOSITIONS[@]}"; do
  ID="${entry%%:*}"
  NAME="${entry##*:}"

  echo "=== Rendering $ID → $NAME ==="

  # WebM (VP8) — small size, good for Chrome/Firefox/Edge
  npx remotion render "$ID" "$OUT_DIR/$NAME.webm" --codec vp8

  # MP4 (H.264) — fallback for Safari
  npx remotion render "$ID" "$OUT_DIR/$NAME.mp4" --codec h264

  echo "  ✓ $NAME.webm + $NAME.mp4"
done

echo ""
echo "=== Done ==="
ls -lh "$OUT_DIR"/*.webm "$OUT_DIR"/*.mp4
