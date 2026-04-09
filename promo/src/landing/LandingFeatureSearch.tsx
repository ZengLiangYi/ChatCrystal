import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import { BRAND, SOURCE_COLORS } from '../constants';
import { FONT_MONO, FONT_SANS } from '../fonts';
import { getTypedText, Cursor } from '../utils/typewriter';
import { getSpinnerChar } from '../utils/terminal';

const RESULTS = [
  {
    title: 'JWT refresh token rotation strategy',
    summary: 'Implemented sliding window rotation with…',
    score: 0.94,
    source: 'Claude Code',
    sourceColor: SOURCE_COLORS.claudeCode,
  },
  {
    title: 'Auth middleware token validation',
    summary: 'Added expiry check and refresh logic in…',
    score: 0.87,
    source: 'Cursor',
    sourceColor: SOURCE_COLORS.cursor,
  },
  {
    title: 'Session management with Redis',
    summary: 'Store refresh tokens in Redis with TTL…',
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

  // Search bar typing
  const query = 'How to handle JWT refresh tokens';
  const typedQuery = getTypedText({ frame, text: query, charFrames: 1 });
  const queryDone = query.length; // frame 31

  // Searching... spinner (after typing done)
  const searchingStart = queryDone + 4; // ~35
  const searchingEnd = searchingStart + 14; // ~49
  const isSearching = frame >= searchingStart && frame < searchingEnd;
  const searchDone = frame >= searchingEnd;

  // Header text
  const headerText = searchDone ? `Found ${RESULTS.length} related notes:` : '';

  // Results appear one by one in natural flow
  const results = RESULTS.map((r, i) => {
    const start = searchingEnd + 4 + i * 14; // ~53, 67, 81
    if (frame < start) return null;
    const fadeIn = interpolate(frame, [start, start + 8], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return { ...r, opacity: fadeIn };
  });

  // Fade out
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

        <div style={{ padding: '20px 24px', fontFamily: FONT_SANS, fontSize: 14 }}>
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={BRAND.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span style={{ fontSize: 15, color: BRAND.white }}>
              {typedQuery}
              {frame < queryDone && <Cursor frame={frame} />}
            </span>
          </div>

          {/* Searching... with spinner */}
          {isSearching && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: BRAND.lavender, fontFamily: FONT_MONO, fontSize: 13 }}>
                {getSpinnerChar(frame)}
              </span>
              <span style={{ color: BRAND.dimWhite, fontSize: 13 }}>Searching...</span>
            </div>
          )}

          {/* Header */}
          {headerText && (
            <div style={{ marginTop: 12, color: BRAND.dimWhite, fontSize: 12 }}>
              {headerText}
            </div>
          )}

          {/* Results — natural document flow, each fades in */}
          {results.map((r, i) =>
            r && (
              <div
                key={i}
                style={{
                  opacity: r.opacity,
                  marginTop: i === 0 ? 12 : 8,
                  padding: '12px 14px',
                  borderRadius: 8,
                  backgroundColor: `${BRAND.white}08`,
                  border: `1px solid ${BRAND.white}0A`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: BRAND.white }}>{r.title}</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: scoreColor(r.score) }}>{r.score.toFixed(2)}</span>
                </div>
                <div style={{ fontSize: 12, color: BRAND.dimWhite, marginTop: 4 }}>
                  {r.summary}
                </div>
                <div style={{ marginTop: 6 }}>
                  <span
                    style={{
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
    </AbsoluteFill>
  );
};
