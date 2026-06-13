# Third-Party Notices

This file lists third-party software incorporated into VibeSeek.

## React Bits — DotField

**Source**: https://reactbits.dev (https://github.com/DavidHDev/react-bits)
**License**: MIT + Commons Clause
**File(s)**: apps/desktop/src/renderer/src/components/fx/DotField.tsx
**Notes**: Ported the DotField interactive dot-grid backdrop (JS-CSS variant,
zero dependencies). Adapted to TypeScript; sparkle/wave/physics modes dropped
(bulge-only), paused while the document is hidden, theme-aware colors via props.

## React Bits — design ideas (original implementations)

SpotlightCard (cursor-following card glow), StarBorder (orbiting border light)
and ClickSpark (click burst) in `global.css` / `fx/ClickSpark.tsx` are original
CSS/canvas implementations inspired by the React Bits components of the same
names — no code was copied.

(Previously ported Iridescence/Orb were removed after design review; the `ogl`
dependency went with them.)

## Bundled fonts (T4.3a)

**Inter** — Copyright (c) 2016 The Inter Project Authors (https://rsms.me/inter).
Licensed under the SIL Open Font License 1.1 — free for commercial use and
redistribution. Full license: [licenses/Inter-LICENSE.txt](licenses/Inter-LICENSE.txt).
File: apps/desktop/src/renderer/src/assets/fonts/InterVariable.woff2

**JetBrains Mono** — Copyright 2020 The JetBrains Mono Project Authors
(https://github.com/JetBrains/JetBrainsMono). Licensed under the SIL Open Font
License 1.1. Full license: [licenses/JetBrainsMono-OFL.txt](licenses/JetBrainsMono-OFL.txt).
File: apps/desktop/src/renderer/src/assets/fonts/JetBrainsMono-Regular.woff2

CJK text renders with the user's INSTALLED system fonts (Microsoft YaHei /
PingFang), referenced by name in CSS only — no font file is redistributed.

## Icons

**lucide-react** (https://lucide.dev) — ISC License, free for commercial use.
Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part
of Feather (MIT); all other copyright (c) Lucide Contributors 2022.
