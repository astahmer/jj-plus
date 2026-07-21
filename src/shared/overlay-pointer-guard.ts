/** Overlay menus call preventDefault on pointerdown to keep focus — except real inputs. */
export function shouldPreventOverlayPointerDefault(
	target: { closest?: (selectors: string) => unknown } | null | undefined,
): boolean {
	if (target && typeof target.closest === 'function') {
		if (target.closest('input, textarea, select, [contenteditable="true"]')) {
			return false;
		}
	}
	return true;
}
