# Taamara Taamara: design language (v1)

**Direction:** C · Cue Sheet, recoloured in the Taamara Taamara lotus palette (owner decision, 17 Nov 2026).
**Canvas:** "Taamara App Designs", page "Taamara Taamara · Cue Sheet". Sources are in `phase3-system/`.

The layout follows a stage manager's cue sheet: big countdowns, a timeline with a live "now" line, square corners and 2 px rules. The colour and pattern come from the company logo: a lotus of nine petals on cream.

## Colour tokens

| Token | Hex | Use |
|---|---|---|
| `ground` | `#F6F0E3` | Page background (the logo's cream) |
| `paper` | `#FFFCF6` | Panels and cards |
| `ink` | `#2B1020` | Text, 2 px rules (aubergine, never pure black) |
| `ink-quiet` | `#6B5560` | Secondary text (5.7:1 on ground) |
| `rule-soft` | `#E6DCCB` | Row dividers |
| `plum` | `#861A41` | Brand, header band, primary buttons (cream text) |
| `signal-now` | `#B5391C` | "Now" line, late, errors (white text) |
| `signal-look` | `#F3C644` | Active tab, "review" tags, the proof button (ink text) |
| `signal-ok` | `#85A646` | Done, approved, checked in (ink text) |

### Departments: one petal each, used the same way everywhere

| Department | Hex | Text on it |
|---|---|---|
| Decor | `#DD619A` | ink |
| Lights | `#F3C644` | ink |
| Sound | `#E8963A` | ink |
| Catering | `#85A646` | ink |
| Crew | `#861A41` | cream |
| Guests | `#E2A1BB` | ink |
| Photo & video | `#AFC147` | ink |
| Transport | `#D84F2F` | none (shapes and lines only) |

Timeline states: **done** = petal at 26–30 % over paper plus a check icon; **running** = full petal; **scheduled** = 2 px dashed outline in a darker shade of the petal. Colour always comes with a word or shape.

### Night mode (event day in a dark venue)

| Token | Hex |
|---|---|
| `night-ground` | `#1C0B15` |
| `night-panel` | `#2A1220` |
| `night-plum` | `#F28DB8` (plum lifted for dark backgrounds) |
| `night-text` | `#F6EFE0` |

## Patterns

- **Lotus lattice:** a small three-petal lotus on a half-drop grid, in a 56 px tile. Cream at 13 % on plum (headers, alerts) and plum at 9 % on paper (the live "now" panel). Files: `brand/lattice-on-plum.svg`, `brand/lattice-on-cream.svg`.
- **Petal stripe:** the nine logo colours in logo order, 6 px tall, under every header: `#DD619A #E2A1BB #861A41 #E8963A #D84F2F #F0B13C #F3C644 #AFC147 #85A646`.

## Logo

- `brand/logo-supplied.png`: the circular logo as supplied (low resolution; the original file is needed for print and for the app icon).
- The app mark is a vector redraw of the lotus (nine petals, separated by 3–4 px gaps in the background colour). On plum it sits on a cream disc. Its SVG paths are inline in every `phase3-system/*.dc.html` file.

## Type

| Face | Use |
|---|---|
| Archivo, condensed (wdth 62–70), Black 900 | Countdowns, big numbers, the wordmark "TAAMARA TAAMARA" |
| IBM Plex Sans 400–700 | Names, notes, instructions |
| IBM Plex Mono 500–600, tracked +0.06–0.08 em, uppercase | Labels, times, money, tags, buttons |

## Rules

- Every tap target is at least 44 px; the crew app's main action is 58 px.
- Square corners (3–4 px radius) and 2 px ink rules; no drop shadows, gradients or rounded "card soup".
- iPad landscape uses the three-column owner layout; iPad portrait and phone stack the same blocks.
- Photos (from work proof) appear only where they help: booking covers and the proof grid.
