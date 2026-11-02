// Stands in for a component library in node_modules, such as react-aria under Actual's
// buttons. The harness compiles everything under vendor/ WITHOUT babel-plugin-rastro, as a
// real build never annotates node_modules, so nothing here is stamped or marked.
//
// Its internal names are what the unmarked fiber walk picks up, and what a dependency
// upgrade is free to change: the `library-upgrade` scenario renames PickerTrigger.

export function Picker({ label, el }: { label: string; el: string }) {
  return <PickerTrigger label={label} el={el} />;
}

function PickerTrigger({ label, el }: { label: string; el: string }) {
  return (
    <button type="button" aria-haspopup="listbox" data-el={el}>
      {label}
    </button>
  );
}
