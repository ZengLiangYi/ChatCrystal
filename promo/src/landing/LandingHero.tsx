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

// Shorter conversation — 2 exchanges fit the 10s timeline
const CONVERSATION = [
  { role: 'user', text: 'How should I implement JWT refresh tokens?' },
  { role: 'assistant', text: 'Use sliding window rotation. Store refresh tokens in Redis with a 7-day TTL...' },
];

const TAGS = [
  { label: 'auth', color: SOURCE_COLORS.claudeCode },
  { label: 'jwt', color: SOURCE_COLORS.codex },
  { label: 'security', color: SOURCE_COLORS.cursor },
];

// Sequential timing: each message waits for the previous to finish
const CHAR_FRAMES = 0.5;
const MSG_GAP = 10;
const MSG_TIMINGS: { start: number; end: number }[] = [];
for (let i = 0; i < CONVERSATION.length; i++) {
  const start = i === 0 ? 0 : MSG_TIMINGS[i - 1].end + MSG_GAP;
  const end = start + Math.ceil(CONVERSATION[i].text.length * CHAR_FRAMES);
  MSG_TIMINGS.push({ start, end });
}
// MSG 0 (43 chars): start=0, end=22
// MSG 1 (78 chars): start=32, end=71
const CONV_END = MSG_TIMINGS[MSG_TIMINGS.length - 1].end; // ~71

// All phase timings flow from CONV_END
const IMPORT_START = CONV_END + 6;        // ~77  import notification slides in
const DISSOLVE_START = IMPORT_START + 20;  // ~97  conversation fades out
const LOGO_START = DISSOLVE_START + 10;    // ~107 logo springs in
const CRYST_START = LOGO_START + 12;       // ~119 "Crystallizing..." text
const NOTE_START = CRYST_START + 30;       // ~149 logo shrinks, note card appears
const FADE_OUT_START = 270;                // fade out
const FADE_OUT_END = 300;                  // end

