import type { Param } from '../scad/types';
import type { Sizes } from './liveCompile';
import { SizeControl } from './SizeControl';

type Props = {
  params: Param[] | null;
  values: Sizes;
  // the part's own code failed, rather than the compiler failing to load or run
  codeFailed: boolean;
  onChange: (name: string, value: number) => void;
  onReset: () => void;
};

export function SizesPanel({ params, values, codeFailed, onChange, onReset }: Props) {
  if (!params) {
    return (
      <p className="muted sizes-note">
        {codeFailed
          ? 'There are no sizes to change, because the code did not compile.'
          : 'The sizes appear once the model is made.'}
      </p>
    );
  }
  if (params.length === 0) return <p className="muted sizes-note">This part has no sizes to change.</p>;

  return (
    <div className="sizes">
      {params.map((param) => (
        <SizeControl
          key={param.name}
          param={param}
          value={values[param.name] ?? param.value}
          onChange={(value) => onChange(param.name, value)}
        />
      ))}
      <button type="button" className="button-quiet sizes-reset" onClick={onReset}>
        Reset sizes
      </button>
    </div>
  );
}
