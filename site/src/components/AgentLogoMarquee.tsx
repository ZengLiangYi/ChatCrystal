import LogoLoop from './LogoLoop/LogoLoop.jsx';
import { AGENT_LOGOS_ROW_A, AGENT_LOGOS_ROW_B } from '../data/agentLogos';

interface AgentLogoMarqueeProps {
  ariaLabelA: string;
  ariaLabelB: string;
}

/**
 * Two counter-scrolling rows of the agent-harness logos, using the React Bits
 * LogoLoop component. The loops pause on hover, scale the hovered mark and show
 * the harness name underneath it.
 */
export default function AgentLogoMarquee({
  ariaLabelA,
  ariaLabelB,
}: AgentLogoMarqueeProps) {
  return (
    <div className="agent-marquee">
      <LogoLoop
        logos={AGENT_LOGOS_ROW_A}
        speed={50}
        direction="left"
        logoHeight={40}
        gap={84}
        hoverSpeed={0}
        scaleOnHover
        fadeOut
        fadeOutWidth={0.1}
        labels="hover"
        draggable
        intro
        ariaLabel={ariaLabelA}
      />
      <LogoLoop
        logos={AGENT_LOGOS_ROW_B}
        speed={42}
        direction="right"
        logoHeight={40}
        gap={84}
        hoverSpeed={0}
        scaleOnHover
        fadeOut
        fadeOutWidth={0.1}
        labels="hover"
        draggable
        intro
        ariaLabel={ariaLabelB}
      />
    </div>
  );
}
