import React from 'react';
import { interpolate } from 'remotion';
import { TYPEWRITER } from '../constants';

export const getTypedText = ({
  frame,
  text,
  charFrames = TYPEWRITER.charFrames,
  startFrame = 0,
}: {
  frame: number;
  text: string;
  charFrames?: number;
  startFrame?: number;
}): string => {
  const elapsed = Math.max(0, frame - startFrame);
  const chars = Math.min(text.length, Math.floor(elapsed / charFrames));
  return text.slice(0, chars);
};

export const Cursor: React.FC<{
  frame: number;
  blinkFrames?: number;
  color?: string;
}> = ({ frame, blinkFrames = TYPEWRITER.cursorBlink, color = '#E8E9ED' }) => {
  const opacity = interpolate(
    frame % blinkFrames,
    [0, blinkFrames / 2, blinkFrames],
    [1, 0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return React.createElement('span', { style: { opacity, color } }, '\u258C');
};
