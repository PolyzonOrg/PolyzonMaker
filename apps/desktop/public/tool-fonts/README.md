# Fonts of the text tools

Regular faces downloaded from Google Fonts (fonts.gstatic.com) on 2026-10-19
and shipped unchanged. Each comes with its licence, which allows bundling and
redistribution:

| Family | File | Licence |
| --- | --- | --- |
| Roboto Slab | RobotoSlab-Regular.ttf | Apache 2.0 — LICENSE-robotoslab.txt |
| Oswald | Oswald-Regular.ttf | SIL OFL 1.1 — OFL-oswald.txt |
| Comfortaa | Comfortaa-Regular.ttf | SIL OFL 1.1 — OFL-comfortaa.txt |
| Lobster | Lobster-Regular.ttf | SIL OFL 1.1 — OFL-lobster.txt |
| Russo One | RussoOne-Regular.ttf | SIL OFL 1.1 — OFL-russoone.txt |
| PT Serif | PTSerif-Regular.ttf | SIL OFL 1.1 — OFL-ptserif.txt |

A page fetches a file only when its font is chosen (src/lib/tools/shared/fonts.ts)
and hands it to the browser OpenSCAD with the compile.
