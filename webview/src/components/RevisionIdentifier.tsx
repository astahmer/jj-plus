import type { FileRevisionEntry } from '../types';

type RevisionIdentifierProps = {
  value: string;
  highlightPrefix?: string;
  plain?: boolean;
};

export function getRevisionIdentifierValue(entry: Pick<FileRevisionEntry, 'shortRevision' | 'changeId' | 'revision' | 'isWorkingTree'>) {
  if (entry.isWorkingTree || !entry.changeId) {
    return entry.shortRevision;
  }

  if (entry.shortRevision === entry.changeId && entry.revision) {
    return `${entry.changeId}/${entry.revision.slice(0, 8)}`;
  }

  return entry.shortRevision;
}

export function RevisionIdentifier(props: RevisionIdentifierProps) {
  if (props.plain) {
    return (
      <span class="identifier">
        <span class="identifier-plain">{props.value}</span>
      </span>
    );
  }

  if (!props.highlightPrefix || !props.value.startsWith(props.highlightPrefix)) {
    return (
      <span class="identifier">
        <span class="identifier-prefix">{props.value}</span>
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
