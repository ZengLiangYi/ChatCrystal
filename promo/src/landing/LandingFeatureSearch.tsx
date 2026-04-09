import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import { BRAND, SOURCE_COLORS } from '../constants';
import { FONT_MONO, FONT_SANS } from '../fonts';
import { getTypedText, Cursor } from '../utils/typewriter';

const RESULTS = [
  {
    title: 'JWT refresh token rotation strategy',
    summary: 'Implemented sliding window rotation with…',
    highlight: 'JWT refresh tokens',
    score: 0.94,
    source: 'Claude Code',
    sourceColor: SOURCE_COLORS.claudeCode,
  },
  {
    title: 'Auth middleware token validation',
    summary: 'Added expiry check and refresh logic in…',
    highlight: 'token',
    score: 0.87,
    source: 'Cursor',
    sourceColor: SOURCE_COLORS.cursor,
  },
  {
    title: 'Session management with Redis',
    summary: 'Store refresh tokens in Redis with TTL…',
    highlight: 'refresh tokens',
    score: 0.72,
    source: 'Codex',
    sourceColor: SOURCE_COLORS.codex,
  },
];

const scoreColor = (score: number): string => {
  if (score >= 0.9) return '#4ADE80';
  if (score >= 0.8) return '#F59E0B';
  return BRAND.muted;
};

export const LandingFeatureSearch: React.FC = () => {
  const frame = useCurrentFrame();

  // Search bar typing (0-45 frames)
  const query = 'How to handle JWT refresh tokens';
  const typedQuery = getTypedText({ frame, text: query, charFrames: 1 });
  const queryDone = query.length; // frame 31

  // Shimmer: appears immediately after typing, stays until each result replaces it
  const shimmerStart = queryDone + 3; // ~34
  // Each shimmer slot fades out individually as its corresponding result fades in
  const resultsStart = shimmerStart + 10; // ~44, first result appears
  const results = RESULTS.map((r, i) => {
    const start = resultsStart + i * 16;
    if (frame < start) return null;
    const slideUp = interpolate(frame, [start, start + 10], [20, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const fadeIn = interpolate(frame, [start, start + 10], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return { ...r, slideUp, fadeIn };
  });

  // Fade out (135-150)
  const fadeOut = interpolate(frame, [135, 150], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND.bg,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          width: '85%',
          maxWidth: 680,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          border: `1px solid ${BRAND.deepPurple}40`,
          backgroundColor: BRAND.terminalBg,
        }}
      >
        {/* macOS title bar */}
        <div style={{ backgroundColor: '#1A1D28', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FF5F57' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FEBC2E' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#28C840' }} />
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Search bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              backgroundColor: '#1A1D28',
              borderRadius: 8,
              padding: '10px 14px',
              border: `1px solid ${BRAND.deepPurple}60`,
            }}
          >
            {/* Magnifying glass SVG */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={BRAND.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span style={{ fontFamily: FONT_SANS, fontSize: 15, color: BRAND.white }}>
              {typedQuery}
              {frame < queryDone && <Cursor frame={frame} />}
            </span>
          </div>

          {/* Results area — shimmer slots + real results layered */}
          <div style={{ marginTop: 16, position: 'relative' }}>
            {/* Shimmer skeleton — each slot fades out as its result appears */}
            {frame >= shimmerStart && (
              <div>
                {[0, 1, 2].map((i) => {
                  const slotResultStart = resultsStart + i * 16;
                  // Shimmer slot fades in, then fades out when its result arrives
                  const shimmerIn = interpolate(frame, [shimmerStart + i * 3, shimmerStart + i * 3 + 5], [0, 0.5], {
                    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
                  });
                  const shimmerOut = interpolate(frame, [slotResultStart, slotResultStart + 8], [1, 0], {
                    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
                  });
                  const shimmerOpacity = Math.min(shimmerIn, shimmerOut);
                  if (shimmerOpacity <= 0) return null;
                  return (
                    <div
                      key={i}
                      style={{
                        height: 72,
                        borderRadius: 8,
                        marginTop: i > 0 ? 8 : 0,
                        background: `linear-gradient(90deg, ${BRAND.terminalBg} 25%, #1A1D28 50%, ${BRAND.terminalBg} 75%)`,
                        backgroundSize: '200% 100%',
                        opacity: shimmerOpacity,
                      }}
                    />
                  );
                })}
              </div>
            )}

            {/* Real results — slide up over shimmer positions */}
            <div style={{ position: frame >= shimmerStart ? 'absolute' : 'relative', top: 0, left: 0, right: 0 }}>
            {results.map((r, i) =>
              r && (
                <div
                  key={i}
                  style={{
                    opacity: r.fadeIn,
                    transform: `translateY(${r.slideUp}px)`,
                    padding: '12px 14px',
                    borderRadius: 8,
                    backgroundColor: `${BRAND.white}08`,
                    marginTop: i > 0 ? 8 : 0,
                    border: `1px solid ${BRAND.white}0A`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: FONT_SANS, fontSize: 14, fontWeight: 600, color: BRAND.white }}>{r.title}</span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: scoreColor(r.score) }}>{r.score.toFixed(2)}</span>
                  </div>
                  <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: BRAND.dimWhite, marginTop: 4 }}>
                    {r.summary}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <span
                      style={{
                        fontFamily: FONT_SANS,
                        fontSize: 10,
                        color: r.sourceColor,
                        backgroundColor: `${r.sourceColor}20`,
                        padding: '2px 8px',
                        borderRadius: 4,
                      }}
                    >
                      {r.source}
                    </span>
                  </div>
                </div>
              )
            )}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
