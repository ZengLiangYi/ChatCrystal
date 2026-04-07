import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface SpinnerProps {
  label?: string;
}

export function Spinner({ label }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text>
      <Text color="cyan">{frames[frame]}</Text>
      {label && <Text> {label}</Text>}
    </Text>
  );
}
