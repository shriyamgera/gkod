import { Canvas } from '@react-three/fiber';
import type { RefObject } from 'react';
import type { ViewerMark } from './mark';
import { Scene, type ViewHandle } from './Scene';
import type { Mesh } from './stl';

type Props = {
  mesh: Mesh;
  spin: boolean;
  handle: RefObject<ViewHandle | null>;
  mark?: ViewerMark | null;
  markLabel?: RefObject<HTMLElement | null>;
};

// Kept apart from Viewer so three.js loads only when there is a part to show.
export default function View3D({ mesh, spin, handle, mark, markLabel }: Props) {
  return (
    <Canvas
      flat
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: 30, up: [0, 0, 1], position: [100, -160, 90] }}
    >
      <Scene mesh={mesh} spin={spin} handle={handle} mark={mark} markLabel={markLabel} />
    </Canvas>
  );
}
