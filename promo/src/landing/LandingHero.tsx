import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { BRAND, ANSI, SOURCE_COLORS } from '../constants';
import { FONT_MONO, FONT_SANS } from '../fonts';

const CONVERSATION = [
  { role: 'user', text: 'How should I implement JWT refresh tokens?' },
  { role: 'assistant', text: 'Use a sliding window rotation strategy. Store refresh tokens in Redis with a TTL...' },
  { role: 'user', text: 'What about token blacklisting?' },
  { role: 'assistant', text: 'Maintain a Redis SET of revoked token IDs. Check on each request with O(1) lookup...' },
];

const TAGS = [
  { label: 'auth', color: SOURCE_COLORS.claudeCode },
  { label: 'jwt', color: SOURCE_COLORS.codex },
  { label: 'security', color: SOURCE_COLORS.cursor },
];

export const LandingHero: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // === Phase 1: Conversation scroll (0-60 / 0-2s) ===
  const convLines = CONVERSATION.map((msg, i) => {
    const start = i * 12;
    if (frame < start) return null;
    const charsDone = Math.min(msg.text.length, Math.floor((frame - start) / 0.5));
    return { ...msg, text: msg.text.slice(0, charsDone) };
  });

  // === Phase 2: Import notification (60-90 / 2-3s) ===
  const importStart = 60;
  const importSlideIn = interpolate(frame, [importStart, importStart + 8], [60, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const importOpacity = interpolate(frame, [importStart, importStart + 8], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // === Phase 3: Dissolve + Logo (90-150 / 3-5s) ===
  const dissolveStart = 90;
  const convOpacity = interpolate(frame, [dissolveStart, dissolveStart + 15], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const logoStart = 110;
  const logoSpring = spring({
    frame: Math.max(0, frame - logoStart),
    fps,
    config: { damping: 12, stiffness: 100 },
  });
  const logoScale = interpolate(logoSpring, [0, 1], [0.3, 1]);
  const logoOpacity = interpolate(logoSpring, [0, 1], [0, 1]);

  const crystText = frame >= 120 ? 'Crystallizing...' : '';
  const crystOpacity = interpolate(frame, [120, 128], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // === Phase 4: Note card (150-270 / 5-9s) ===
  const noteStart = 150;
  const logoShrink = interpolate(frame, [noteStart, noteStart + 15], [1, 0.5], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const logoMoveX = interpolate(frame, [noteStart, noteStart + 15], [0, -220], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const logoMoveY = interpolate(frame, [noteStart, noteStart + 15], [0, -140], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const cardSlideIn = interpolate(frame, [noteStart + 10, noteStart + 25], [40, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const cardOpacity = interpolate(frame, [noteStart + 10, noteStart + 25], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Note content staggered reveal
  const titleFrame = noteStart + 20;
  const summaryFrame = noteStart + 35;
  const tagsFrame = noteStart + 50;
  const codeFrame = noteStart + 65;

  const titleOpacity = interpolate(frame, [titleFrame, titleFrame + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const summaryOpacity = interpolate(frame, [summaryFrame, summaryFrame + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const tagsOpacity = interpolate(frame, [tagsFrame, tagsFrame + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const codeOpacity = interpolate(frame, [codeFrame, codeFrame + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // === Phase 5: Fade out (270-300 / 9-10s) ===
  const fadeOut = interpolate(frame, [270, 300], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const showConversation = frame < dissolveStart + 15;
  const showLogo = frame >= logoStart;
  const showNote = frame >= noteStart + 10;

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
          width: '88%',
          maxWidth: 720,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          border: `1px solid ${BRAND.deepPurple}40`,
          backgroundColor: BRAND.terminalBg,
          minHeight: 340,
          position: 'relative',
        }}
      >
        {/* macOS title bar */}
        <div style={{ backgroundColor: '#1A1D28', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FF5F57' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FEBC2E' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#28C840' }} />
        </div>

        <div style={{ padding: '20px 24px', position: 'relative', minHeight: 300 }}>
          {/* Phase 1: Conversation */}
          {showConversation && (
            <div style={{ opacity: convOpacity, fontFamily: FONT_SANS, fontSize: 13 }}>
              {convLines.map((msg, i) =>
                msg && (
                  <div key={i} style={{ marginTop: i > 0 ? 10 : 0 }}>
                    <div style={{ color: msg.role === 'user' ? BRAND.dimWhite : BRAND.lavender, fontSize: 11, marginBottom: 2 }}>
                      {msg.role === 'user' ? 'You' : 'Assistant'}
                    </div>
                    <div style={{ color: msg.role === 'user' ? BRAND.white : BRAND.lavender }}>
                      {msg.text}
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {/* Import notification */}
          {frame >= importStart && frame < dissolveStart + 15 && (
            <div
              style={{
                position: 'absolute',
                bottom: 16,
                right: 16,
                backgroundColor: `${BRAND.deepPurple}E0`,
                borderRadius: 8,
                padding: '8px 14px',
                fontFamily: FONT_MONO,
                fontSize: 12,
                color: ANSI.green,
                opacity: importOpacity,
                transform: `translateY(${importSlideIn}px)`,
              }}
            >
              ✓ crystal import — 1 conversation
            </div>
          )}

          {/* Phase 3: Logo + Crystallizing */}
          {showLogo && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: `translate(calc(-50% + ${frame >= noteStart ? logoMoveX : 0}px), calc(-50% + ${frame >= noteStart ? logoMoveY : 0}px)) scale(${frame >= noteStart ? logoShrink : logoScale})`,
                opacity: logoOpacity,
                textAlign: 'center',
              }}
            >
              <Img src={staticFile('logo.png')} style={{ width: 64, height: 64 }} />
              {crystText && frame < noteStart && (
                <div style={{ fontFamily: FONT_SANS, fontSize: 14, color: BRAND.lavender, marginTop: 8, opacity: crystOpacity }}>
                  {crystText}
                </div>
              )}
            </div>
          )}

          {/* Phase 4: Note card */}
          {showNote && (
            <div
              style={{
                opacity: cardOpacity,
                transform: `translateX(${cardSlideIn}px)`,
                marginLeft: 40,
                marginTop: 10,
              }}
            >
              <div style={{ opacity: titleOpacity, fontFamily: FONT_SANS, fontSize: 16, fontWeight: 700, color: BRAND.white }}>
                JWT Refresh Token Implementation
              </div>

              <div style={{ opacity: summaryOpacity, fontFamily: FONT_SANS, fontSize: 12, color: BRAND.dimWhite, marginTop: 8, lineHeight: 1.5 }}>
                Sliding window rotation with Redis-backed blacklist. RS256 for production, HS256 for dev. Refresh tokens stored with 7-day TTL.
              </div>

              <div style={{ opacity: tagsOpacity, marginTop: 10, display: 'flex', gap: 6 }}>
                {TAGS.map((tag, i) => (
                  <span
                    key={i}
                    style={{
                      fontFamily: FONT_SANS,
                      fontSize: 10,
                      color: tag.color,
                      backgroundColor: `${tag.color}20`,
                      padding: '2px 8px',
                      borderRadius: 4,
                    }}
                  >
                    {tag.label}
                  </span>
                ))}
              </div>

              <div
                style={{
                  opacity: codeOpacity,
                  marginTop: 10,
                  backgroundColor: BRAND.bg,
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ color: ANSI.cyan }}>{'const verify = jwt.verify(token, publicKey, {'}</div>
                <div style={{ color: ANSI.white }}>{'  algorithms: ["RS256"]'}</div>
                <div style={{ color: ANSI.cyan }}>{'});'}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
