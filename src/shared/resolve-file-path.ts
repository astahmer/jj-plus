/** Coerce editor/title / command args (Uri | string | { fsPath }) into a filesystem path. */
export function coerceFsPath(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim()) {
		return value;
	}
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const fsPath = Reflect.get(value, 'fsPath');
	if (typeof fsPath === 'string' && fsPath.trim()) {
		return fsPath;
	}
	const pathValue = Reflect.get(value, 'path');
	if (typeof pathValue === 'string' && pathValue.trim() && !pathValue.includes('://')) {
		return pathValue;
	}
	return undefined;
}
