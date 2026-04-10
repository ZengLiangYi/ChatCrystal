import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { SCENE_FRAMES, TRANSITION_FRAMES } from '../constants';
import { Scene1PainPoint } from '../scenes/Scene1PainPoint';
import { Scene2BrandReveal } from '../scenes/Scene2BrandReveal';
import { Scene3Import } from '../scenes/Scene3Import';
import { Scene4Summarize } from '../scenes/Scene4Summarize';
import { Scene5Search } from '../scenes/Scene5Search';
import { Scene6Mcp } from '../scenes/Scene6Mcp';
import { Scene7Outro } from '../scenes/Scene7Outro';

const V = 'B' as const;
const T = TRANSITION_FRAMES;

export const VariantB: React.FC = () => {
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={SCENE_FRAMES.painPoint}>
        <Scene1PainPoint variant={V} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />
      <TransitionSeries.Sequence durationInFrames={SCENE_FRAMES.brandReveal}>
        <Scene2BrandReveal variant={V} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />
      <TransitionSeries.Sequence durationInFrames={SCENE_FRAMES.import}>
        <Scene3Import variant={V} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />
      <TransitionSeries.Sequence durationInFrames={SCENE_FRAMES.summarize}>
        <Scene4Summarize variant={V} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />
      <TransitionSeries.Sequence durationInFrames={SCENE_FRAMES.search}>
        <Scene5Search variant={V} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />
      <TransitionSeries.Sequence durationInFrames={SCENE_FRAMES.mcp}>
        <Scene6Mcp variant={V} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />
      <TransitionSeries.Sequence durationInFrames={SCENE_FRAMES.outro}>
        <Scene7Outro variant={V} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
