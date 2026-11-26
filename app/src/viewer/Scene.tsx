import { useFrame, useThree } from '@react-three/fiber';
import { type RefObject, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { DoubleSide, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fits, frame, orbitBy, radiusOf, setClipRange, zoomBy } from './camera';
import { bedGeometry, edgeGeometry, partGeometry } from './geometry';
import { type Bounds, sceneBounds } from './grid';
import { type LabelSpot, labelSpot, markGeometry, type ViewerMark } from './mark';
import type { Mesh } from './stl';

export type ViewHandle = {
  turn(around: number, over: number): void;
  zoom(factor: number): void;
  reset(): void;
};

const INK = '#121212';
const GRID = '#d3cfc6';
const GRID_EDGE = '#bdb8ad';
const MARK = '#f04a00';
const SPIN_RADIANS_PER_SECOND = 0.18;
// A part this much smaller than the one last framed would look lost, so frame it again.
const SHRINK_TO_REFRAME = 1 / 3;

type Props = {
  mesh: Mesh;
  spin: boolean;
  handle: RefObject<ViewHandle | null>;
  mark?: ViewerMark | null;
  // the label element outside the canvas, moved here to follow the marked point
  markLabel?: RefObject<HTMLElement | null>;
};

export function Scene({ mesh, spin, handle, mark, markLabel }: Props) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const canvas = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const aspect = useThree((state) => state.viewport.aspect);

  const controls = useRef<OrbitControls | null>(null);
  const shown = useRef<Bounds | null>(null);
  const framed = useRef<Bounds | null>(null);
  const spinning = useRef(false);

  const part = useMemo(() => partGeometry(mesh), [mesh]);
  const edges = useMemo(() => edgeGeometry(part), [part]);
  const bed = useMemo(() => bedGeometry(mesh), [mesh]);
  const triangles = mark?.triangles;
  const at = mark?.at;
  const marked = useMemo(() => (triangles ? markGeometry(mesh, triangles) : null), [mesh, triangles]);

  useEffect(() => () => part.dispose(), [part]);
  useEffect(() => () => edges.dispose(), [edges]);
  useEffect(() => () => marked?.dispose(), [marked]);
  useEffect(() => invalidate(), [marked, at, invalidate]);
  useEffect(
    () => () => {
      bed.lines.dispose();
      bed.outline.dispose();
    },
    [bed],
  );

  useEffect(() => {
    const orbit = new OrbitControls(camera, canvas);
    orbit.addEventListener('change', () => invalidate());
    orbit.addEventListener('start', () => {
      spinning.current = false;
    });
    controls.current = orbit;
    return () => {
      orbit.dispose();
      controls.current = null;
      shown.current = null;
      framed.current = null;
    };
  }, [camera, canvas, invalidate]);

  // Frame a new part. After that the camera stays where the visitor left it,
  // unless a size change pushes the part out of a view it used to fit in.
  useEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;
    const before = shown.current;
    shown.current = mesh;
    if (!before) {
      lookAtWhole(camera, orbit, mesh);
      framed.current = mesh;
      spinning.current = spin;
    } else {
      spinning.current = false;
      const pushedOut = fits(camera, before) && !fits(camera, mesh);
      const shrunk = framed.current && radiusOf(mesh) < radiusOf(framed.current) * SHRINK_TO_REFRAME;
      if (pushedOut || shrunk) {
        lookAtWhole(camera, orbit, mesh);
        framed.current = mesh;
      } else {
        setClipRange(camera, mesh);
      }
    }
    invalidate();
  }, [mesh, camera, spin, invalidate]);

  // A resized view (a phone turned on its side) can cut off a part that was framed for the old shape.
  useEffect(() => {
    const orbit = controls.current;
    if (orbit && shown.current && !fits(camera, shown.current)) {
      lookAtWhole(camera, orbit, shown.current);
      framed.current = shown.current;
      invalidate();
    }
  }, [aspect, camera, invalidate]);

  useImperativeHandle(
    handle,
    () => {
      const act = (move: (orbit: OrbitControls) => void) => {
        const orbit = controls.current;
        if (!orbit) return;
        spinning.current = false;
        move(orbit);
        orbit.update();
        invalidate();
      };
      return {
        turn: (around, over) => act((orbit) => orbitBy(camera, orbit.target, around, over)),
        zoom: (factor) =>
          act((orbit) => zoomBy(camera, orbit.target, factor, orbit.minDistance, orbit.maxDistance)),
        reset: () =>
          act((orbit) => {
            if (!shown.current) return;
            lookAtWhole(camera, orbit, shown.current);
            framed.current = shown.current;
          }),
      };
    },
    [camera, invalidate],
  );

  useFrame((state, seconds) => {
    const orbit = controls.current;
    if (spinning.current && orbit) {
      orbitBy(camera, orbit.target, Math.min(seconds, 0.1) * SPIN_RADIANS_PER_SECOND, 0);
      invalidate();
    }
    const label = markLabel?.current;
    if (label) {
      const spot = marked && at ? labelSpot(at, camera, state.size.width, state.size.height) : null;
      placeLabel(label, spot);
    }
  });

  return (
    <>
      <lineSegments geometry={bed.lines}>
        <lineBasicMaterial color={GRID} />
      </lineSegments>
      <lineSegments geometry={bed.outline}>
        <lineBasicMaterial color={GRID_EDGE} />
      </lineSegments>
      <mesh geometry={part}>
        <meshBasicMaterial vertexColors polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
      </mesh>
      {marked && (
        <>
          <mesh geometry={marked}>
            <meshBasicMaterial color={MARK} polygonOffset polygonOffsetFactor={0.5} polygonOffsetUnits={0.5} />
          </mesh>
          {/* a faint copy drawn through the part, so a mark underneath still shows from above */}
          <mesh geometry={marked} renderOrder={2}>
            <meshBasicMaterial
              color={MARK}
              side={DoubleSide}
              transparent
              opacity={0.3}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        </>
      )}
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={INK} />
      </lineSegments>
    </>
  );
}

function placeLabel(label: HTMLElement, spot: LabelSpot | null) {
  if (!spot) {
    label.style.visibility = 'hidden';
    return;
  }
  label.style.transform = `translate(${spot.x.toFixed(1)}px, ${spot.y.toFixed(1)}px)`;
  label.dataset.side = spot.side;
  label.style.visibility = 'visible';
}

function lookAtWhole(camera: PerspectiveCamera, orbit: OrbitControls, part: Bounds) {
  orbit.target.copy(frame(camera, sceneBounds(part)));
  const radius = radiusOf(part);
  orbit.minDistance = radius * 0.4;
  orbit.maxDistance = radius * 14;
  orbit.update();
}
