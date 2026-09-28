# Fleet — design reference

Clickable prototype: canvas **«VersionDrift — Флот хостов»** in Claude (owner: Damir). Artboards:

| Artboard | What it shows |
|---|---|
| A · Доска по продуктам с хостами | board with aggregated tiles, detail panel «Разбивка по версиям» |
| B · Хосты | table, filters, grouping, bulk actions |
| C · Карточка хоста | kzn-fs-01 — access denied but still critical |
| D · Добавить хосты | CSV dry-run preview with line errors |
| E · Профили доступа / Новый профиль | list + wizard (MikroTik instructions) |
| F · Площадки | site switcher popover |
| G · Первый запуск | full setup flow: profile → CSV → live first poll |
| Состояния | every special state on one sheet |
| Light theme ×3, Phone ×2 | theme and mobile |

## Files here

- `prototype/Main.dc.html` — every desktop screen in one file. Markup = layout & copy; the `<script type="text/x-dc">`
  block at the bottom = data, status rules, filters, wizard steps and error texts. **Reference, not production code.**
- `prototype/Phone.dc.html` — mobile triage.
- `prototype/States.dc.html` — static sheet of special states.
- `tokens.css` — dark + light colour tokens from the brief.

Decisions on the brief's open questions are in `docs/specs/fleet-ui.md` §3–§5 (navigation, per-line latest,
no board/hosts toggle, two-axis status, safe bulk actions).
