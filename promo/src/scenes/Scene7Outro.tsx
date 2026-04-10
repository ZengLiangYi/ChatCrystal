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
import { Cursor } from '../utils/typewriter';
import type { SceneProps } from '../types';

export const Scene7Outro: React.FC<SceneProps> = ({ variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoSpring = spring({ frame, fps, config: { damping: 200 } });
  const logoScale = interpolate(logoSpring, [0, 1], [0.8, 1]);
  const logoOpacity = interpolate(logoSpring, [0, 1], [0, 1]);

  const cmdOpacity = interpolate(frame, [20, 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const githubOpacity = interpolate(frame, [35, 45], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  if (variant === 'A') {
    const asciiLogo = '◆ ChatCrystal ◆';

    return (
      <AbsoluteFill
        style={{
          backgroundColor: BRAND.terminalBg,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div style={{ textAlign: 'center', fontFamily: FONT_MONO }}>
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: BRAND.lavender,
              opacity: logoOpacity,
              marginBottom: 30,
            }}
          >
            {asciiLogo}
          </div>
          <div
            style={{
              fontSize: 18,
              color: BRAND.white,
              opacity: cmdOpacity,
              marginBottom: 16,
            }}
          >
            {TEXT.installCmd}
            <Cursor frame={frame} />
          </div>
          <div
            style={{
              fontSize: 16,
              color: BRAND.dimWhite,
              opacity: githubOpacity,
            }}
          >
            {'⭐ '}{TEXT.githubUrl}
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
        <Img
          src={staticFile('logo.png')}
          style={{
            width: 80,
            height: 80,
            transform: `scale(${logoScale})`,
            opacity: logoOpacity,
          }}
        />
        <div
          style={{
            fontFamily: FONT_SANS,
            fontSize: 28,
            fontWeight: 700,
            marginTop: 12,
            opacity: logoOpacity,
            background: `linear-gradient(135deg, ${BRAND.lavender}, ${BRAND.cobaltBlue})`,
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {TEXT.brandName}
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 18,
            color: BRAND.white,
            marginTop: 28,
            opacity: cmdOpacity,
            padding: '8px 20px',
            borderRadius: 8,
            border: `1px solid ${BRAND.deepPurple}60`,
            display: 'inline-block',
          }}
        >
          {TEXT.installCmd}
          <Cursor frame={frame} />
        </div>
        <div
          style={{
            fontFamily: FONT_SANS,
            fontSize: 16,
            color: BRAND.dimWhite,
            marginTop: 20,
            opacity: githubOpacity,
          }}
        >
          {'⭐ '}{TEXT.githubUrl}
        </div>
      </div>
    </AbsoluteFill>
  );
};
