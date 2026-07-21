import { getFiletypeFromFileName } from '@pierre/diffs';

/** Map a repo-relative or absolute path to Pierre's filetype for syntax highlighting. */
export function languageFromPath(filePath: string): ReturnType<typeof getFiletypeFromFileName> {
	const base = filePath.split(/[/\\]/u).at(-1) || filePath;
	return getFiletypeFromFileName(base);
}
