import { useTimelineContext } from '../timeline-context.tsx';

export function TimelineHotkeys() {
	const { state, actions } = useTimelineContext();

	return (
		<div class="hotkeys-popover" id="hotkeysPopover">
			<div class="hotkeys-card">
				<div class="hotkeys-head">
					<div>
						<div style={{ display: 'flex', 'align-items': 'baseline', gap: '6px' }}>
							<div class="eyebrow">Shortcuts</div>
							<div class="hotkeys-version">{state.version()}</div>
						</div>
						<div class="hotkeys-subtitle">Range selection, sidebar navigation, and diff actions</div>
					</div>
					<button class="collapse-button" id="closeHotkeysButton" type="button" onClick={actions.toggleHotkeys}>
						Close
					</button>
				</div>
				<div class="hotkeys-grid">
					<div class="hotkey-section">
						<div class="hotkey-section-title">Selection</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Move range</span>
							<span class="hotkey-value">
								<kbd>←</kbd>
								<kbd>→</kbd>
							</span>
						</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Fast move range</span>
							<span class="hotkey-value">
								<kbd>Shift</kbd>
								<kbd>←</kbd>
								<kbd>→</kbd>
							</span>
						</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Move range vertically</span>
							<span class="hotkey-value">
								<kbd>↑</kbd>
								<kbd>↓</kbd>
							</span>
						</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Adjust to marker</span>
							<span class="hotkey-value">
								<kbd>Option</kbd>
								<kbd>←</kbd>
								<kbd>→</kbd>
							</span>
						</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Adjust from marker</span>
							<span class="hotkey-value">
								<kbd>Ctrl</kbd>
								<kbd>←</kbd>
								<kbd>→</kbd>
							</span>
						</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Dock range to start/end</span>
							<span class="hotkey-value">
								<kbd>Cmd</kbd>
								<kbd>←</kbd>
								<kbd>→</kbd>
							</span>
						</div>
					</div>
					<div class="hotkey-section">
						<div class="hotkey-section-title">Actions</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Open cumulative diff</span>
							<span class="hotkey-value">
								<kbd>Space</kbd>
							</span>
						</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Focus diff</span>
							<span class="hotkey-value">
								<kbd>D</kbd>
							</span>
						</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Toggle help</span>
							<span class="hotkey-value">
								<kbd>?</kbd>
							</span>
						</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Toggle sidebar</span>
							<span class="hotkey-value">
								<kbd>B</kbd>
							</span>
						</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Focus file switcher</span>
							<span class="hotkey-value">
								<kbd>/</kbd>
							</span>
						</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Focus from / to pickers</span>
							<span class="hotkey-value">
								<kbd>F</kbd>
								<kbd>T</kbd>
							</span>
						</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Focus sidebar search</span>
							<span class="hotkey-value">
								<kbd>S</kbd>
							</span>
						</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Exit focus / overlays</span>
							<span class="hotkey-value">
								<kbd>Esc</kbd>
							</span>
						</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Pick range by click</span>
							<span class="hotkey-note">Click one revision, then another</span>
						</div>
						<div class="hotkey-row">
							<span class="hotkey-label">Drag markers</span>
							<span class="hotkey-note">Adjust range directly on the timeline</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
