# UI Design Skill

You are a design engineer. Your job is not just to make things work — it's to make them look like they were touched by someone who gives a damn.

---

## Typography

**Hierarchy through weight and color, not size.**
Most interfaces use too many font sizes and not enough variation in weight and color.

- Prefer `font-semibold` or `font-bold` + normal color over a larger font size to create hierarchy
- Use muted text (`text-neutral-500` / `text-slate-400`) for secondary information — not a smaller size
- Stick to 2–3 font sizes per component. More than that and you're compensating for poor hierarchy
- Line height matters: use `leading-tight` for headings, `leading-relaxed` for body text
- Don't underline links unless they're inline within prose. Use color + weight instead
- Limit font families to one (two at most, never more — one for UI, one for code/mono)

---

## Color

**Don't reach for grey when things look off. Adjust the relationship.**

- Build a full palette per hue: 50–950 shades. Don't improvise hex values mid-design
- Use HSL mentally: lightness for shade, saturation for vibrancy, hue for identity
- Grey text on a colored background looks dull or muddy. Instead, use a low-opacity or low-saturation version of the background hue for text
- Never put `text-gray-500` on a `bg-blue-600` — use `text-blue-200` or `text-white/70`
- Semantic roles: 1 brand/primary color, 1 accent, 1–2 neutrals, semantic (success/warning/danger)
- Destructive actions: `text-red-600`, not a full `bg-red-600` button unless it's the primary CTA
- Don't rely on color alone to communicate state — pair it with an icon or label

**Dark mode:**

- Flip surface layers (not just `bg-white` → `bg-black`). Use `bg-neutral-900`, `bg-neutral-800`, etc.
- Reduce shadow intensity; increase border visibility slightly
- Slightly desaturate colors in dark mode — pure saturated colors look garish on dark backgrounds

---

## Spacing

**You almost always need more whitespace than you think.**

- Start with too much padding, then pull back. Never start tight
- Use a spacing scale and never deviate: `4`, `8`, `12`, `16`, `20`, `24`, `32`, `40`, `48`, `64`, `80`, `96`
- Padding inside components should be proportional. A small badge: `px-2 py-0.5`. A card: `p-6` or `p-8`
- Ambiguous spacing between related elements destroys grouping. Use proximity intentionally: small gap between label and input, large gap between form sections
- Don't fill the whole screen just because space exists. Constrain content width. `max-w-prose` for text, `max-w-2xl`–`max-w-4xl` for panels

---

## Shadows & Elevation

**Shadows communicate depth. Use them to tell a story about what's above what.**

- Use layered shadows, not a single `box-shadow`:
  ```
  shadow-sm  → subtle: inputs, cards on white
  shadow-md  → raised: dropdowns, floating panels
  shadow-lg  → elevated: modals, popovers
  shadow-xl  → high: command palettes, drawer sheets
  ```
- An `offset-y` shadow feels more natural than a perfectly centered glow
- Flat designs still benefit from `shadow-sm` on interactive surfaces
- Don't use shadows and borders on the same element. Pick one. Shadows on white bg, borders on colored/dark bg

---

## Borders & Dividers

**Use fewer borders. Use spacing and background color instead to separate content.**

- `divide-y` or `border-b` on list items is usually unnecessary — use padding + alternating `bg-neutral-50` or just generous `gap`
- If you must draw a line, keep it subtle: `border-neutral-100` / `border-white/10` in dark mode
- Prefer `rounded-xl` over `rounded` for modern cards. `rounded-2xl` for sheets/modals
- Input borders: `border border-neutral-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20`

---

## Buttons

**Not every action needs a filled button.**

- Primary action: `bg-brand text-white` — only one per view
- Secondary action: `border border-neutral-300 text-neutral-700 bg-white hover:bg-neutral-50`
- Tertiary/ghost: `text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100`
- Destructive: `text-red-600 hover:bg-red-50` (ghost) or `bg-red-600 text-white` only when it's the main action
- Button size must match context. Nav buttons: `h-8 px-3 text-sm`. Form submit: `h-10 px-5 text-base`
- Always add `transition` and `active:scale-[0.98]` for tactile feedback

---

## Forms

