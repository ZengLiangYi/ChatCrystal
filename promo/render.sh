#!/bin/bash
# Renders both variants to MP4, then converts to Animated WebP
# Prerequisites: ffmpeg installed and on PATH

set -e

OUT_DIR="./out"
mkdir -p "$OUT_DIR"

echo "=== Rendering Variant A (Terminal) ==="
npx remotion render VariantA-Terminal "$OUT_DIR/variant-a.mp4" --codec h264

echo "=== Rendering Variant B (Motion Graphics) ==="
npx remotion render VariantB-MotionGraphics "$OUT_DIR/variant-b.mp4" --codec h264

echo "=== Converting to Animated WebP ==="

# Convert MP4 to WebP with target < 5MB
# -loop 0 = infinite loop, -quality 75 is a good balance
ffmpeg -y -i "$OUT_DIR/variant-a.mp4" \
  -vcodec libwebp -lossless 0 -quality 75 -loop 0 \
  -vf "fps=15,scale=800:-1" \
  "$OUT_DIR/variant-a.webp"

ffmpeg -y -i "$OUT_DIR/variant-b.mp4" \
  -vcodec libwebp -lossless 0 -quality 75 -loop 0 \
  -vf "fps=15,scale=800:-1" \
  "$OUT_DIR/variant-b.webp"

echo ""
echo "=== Done ==="
ls -lh "$OUT_DIR"/*.webp
echo ""
echo "If file size > 5MB, re-run with lower -quality (e.g. 60) or lower fps (e.g. 12)"
