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
  { role: 'assistant', text: 'Use sliding window rotation. Store tokens in Redis with a 7-day TTL.' },
  { role: 'user', text: 'What about token blacklisting?' },
  { role: 'assistant', text: 'Maintain a Redis SET of revoked IDs. O(1) lookup on each request.' },
];

const TAGS = [
  { label: 'auth', color: SOURCE_COLORS.claudeCode },
  { label: 'jwt', color: SOURCE_COLORS.codex },
  { label: 'redis', color: '#EF4444' },
  { label: 'security', color: SOURCE_COLORS.cursor },
];

const CHAR_FRAMES = 0.3;
const MSG_GAP = 6;
const MSG_TIMINGS: { start: number; end: number }[] = [];
for (let i = 0; i < CONVERSATION.length; i++) {
  const start = i === 0 ? 0 : MSG_TIMINGS[i - 1].end + MSG_GAP;
  const end = start + Math.ceil(CONVERSATION[i].text.length * CHAR_FRAMES);
  MSG_TIMINGS.push({ start, end });
}
const CONV_END = MSG_TIMINGS[MSG_TIMINGS.length - 1].end;

const IMPORT_START = CONV_END + 6;
const DISSOLVE_START = IMPORT_START + 18;
const LOGO_START = DISSOLVE_START + 8;
const CRYST_START = LOGO_START + 12;
// Phase 4: centered logo fades out, note layout fades in
const NOTE_START = CRYST_START + 28;
const FADE_OUT_START = 272;
const FADE_OUT_END = 300;

// macOS window title bar — reused in both phases
const TitleBar: React.FC = () => (
  <div style={{
    backgroundColor: '#1A1D28', padding: '10px 16px',
    display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
  }}>
    <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FF5F57' }} />
    <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FEBC2E' }} />
    <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#28C840' }} />
  </div>
);

