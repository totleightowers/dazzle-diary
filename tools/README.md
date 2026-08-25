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

## Seeing the layout without a browser

`layout-probe.mjs` resolves the cascade at a given viewport width. It is not a
renderer: it answers "at this width, which rules win for this element, and what
do the properties that decide the layout come out as?" — which is the question
that otherwise gets guessed at from screenshots.

```sh
node tools/layout-probe.mjs 1028
```

`preview.mjs` serves `app/` over HTTP so the same code can be opened in an
ordinary browser at any width. If it lays out correctly there and wrongly in
the app, the problem is the WebView rather than the CSS.

```sh
node tools/preview.mjs     # http://localhost:8788
```

## Hooks

`main` is written to by merging a pull request, never by committing to it. The
remote refuses a direct push outright — branch protection applies to
administrators too, with no override — and these hooks catch it a step earlier,
before the work ends up on the wrong branch and has to be moved.

```sh
git config core.hooksPath tools/hooks
```

`pre-commit` refuses a commit made while on `main`; `pre-push` refuses a push to
it.