export const LandingHero: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // === Phase 1: Sequential conversation typing ===
  const convLines = CONVERSATION.map((msg, i) => {
    const { start, end } = MSG_TIMINGS[i];
    if (frame < start) return null;
    const elapsed = frame - start;
    const charsDone = Math.min(msg.text.length, Math.floor(elapsed / CHAR_FRAMES));
    const isTyping = frame >= start && frame < end;
    return { ...msg, text: msg.text.slice(0, charsDone), isTyping };
  });

  // === Phase 2: Import notification ===
  const importSlideIn = interpolate(frame, [IMPORT_START, IMPORT_START + 8], [60, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const importOpacity = interpolate(frame, [IMPORT_START, IMPORT_START + 8], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // === Phase 3: Dissolve conversation + Logo appears ===
  const convOpacity = interpolate(frame, [DISSOLVE_START, DISSOLVE_START + 12], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const logoSpring = spring({
    frame: Math.max(0, frame - LOGO_START),
    fps,
    config: { damping: 12, stiffness: 100 },
  });
  const logoScale = interpolate(logoSpring, [0, 1], [0.3, 1]);
  const logoOpacity = interpolate(logoSpring, [0, 1], [0, 1]);

  const crystOpacity = interpolate(frame, [CRYST_START, CRYST_START + 8], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // === Phase 4: Logo shrinks to top-left, note card slides in ===
  // Logo: from center (50%, 50%) to top-left corner
  // The content area is ~670x300. Center=(335,150). Target corner=(20,16).
  // So delta = (20-335, 16-150) = (-315, -134)
  const logoTargetScale = 0.35;
  const logoFinalScale = interpolate(frame, [NOTE_START, NOTE_START + 18], [1, logoTargetScale], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const logoMoveX = interpolate(frame, [NOTE_START, NOTE_START + 18], [0, -315], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const logoMoveY = interpolate(frame, [NOTE_START, NOTE_START + 18], [0, -134], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Note card appears after logo starts moving
  const cardStart = NOTE_START + 12;
  const cardSlideX = interpolate(frame, [cardStart, cardStart + 15], [30, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const cardOpacity = interpolate(frame, [cardStart, cardStart + 15], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Note content staggered reveal
  const titleStart = cardStart + 5;
  const summaryStart = titleStart + 12;
  const tagsStart = summaryStart + 12;
  const codeStart = tagsStart + 12;

  const titleOpacity = interpolate(frame, [titleStart, titleStart + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const summaryOpacity = interpolate(frame, [summaryStart, summaryStart + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const tagsOpacity = interpolate(frame, [tagsStart, tagsStart + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const codeOpacity = interpolate(frame, [codeStart, codeStart + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // === Phase 5: Fade out ===
  const fadeOut = interpolate(frame, [FADE_OUT_START, FADE_OUT_END], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const showConversation = frame < DISSOLVE_START + 12;
  const showLogo = frame >= LOGO_START;
  const showNote = frame >= cardStart;

  // Whether logo is in "moving" phase
  const logoIsMoving = frame >= NOTE_START;

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
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* macOS title bar — fixed */}
        <div style={{
          backgroundColor: '#1A1D28',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FF5F57' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FEBC2E' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#28C840' }} />
        </div>

        {/* Content area — fixed height, overflow hidden */}
        <div style={{
          padding: '20px 24px',
          position: 'relative',
          flex: 1,
          overflow: 'hidden',
        }}>
          {/* Phase 1: Conversation with sequential typewriter */}
          {showConversation && (
            <div style={{ opacity: convOpacity, fontFamily: FONT_SANS, fontSize: 13 }}>
              {convLines.map((msg, i) =>
                msg && (
                  <div key={i} style={{ marginTop: i > 0 ? 12 : 0 }}>
                    <div style={{
                      color: msg.role === 'user' ? BRAND.dimWhite : BRAND.lavender,
                      fontSize: 11,
                      marginBottom: 3,
                    }}>
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

          {/* Import notification — absolute positioned, bottom-right */}
          {frame >= IMPORT_START && frame < DISSOLVE_START + 12 && (
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

          {/* Phase 3+4: Logo — centered, then moves to top-left */}
          {showLogo && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: [
                  `translate(-50%, -50%)`,
                  logoIsMoving
                    ? `translate(${logoMoveX}px, ${logoMoveY}px) scale(${logoFinalScale})`
                    : `scale(${logoScale})`,
                ].join(' '),
                opacity: logoOpacity,
                textAlign: 'center',
              }}
            >
              <Img src={staticFile('logo.png')} style={{ width: 64, height: 64 }} />
              {frame >= CRYST_START && frame < NOTE_START && (
                <div style={{
                  fontFamily: FONT_SANS,
                  fontSize: 14,
                  color: BRAND.lavender,
                  marginTop: 8,
                  opacity: crystOpacity,
                }}>
                  Crystallizing...
                </div>
              )}
            </div>
          )}

          {/* Phase 4: Note card — positioned with proper spacing from logo */}
          {showNote && (
            <div
              style={{
                position: 'absolute',
                top: 16,
                left: 70,
                right: 20,
                bottom: 16,
                opacity: cardOpacity,
                transform: `translateX(${cardSlideX}px)`,
                overflow: 'hidden',
              }}
            >
              <div style={{
                opacity: titleOpacity,
                fontFamily: FONT_SANS,
                fontSize: 16,
                fontWeight: 700,
                color: BRAND.white,
              }}>
                JWT Refresh Token Implementation
              </div>

              <div style={{
                opacity: summaryOpacity,
                fontFamily: FONT_SANS,
                fontSize: 12,
                color: BRAND.dimWhite,
                marginTop: 10,
                lineHeight: 1.6,
              }}>
                Sliding window rotation with Redis-backed blacklist. RS256 for production, HS256 for dev. Refresh tokens stored with 7-day TTL.
              </div>

              <div style={{ opacity: tagsOpacity, marginTop: 12, display: 'flex', gap: 6 }}>
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
                  marginTop: 12,
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