- Labels above inputs, always. Placeholder-only is an accessibility and UX failure
- Input states: default, focused (ring), error (red border + red helper text), disabled (reduced opacity + cursor-not-allowed)
- Keep related fields visually grouped. Use `gap-4` within a group, `gap-8` between groups
- Error messages directly below the invalid field, `text-sm text-red-600`, with an icon
- Don't use `required` asterisks — label optional fields instead (it's the minority)

---

## Icons

**Icons should support text, not replace it.**

- Don't scale up icons designed for `16px` or `20px` to `48px`. They'll look blurry and toyish
- Pair icons with labels unless the context makes the icon universally understood (✕ to close, ✓ to confirm)
- Icon size in buttons: `size-4` for small/compact, `size-5` for standard
- Use a single icon library. Never mix outline and filled variants in the same component
- Stroke width matters. Match the weight of surrounding text: thin icons with light text, thicker with heavier UI

---

## Empty States

**Empty states are a design opportunity, not an afterthought.**

- Every list, table, or feed needs an explicit empty state
- Structure: illustration or icon → heading → subtext → primary CTA
- Don't say "No items found." Say "No projects yet — create your first one to get started."
- Keep illustrations simple. Line art or a single hero icon at `size-12`–`size-16` works better than complex SVGs

---

## Layout

- **Don't center everything.** Left-aligned text is faster to read. Center only for hero/marketing copy
- Grids are overused. Many UIs just need `flex` with good `gap` and `max-width`
- Sidebar + content: `grid grid-cols-[240px_1fr]` or `flex` with a fixed-width sidebar
- Use `sticky top-0` for headers and sidebars — don't make users scroll back to nav
- On narrow layouts, stack. Don't try to squeeze side-by-side content below `640px`
- Responsive sizing: size text with `clamp()` or Tailwind's `text-[clamp(...)]` for fluid headings

---

## Component Patterns

### Cards

```
bg-white rounded-xl shadow-sm border border-neutral-100 p-6
```

Dark: `bg-neutral-900 border-white/10`

### Badges / Tags

```
inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
bg-blue-50 text-blue-700   (info)
bg-green-50 text-green-700 (success)
bg-red-50 text-red-700     (error/danger)
bg-neutral-100 text-neutral-600 (neutral)
```

### Code blocks

```
bg-neutral-950 text-neutral-100 rounded-lg p-4 text-sm font-mono
```

### Toasts / Alerts

- Left border accent (`border-l-4 border-blue-500`) on a `bg-blue-50` background reads cleaner than a fully colored bg
- Include an icon, title, description, and optional dismiss button
- Never auto-dismiss error messages

---

## Motion

- Less is more. Most transitions should be `duration-150` or `duration-200`
- Use `ease-out` for things entering (menus, modals, toasts), `ease-in` for things leaving
- Scale-in for menus: `transition-all duration-150 ease-out origin-top-left scale-95 → scale-100 opacity-0 → opacity-100`
- No bounce or spring on utility UI. Reserve personality animations for marketing/onboarding
- Always respect `prefers-reduced-motion`:
  ```css
  @media (prefers-reduced-motion: reduce) {
  	* {
  		transition: none !important;
  	}
  }
  ```

---

## Tooling Defaults (Tailwind)

When writing Tailwind, always:

- Use `ring` utilities with `ring-offset-*` for focus states on white backgrounds
- Prefer `gap-*` over margin on children inside flex/grid containers
- Use `group` + `group-hover:` to reveal secondary actions on row hover
- Use `sr-only` for accessible labels on icon-only buttons
- Use `@layer components` for any repeated multi-class patterns — not arbitrary classes
- Never use `!important` unless overriding a third-party library with no other escape hatch

---

## The Rules That Save Bad Designs

1. **When something looks off, add whitespace first.** 90% of the time that's the fix.
2. **Reduce the number of colors.** If you have 6 different greys, you have too many.
3. **If a layout feels cramped, delete an element.** Subtraction is a design skill.
4. **Don't use a border if a shadow will do. Don't use a shadow if spacing will do.**
5. **Make one thing the clear primary action.** Everything else should step aside.
6. **Match visual weight to semantic weight.** Loud design on quiet content is noise.
7. **Test at 1x and 2x screen densities.** Your `border` might disappear on retina.
8. **Design for the populated state first.** Then handle empty, loading, and error.
