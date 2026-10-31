import { Row, Switch } from '../ui/primitives.js';

export function PreferenceRow({ label, el }: { label: string; el: string }) {
  return (
    <Row>
      <Switch label={label} el={el} />
    </Row>
  );
}
