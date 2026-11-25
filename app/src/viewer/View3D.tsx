import { Canvas } from '@react-three/fiber';
import type { RefObject } from 'react';
import { Scene, type ViewHandle } from './Scene';
import type { Mesh } from './stl';

type Props = { mesh: Mesh; spin: boolean; handle: RefObject<ViewHandle | null> };

// Kept apart from Viewer so three.js loads only when there is a part to show.
export default function View3D({ mesh, spin, handle }: Props) {
  return (
    <Canvas
      flat
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: 30, up: [0, 0, 1], position: [100, -160, 90] }}
      fallback={<p className="viewer-note">This browser cannot draw the 3D view.</p>}
    >
      <Scene mesh={mesh} spin={spin} handle={handle} />
    </Canvas>
  );
}
