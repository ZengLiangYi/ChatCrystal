import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { BRAND, TEXT, TYPEWRITER } from '../constants';
import { FONT_MONO, FONT_SANS } from '../fonts';
import { getTypedText, Cursor } from '../utils/typewriter';
import type { SceneProps } from '../types';

export const Scene1PainPoint: React.FC<SceneProps> = ({ variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const text = TEXT.slogan1;
  const typingEndFrame = text.length * TYPEWRITER.charFrames;
  const pauseEndFrame = typingEndFrame + 0.3 * fps;
  const dissolveEndFrame = pauseEndFrame + 0.8 * fps;

  const typedText = getTypedText({ frame, text });
  const showCursor = frame < dissolveEndFrame;

  const textOpacity = interpolate(
    frame,
    [pauseEndFrame, dissolveEndFrame],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  if (variant === 'A') {
    const scrambleProgress = interpolate(
      frame,
      [pauseEndFrame, dissolveEndFrame],
      [0, 1],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    );

    const scrambleChars = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
    const displayText = typedText
      .split('')
      .map((char, i) => {
        if (frame < pauseEndFrame) return char;
        const charThreshold = i / typedText.length;
        if (scrambleProgress > charThreshold + 0.3) return ' ';
        if (scrambleProgress > charThreshold) {
          return scrambleChars[Math.floor(frame * 3 + i) % scrambleChars.length];
        }
        return char;
      })
      .join('');

    return (
      <AbsoluteFill
        style={{
          backgroundColor: BRAND.terminalBg,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 36,
            fontWeight: 700,
            color: BRAND.white,
          }}
        >
          <span>{displayText}</span>
          {showCursor && <Cursor frame={frame} />}
        </div>
      </AbsoluteFill>
    );
  }

  // Variant B
  const fadeInProgress = interpolate(frame, [0, 0.5 * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND.bg,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          fontFamily: FONT_SANS,
          fontSize: 42,
          fontWeight: 600,
          color: BRAND.white,
          opacity: fadeInProgress * textOpacity,
          letterSpacing: -0.5,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
