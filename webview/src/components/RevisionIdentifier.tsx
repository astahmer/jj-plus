import { createMemo } from 'solid-js';
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
  const value = createMemo(() => props.value || '');
  const highlightPrefix = createMemo(() => props.highlightPrefix || '');
  const plain = createMemo(() => props.plain === true);

  if (plain()) {
    return (
      <span class="identifier">
        <span class="identifier-plain">{value()}</span>
      </span>
    );
  }

  if (!highlightPrefix() || !value().startsWith(highlightPrefix())) {
    return (
      <span class="identifier">
        <span class="identifier-prefix">{value()}</span>
      </span>
    );
  }

  return (
    <span class="identifier">
      <span class="identifier-prefix">{highlightPrefix()}</span>
      <span class="identifier-suffix">{value().slice(highlightPrefix().length)}</span>
    </span>
  );
}
