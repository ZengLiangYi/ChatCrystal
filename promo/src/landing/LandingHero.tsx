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
import { Cursor } from '../utils/typewriter';

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

// Pre-calculate sequential timing: each message starts after the previous finishes
const CHAR_FRAMES = 0.5;
const MSG_GAP = 8; // frames gap between messages
const MSG_TIMINGS = CONVERSATION.reduce<{ start: number; end: number }[]>((acc, msg, i) => {
  const start = i === 0 ? 0 : acc[i - 1].end + MSG_GAP;
  const end = start + Math.ceil(msg.text.length * CHAR_FRAMES);
  acc.push({ start, end });
  return acc;
}, []);
// Total conversation typing ends at last message end
const CONV_END = MSG_TIMINGS[MSG_TIMINGS.length - 1].end; // ~frame 56

export const LandingHero: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // === Phase 1: Sequential conversation (0 to ~56) ===
  const convLines = CONVERSATION.map((msg, i) => {
    const { start, end } = MSG_TIMINGS[i];
    if (frame < start) return null;
    const elapsed = frame - start;
    const charsDone = Math.min(msg.text.length, Math.floor(elapsed / CHAR_FRAMES));
    const isTyping = frame >= start && frame < end;
    return { ...msg, text: msg.text.slice(0, charsDone), isTyping };
  });

  // === Phase 2: Import notification (CONV_END+4 to dissolve) ===
  const importStart = CONV_END + 4;
  const importSlideIn = interpolate(frame, [importStart, importStart + 8], [60, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const importOpacity = interpolate(frame, [importStart, importStart + 8], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // === Phase 3: Dissolve + Logo (90-150) ===
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

  // === Phase 4: Logo moves to top-left, note card appears (150-270) ===
  const noteStart = 150;

  // Logo shrinks and moves to top-left corner of the content area
  // From center (50%,50%) to top-left (~16px, ~16px) of the content div
  // Content area is roughly 680px x 300px, center is (340, 150)
  // Target: (24, 20) — so offset is (24-340, 20-150) = (-316, -130)
  const logoShrink = interpolate(frame, [noteStart, noteStart + 15], [1, 0.4], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const logoMoveX = interpolate(frame, [noteStart, noteStart + 15], [0, -280], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const logoMoveY = interpolate(frame, [noteStart, noteStart + 15], [0, -120], {
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

  // === Phase 5: Fade out (270-300) ===
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
          height: 370,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          border: `1px solid ${BRAND.deepPurple}40`,
          backgroundColor: BRAND.terminalBg,
          position: 'relative',
        }}
      >
        {/* macOS title bar */}
        <div style={{ backgroundColor: '#1A1D28', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FF5F57' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FEBC2E' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#28C840' }} />
        </div>

        <div style={{ padding: '20px 24px', position: 'relative', height: 338, overflow: 'hidden' }}>
          {/* Phase 1: Conversation — sequential typewriter */}
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
                      {msg.isTyping && <Cursor frame={frame} />}
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

          {/* Phase 3: Logo + Crystallizing — centered, then moves to top-left */}
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

          {/* Phase 4: Note card — slides in from right of logo */}
          {showNote && (
            <div
              style={{
                position: 'absolute',
                top: 50,
                left: 60,
                right: 20,
                opacity: cardOpacity,
                transform: `translateX(${cardSlideIn}px)`,
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
