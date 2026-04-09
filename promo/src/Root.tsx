import { Composition, Folder } from 'remotion';
import { FPS, WIDTH, HEIGHT, SCENE_FRAMES, TRANSITION_FRAMES } from './constants';
import { VariantA } from './compositions/VariantA';
import { VariantB } from './compositions/VariantB';

import { Scene1PainPoint } from './scenes/Scene1PainPoint';
import { Scene2BrandReveal } from './scenes/Scene2BrandReveal';
import { Scene3Import } from './scenes/Scene3Import';
import { Scene4Summarize } from './scenes/Scene4Summarize';
import { Scene5Search } from './scenes/Scene5Search';
import { Scene6Mcp } from './scenes/Scene6Mcp';
import { Scene7Outro } from './scenes/Scene7Outro';

import { LandingHero } from './landing/LandingHero';
import { LandingFeatureSearch } from './landing/LandingFeatureSearch';
import { LandingFeatureMcp } from './landing/LandingFeatureMcp';
import { LandingFeatureCli } from './landing/LandingFeatureCli';
import { LandingCliShowcase } from './landing/LandingCliShowcase';

const TOTAL_FRAMES =
  Object.values(SCENE_FRAMES).reduce((sum, f) => sum + f, 0) -
  6 * TRANSITION_FRAMES;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="VariantA-Terminal"
        component={VariantA}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="VariantB-MotionGraphics"
        component={VariantB}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />

      <Folder name="Scenes-A">
        <Composition id="S1-A" component={Scene1PainPoint} durationInFrames={SCENE_FRAMES.painPoint} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ variant: 'A' as const }} />
        <Composition id="S2-A" component={Scene2BrandReveal} durationInFrames={SCENE_FRAMES.brandReveal} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ variant: 'A' as const }} />
        <Composition id="S3-A" component={Scene3Import} durationInFrames={SCENE_FRAMES.import} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ variant: 'A' as const }} />
        <Composition id="S4-A" component={Scene4Summarize} durationInFrames={SCENE_FRAMES.summarize} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ variant: 'A' as const }} />
        <Composition id="S5-A" component={Scene5Search} durationInFrames={SCENE_FRAMES.search} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ variant: 'A' as const }} />
        <Composition id="S6-A" component={Scene6Mcp} durationInFrames={SCENE_FRAMES.mcp} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ variant: 'A' as const }} />
        <Composition id="S7-A" component={Scene7Outro} durationInFrames={SCENE_FRAMES.outro} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ variant: 'A' as const }} />
      </Folder>
      <Folder name="Scenes-B">
        <Composition id="S1-B" component={Scene1PainPoint} durationInFrames={SCENE_FRAMES.painPoint} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ variant: 'B' as const }} />
        <Composition id="S2-B" component={Scene2BrandReveal} durationInFrames={SCENE_FRAMES.brandReveal} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ variant: 'B' as const }} />
        <Composition id="S3-B" component={Scene3Import} durationInFrames={SCENE_FRAMES.import} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ variant: 'B' as const }} />
        <Composition id="S4-B" component={Scene4Summarize} durationInFrames={SCENE_FRAMES.summarize} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ variant: 'B' as const }} />
        <Composition id="S5-B" component={Scene5Search} durationInFrames={SCENE_FRAMES.search} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ variant: 'B' as const }} />
        <Composition id="S6-B" component={Scene6Mcp} durationInFrames={SCENE_FRAMES.mcp} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ variant: 'B' as const }} />
        <Composition id="S7-B" component={Scene7Outro} durationInFrames={SCENE_FRAMES.outro} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ variant: 'B' as const }} />
      </Folder>

      <Folder name="Landing">
        <Composition id="LandingHero" component={LandingHero} durationInFrames={300} fps={FPS} width={WIDTH} height={HEIGHT} />
        <Composition id="LandingFeatureSearch" component={LandingFeatureSearch} durationInFrames={150} fps={FPS} width={WIDTH} height={HEIGHT} />
        <Composition id="LandingFeatureMcp" component={LandingFeatureMcp} durationInFrames={150} fps={FPS} width={WIDTH} height={HEIGHT} />
        <Composition id="LandingFeatureCli" component={LandingFeatureCli} durationInFrames={210} fps={FPS} width={WIDTH} height={HEIGHT} />
        <Composition id="LandingCliShowcase" component={LandingCliShowcase} durationInFrames={360} fps={FPS} width={WIDTH} height={HEIGHT} />
      </Folder>
    </>
  );
};
