import type { Param } from '../scad/types';
import type { Sizes } from './liveCompile';
import { SizeControl } from './SizeControl';

type Props = {
  params: Param[] | null;
  values: Sizes;
  waiting: boolean;
  onChange: (name: string, value: number) => void;
  onReset: () => void;
};

export function SizesPanel({ params, values, waiting, onChange, onReset }: Props) {
  if (!params) {
    return (
      <p className="muted sizes-note">
        {waiting ? 'The sizes appear once the model is made.' : 'There are no sizes to change, because the code did not compile.'}
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
