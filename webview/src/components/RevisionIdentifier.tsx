type RevisionIdentifierProps = {
  value: string;
  highlightPrefix?: string;
  plain?: boolean;
};

export function RevisionIdentifier(props: RevisionIdentifierProps) {
  if (props.plain || !props.highlightPrefix || !props.value.startsWith(props.highlightPrefix)) {
    return (
      <span class="identifier">
        <span class={props.plain ? 'identifier-plain' : 'identifier-suffix'}>{props.value}</span>
      </span>
    );
  }

  return (
    <span class="identifier">
      <span class="identifier-prefix">{props.highlightPrefix}</span>
      <span class="identifier-suffix">{props.value.slice(props.highlightPrefix.length)}</span>
    </span>
  );
}