export const LandingHero: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // === Phase 1: Sequential conversation ===
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

  // === Phase 3: Dissolve conversation, show centered logo ===
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

  // === Phase 4: Centered logo fades out, note layout fades in ===
  // No translate animation — just crossfade between two layouts
  const centeredLogoFadeOut = interpolate(frame, [NOTE_START, NOTE_START + 12], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const noteLayoutFadeIn = interpolate(frame, [NOTE_START + 6, NOTE_START + 18], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Note content staggered
  const t0 = NOTE_START + 14;
  const t1 = t0 + 10;
  const t2 = t1 + 10;
  const t3 = t2 + 10;
  const t4 = t3 + 10;
  const opac = (start: number) => interpolate(frame, [start, start + 8], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // === Phase 5: Fade out ===
  const fadeOut = interpolate(frame, [FADE_OUT_START, FADE_OUT_END], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const showConversation = frame < DISSOLVE_START + 12;
  const showCenteredLogo = frame >= LOGO_START && frame < NOTE_START + 12;
  const showNoteLayout = frame >= NOTE_START + 6;

  const windowStyle = {
    width: '88%',
    maxWidth: 720,
    height: 370,
    borderRadius: 12,
    overflow: 'hidden' as const,
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
    border: `1px solid ${BRAND.deepPurple}40`,
    backgroundColor: BRAND.terminalBg,
    display: 'flex' as const,
    flexDirection: 'column' as const,
  };

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND.bg,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: fadeOut,
      }}
    >
      <div style={{ ...windowStyle, position: 'relative' }}>
        <TitleBar />

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Phase 1: Conversation */}
          {showConversation && (
            <div style={{
              position: 'absolute', inset: 0, padding: '20px 24px',
              opacity: convOpacity, fontFamily: FONT_SANS, fontSize: 13,
            }}>
              {convLines.map((msg, i) =>
                msg && (
                  <div key={i} style={{ marginTop: i > 0 ? 10 : 0 }}>
                    <div style={{
                      color: msg.role === 'user' ? BRAND.dimWhite : BRAND.lavender,
                      fontSize: 11, marginBottom: 3,
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

              {/* Import notification */}
              {frame >= IMPORT_START && (
                <div style={{
                  position: 'absolute', bottom: 16, right: 16,
                  backgroundColor: `${BRAND.deepPurple}E0`, borderRadius: 8,
                  padding: '8px 14px', fontFamily: FONT_MONO, fontSize: 12,
                  color: ANSI.green, opacity: importOpacity,
                  transform: `translateY(${importSlideIn}px)`,
                }}>
                  ✓ crystal import — 1 conversation
                </div>
              )}
            </div>
          )}

          {/* Phase 3: Centered logo + "Crystallizing..." */}
          {showCenteredLogo && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              justifyContent: 'center', alignItems: 'center',
              opacity: frame >= NOTE_START ? centeredLogoFadeOut : logoOpacity,
            }}>
              <Img src={staticFile('logo.png')} style={{
                width: 64, height: 64,
                transform: `scale(${frame >= NOTE_START ? 1 : logoScale})`,
              }} />
              {frame >= CRYST_START && (
                <div style={{
                  fontFamily: FONT_SANS, fontSize: 14, color: BRAND.lavender,
                  marginTop: 10, opacity: crystOpacity,
                }}>
                  Crystallizing...
                </div>
              )}
            </div>
          )}

          {/* Phase 4: Note layout — small logo top-left + note card */}
          {showNoteLayout && (
            <div style={{
              position: 'absolute', inset: 0, padding: '16px 20px',
              opacity: noteLayoutFadeIn,
              display: 'flex', gap: 16, alignItems: 'flex-start',
            }}>
              {/* Small logo */}
              <Img src={staticFile('logo.png')} style={{
                width: 32, height: 32, flexShrink: 0, marginTop: 2,
              }} />

              {/* Note card */}
              <div style={{ flex: 1 }}>
                <div style={{
                  opacity: opac(t0), fontFamily: FONT_SANS, fontSize: 15,
                  fontWeight: 700, color: BRAND.white,
                }}>
                  JWT Refresh Token Implementation
                </div>

                <div style={{
                  opacity: opac(t1), fontFamily: FONT_SANS, fontSize: 11,
                  color: BRAND.dimWhite, marginTop: 8, lineHeight: 1.6,
                }}>
                  Sliding window rotation with Redis-backed blacklist. RS256 for production, HS256 for dev. Refresh tokens stored with 7-day TTL. Revoked tokens checked via Redis SET with O(1) lookup.
                </div>

                <div style={{ opacity: opac(t2), marginTop: 8 }}>
                  <div style={{ fontFamily: FONT_SANS, fontSize: 10, color: BRAND.muted, marginBottom: 4 }}>
                    Key conclusions
                  </div>
                  <div style={{ fontFamily: FONT_SANS, fontSize: 11, color: BRAND.lavender, lineHeight: 1.6 }}>
                    <div>• Use RS256 for production, HS256 for dev</div>
                    <div>• Store refresh tokens in Redis with 7d TTL</div>
                    <div>• Blacklist revoked tokens via Redis SET</div>
                  </div>
                </div>

                <div style={{ opacity: opac(t3), marginTop: 8, display: 'flex', gap: 6 }}>
                  {TAGS.map((tag, i) => (
                    <span key={i} style={{
                      fontFamily: FONT_SANS, fontSize: 10, color: tag.color,
                      backgroundColor: `${tag.color}20`, padding: '2px 8px', borderRadius: 4,
                    }}>
                      {tag.label}
                    </span>
                  ))}
                </div>

                <div style={{
                  opacity: opac(t4), marginTop: 8, backgroundColor: BRAND.bg,
                  borderRadius: 6, padding: '6px 10px', fontFamily: FONT_MONO,
                  fontSize: 9, lineHeight: 1.5,
                }}>
                  <div style={{ color: ANSI.cyan }}>{'const verify = jwt.verify(token, publicKey, {'}</div>
                  <div style={{ color: ANSI.white }}>{'  algorithms: ["RS256"],'}</div>
                  <div style={{ color: ANSI.white }}>{'  issuer: "auth-service"'}</div>
                  <div style={{ color: ANSI.cyan }}>{'});'}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
