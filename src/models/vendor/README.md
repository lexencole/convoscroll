# Model icon sources

The seven monochrome SVG paths in `../model-brand-paths.ts` come from
[LobeHub Icons](https://github.com/lobehub/lobe-icons/tree/a94750e3f5f8fc33757b839d85030e742284e43a/packages/static-svg/icons),
commit `a94750e3f5f8fc33757b839d85030e742284e43a`, retrieved 2026-09-19.

Files: `openai.svg`, `gemini.svg`, `claude.svg`, `deepseek.svg`,
`kimi.svg`, `zai.svg` (GLM), and `grok.svg`.

GLM uses the Z.ai mark from
[`zai.svg`](https://github.com/lobehub/lobe-icons/blob/a94750e3f5f8fc33757b839d85030e742284e43a/packages/static-svg/icons/zai.svg)
at the same commit; Z.ai is the GLM chat product at [chat.z.ai](https://chat.z.ai/).
GLM and ChatGLM aliases both resolve to it; saved model text is preserved.

Only the path data is embedded in React. Geometry, the 24×24 viewBox and the
even-odd fill are unchanged; the theme supplies `currentColor`. Nothing is
fetched at runtime and no icon package is installed. A custom avatar always
takes priority over these icons.

The upstream MIT license is in `LICENSE` and is also included in the generated
`public/THIRD_PARTY_NOTICES.txt`. Brand names and trademarks belong to their
owners; the license does not imply affiliation or endorsement.
