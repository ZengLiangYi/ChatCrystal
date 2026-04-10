import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { BRAND, TEXT } from '../constants';
import { FONT_MONO, FONT_SANS } from '../fonts';
import { getTypedText, Cursor } from '../utils/typewriter';
import type { SceneProps } from '../types';

export const Scene2BrandReveal: React.FC<SceneProps> = ({ variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const sloganText = getTypedText({
    frame,
    text: TEXT.slogan2,
    charFrames: 1,
  });

  const textDoneFrame = TEXT.slogan2.length * 1;
  const logoDelay = textDoneFrame + 5;

  const logoSpring = spring({
    frame: Math.max(0, frame - logoDelay),
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  const logoScale = interpolate(logoSpring, [0, 1], [0.3, 1]);
  const logoOpacity = interpolate(logoSpring, [0, 1], [0, 1]);

  const nameOpacity = interpolate(
    frame,
    [logoDelay + 15, logoDelay + 25],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  if (variant === 'A') {
    const asciiLogo = '◆ ChatCrystal ◆';
    const logoTyped = getTypedText({
      frame,
      text: asciiLogo,
      charFrames: 2,
      startFrame: logoDelay,
    });

    return (
      <AbsoluteFill
        style={{
          backgroundColor: BRAND.terminalBg,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 32,
              fontWeight: 700,
              color: BRAND.white,
              marginBottom: 30,
            }}
          >
            <span>{sloganText}</span>
            {frame < logoDelay && <Cursor frame={frame} />}
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 28,
              fontWeight: 700,
              color: BRAND.lavender,
            }}
          >
            {logoTyped}
            {frame >= logoDelay && <Cursor frame={frame} color={BRAND.lavender} />}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND.bg,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: FONT_SANS,
            fontSize: 38,
            fontWeight: 600,
            color: BRAND.white,
            marginBottom: 40,
          }}
        >
          {sloganText}
        </div>

        <Img
          src={staticFile('logo.png')}
          style={{
            width: 100,
            height: 100,
            transform: `scale(${logoScale})`,
            opacity: logoOpacity,
          }}
        />

        <div
          style={{
            fontFamily: FONT_SANS,
            fontSize: 28,
            fontWeight: 700,
            color: BRAND.white,
            marginTop: 16,
            opacity: nameOpacity,
            background: `linear-gradient(135deg, ${BRAND.lavender}, ${BRAND.cobaltBlue})`,
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {TEXT.brandName}
        </div>
      </div>
    </AbsoluteFill>
  );
};
