# tools

`mkicon.py` draws the app icon and writes every size the app and the launcher
need — no Pillow or librsvg required, which is what makes it runnable on the
phone this was built on.

```sh
python3 tools/mkicon.py
```

It writes `app/icon.svg`, the three web icons, and the five launcher densities
(legacy, adaptive background, adaptive foreground). Edit `ROWS`, `PLACED` and
`SPARKLE` at the top to change the design.
