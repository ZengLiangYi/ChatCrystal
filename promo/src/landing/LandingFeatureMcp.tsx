import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import { BRAND, ANSI } from '../constants';
import { FONT_MONO, FONT_SANS } from '../fonts';
import { getTypedText, Cursor } from '../utils/typewriter';
import { getSpinnerChar } from '../utils/terminal';

const CODE_LINES = [
  { text: 'async function rateLimit(req, res, next) {', color: ANSI.cyan },
  { text: '  const key = req.ip;', color: ANSI.white },
  { text: '  const current = await redis.incr(key);', color: ANSI.white },
  { text: '  if (current > MAX_REQUESTS) {', color: ANSI.yellow },
  { text: '    return res.status(429).json({ error: "Too many requests" });', color: ANSI.red },
  { text: '  }', color: ANSI.white },
  { text: '}', color: ANSI.cyan },
];

export const LandingFeatureMcp: React.FC = () => {
  const frame = useCurrentFrame();

  // User message (0-45)
  const userMsg = 'How did we implement rate limiting?';
  const userText = getTypedText({ frame, text: userMsg, charFrames: 1 });
  const userDone = userMsg.length;

  // Tool call block (45-75)
  const toolStart = 45;
  const toolCallVisible = frame >= toolStart;
  const spinnerEnd = 75;
  const toolDone = frame >= spinnerEnd;

  // Results expand (75-120)
  const resultStart = 78;
  const summaryText = frame >= resultStart ? 'Rate limiting middleware using Redis INCR with per-IP keys' : '';

  const codeStart = resultStart + 10;
  const codeLines = CODE_LINES.map((line, i) => {
    const start = codeStart + i * 3;
    if (frame < start) return null;
    const fadeIn = interpolate(frame, [start, start + 4], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return { ...line, opacity: fadeIn };
  });

  // Assistant summary (120-135)
  const assistantStart = 120;
  const assistantOpacity = interpolate(frame, [assistantStart, assistantStart + 8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
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

        <div style={{ padding: '20px 24px', fontFamily: FONT_SANS, fontSize: 14 }}>
          {/* User message */}
          <div style={{ color: BRAND.dimWhite, fontSize: 12, marginBottom: 4 }}>You</div>
          <div style={{ color: BRAND.white }}>
            {userText}
            {frame < userDone && <Cursor frame={frame} />}
          </div>

          {/* Tool call block */}
          {toolCallVisible && (
            <div
              style={{
                marginTop: 16,
                border: `1px solid ${BRAND.cobaltBlue}60`,
                borderRadius: 8,
                padding: '10px 14px',
                backgroundColor: `${BRAND.cobaltBlue}10`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: toolDone ? ANSI.green : ANSI.yellow, fontFamily: FONT_MONO, fontSize: 13 }}>
                  {toolDone ? '✓' : getSpinnerChar(frame)}
                </span>
                <span style={{ color: BRAND.cobaltBlue, fontFamily: FONT_MONO, fontSize: 13 }}>
                  search_knowledge("rate limiting")
                </span>
              </div>

              {/* Expanded result */}
              {frame >= resultStart && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BRAND.cobaltBlue}30` }}>
                  <div style={{ color: BRAND.dimWhite, fontSize: 12 }}>{summaryText}</div>
                  {/* Code block */}
                  {frame >= codeStart && (
                    <div
                      style={{
                        marginTop: 8,
                        backgroundColor: BRAND.bg,
                        borderRadius: 6,
                        padding: '10px 12px',
                        fontFamily: FONT_MONO,
                        fontSize: 11,
                        lineHeight: 1.5,
                      }}
                    >
                      {codeLines.map((line, i) =>
                        line && (
                          <div key={i} style={{ color: line.color, opacity: line.opacity }}>{line.text}</div>
                        )
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Assistant response */}
          {frame >= assistantStart && (
            <div style={{ marginTop: 16, opacity: assistantOpacity }}>
              <div style={{ color: BRAND.dimWhite, fontSize: 12, marginBottom: 4 }}>Assistant</div>
              <div style={{ color: BRAND.lavender, fontSize: 13 }}>
                We used Redis INCR with per-IP keys and a 429 response when the limit is exceeded.
              </div>
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
