import React from 'react';
import { BRAND, SPINNER_CHARS } from '../constants';
import { FONT_MONO } from '../fonts';
import type { Variant } from '../types';

export const getSpinnerChar = (frame: number, speed = 3): string => {
  const index = Math.floor(frame / speed) % SPINNER_CHARS.length;
  return SPINNER_CHARS[index];
};

export const TerminalWindow: React.FC<{
  variant: Variant;
  fullWidth?: boolean;
  children: React.ReactNode;
}> = ({ variant, fullWidth, children }) => {
  if (variant === 'A') {
    return React.createElement(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          backgroundColor: BRAND.terminalBg,
          padding: '40px 50px',
          fontFamily: FONT_MONO,
          fontSize: 18,
          lineHeight: 1.6,
          color: BRAND.white,
        },
      },
      children,
    );
  }

  return React.createElement(
    'div',
    {
      style: {
        width: fullWidth ? '100%' : '90%',
        maxWidth: fullWidth ? undefined : 720,
        margin: fullWidth ? undefined : '0 auto',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        border: `1px solid ${BRAND.deepPurple}40`,
      },
    },
    React.createElement(
      'div',
      {
        style: {
          backgroundColor: '#1A1D28',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        },
      },
      React.createElement('div', {
        style: { width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FF5F57' },
      }),
      React.createElement('div', {
        style: { width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FEBC2E' },
      }),
      React.createElement('div', {
        style: { width: 12, height: 12, borderRadius: '50%', backgroundColor: '#28C840' },
      }),
    ),
    React.createElement(
      'div',
      {
        style: {
          backgroundColor: BRAND.terminalBg,
          padding: '24px 28px',
          fontFamily: FONT_MONO,
          fontSize: 16,
          lineHeight: 1.6,
          color: BRAND.white,
          minHeight: 280,
        },
      },
      children,
    ),
  );
};
