# Changelog

## [0.5.0](https://github.com/swoofer/promptweave/compare/v0.4.1...v0.5.0) (2026-08-25)


### Features

* **phases:** propage requireFailingTest jusqu'à l'agent-loop ([#23](https://github.com/swoofer/promptweave/issues/23)) ([5b0d97d](https://github.com/swoofer/promptweave/commit/5b0d97dd0a2faa5963d975c15684c0869854e8ef))

## [0.4.1](https://github.com/swoofer/promptweave/compare/v0.4.0...v0.4.1) (2026-08-13)


### Bug Fixes

* **test:** timeout adapté aux tests qui lancent la CLI en sous-processus ([#20](https://github.com/swoofer/promptweave/issues/20)) ([ddbfa50](https://github.com/swoofer/promptweave/commit/ddbfa509b7fbc0b49f2e4da793d9cf76d916e8cc))

## [0.4.0](https://github.com/swoofer/promptweave/compare/v0.3.0...v0.4.0) (2026-08-13)


### Features

* **warnings:** signale un param fourni que rien ne peut lire ([#16](https://github.com/swoofer/promptweave/issues/16)) ([6b0b22d](https://github.com/swoofer/promptweave/commit/6b0b22dab24317d326d0fa3c7518a5194ac4fc57))

## [0.3.0](https://github.com/swoofer/promptweave/compare/v0.2.0...v0.3.0) (2026-07-14)


### Features

* extra_frontmatter passthrough + side-car files for skill renderer ([3904b6d](https://github.com/swoofer/promptweave/commit/3904b6d878ea4fb10a6e29e1070a18c699d4766c))
* **registry:** catalogue multi-racines — Registry.load accepte plusieurs roots ([#9](https://github.com/swoofer/promptweave/issues/9)) ([7fbd522](https://github.com/swoofer/promptweave/commit/7fbd522d98c1ba6a80fe175e10733354f3725633))
* **renderers:** extra_frontmatter passthrough on preset ([2f73034](https://github.com/swoofer/promptweave/commit/2f7303460fec3b943a48487d1065af0c730489b1))
* **renderers:** side-car files (multi-file skill output) ([951892d](https://github.com/swoofer/promptweave/commit/951892d43a70119e89e4072fda8e3c47ed2976a7))


### Bug Fixes

* **schema:** la garde anti-chemin-absolu ne dépend plus de l'OS ([#10](https://github.com/swoofer/promptweave/issues/10)) ([d8e9ade](https://github.com/swoofer/promptweave/commit/d8e9adeae08aaad86977aa02b671833000e242b4))
* **side-car:** Windows path validation, real atomicity test, interpolate source + agent ([bb87016](https://github.com/swoofer/promptweave/commit/bb870168c13572cdf75c8302d5710e25c6e93e26))

## [0.2.0](https://github.com/swoofer/promptweave/compare/v0.1.1...v0.2.0) (2026-05-08)


### Features

* --target skill emits Claude Code SKILL.md from presets ([df75764](https://github.com/swoofer/promptweave/commit/df75764c8281a6ae627af330822f4fb89657b62d))
* **api:** export Renderer, RenderContext, RenderedParam, registry, bundleRenderer ([2c60a55](https://github.com/swoofer/promptweave/commit/2c60a55e0fefd6b35756edd3aa348fc72bbdba5c))
* **cli:** add --target flag and dispatch via renderer registry (bundle only) ([8006842](https://github.com/swoofer/promptweave/commit/8006842aed25722fe764adc3c7e9d3c613cd1fdb))
* **cli:** target-aware dry-run for skill mode ([6280c3e](https://github.com/swoofer/promptweave/commit/6280c3e3aefb36191910ac643782d619fd4bbd62))
* **cli:** wire skill target context (description + resolved params) ([6240128](https://github.com/swoofer/promptweave/commit/6240128416c5c5fd859540fec432a419ab44dac9))
* extra_frontmatter passthrough + side-car files for skill renderer ([f7a3ff6](https://github.com/swoofer/promptweave/commit/f7a3ff6fb5f995f35a88c5c1a19c05ef3bee41b8))
* **renderers:** basic ## Parameters section rendering ([41f08a4](https://github.com/swoofer/promptweave/commit/41f08a444de453241b42c6765ba02f64d93a4193))
* **renderers:** extra_frontmatter passthrough on preset ([5826bc0](https://github.com/swoofer/promptweave/commit/5826bc08747f1dbc97b623bb9ee23f086f1d9fca))
* **renderers:** scaffold Renderer interface, RenderContext, and empty registry ([931671c](https://github.com/swoofer/promptweave/commit/931671c6fe5d70336a6639543434fdb8ae3faa73))
* **renderers:** side-car files (multi-file skill output) ([6fe1dd6](https://github.com/swoofer/promptweave/commit/6fe1dd6b647cea70e77f830d9776211a060d202a))
* **renderers:** skill renderer with frontmatter, slug check, empty-prompt check, YAML escaping ([a96e228](https://github.com/swoofer/promptweave/commit/a96e228a41db8650038d832ca84d419d43624cd9))
* **renderers:** warn on frontmatter delimiter collision in composed prompt ([0e5bc5c](https://github.com/swoofer/promptweave/commit/0e5bc5c2ca378fa8763be8da9c9232d40b5c39bc))
* **renderers:** warn-and-drop envVars in skill mode ([3f57884](https://github.com/swoofer/promptweave/commit/3f578847e70102f77e4ef828c7b65ca1a509bf05))
* **renderers:** warn-and-drop hooks in skill mode ([604cf39](https://github.com/swoofer/promptweave/commit/604cf3931c5aa20859f4970b07bc3797be7a6d25))
* **renderers:** warn-and-drop mcp_tools in skill mode ([0ffa285](https://github.com/swoofer/promptweave/commit/0ffa28559f1ce706c09d5b3c8c6ba784ad3dc511))
* **renderers:** warn-and-drop phases in skill mode ([aa28a6d](https://github.com/swoofer/promptweave/commit/aa28a6debd340b19e0ae5a1fb57fa03d01089298))


### Bug Fixes

* **bundle:** apply backup-swap atomicity pattern (parity with skill renderer) ([e26cb4e](https://github.com/swoofer/promptweave/commit/e26cb4e229643ae3df99ba1706124204d2849a7c))
* **side-car:** Windows path validation, real atomicity test, interpolate source + agent ([69ce38c](https://github.com/swoofer/promptweave/commit/69ce38c088b21e2554e694a7c0910fffc7215c20))
* tsc error on readonly args + export skillRenderer publicly ([b056167](https://github.com/swoofer/promptweave/commit/b05616738f446c0af7699eff02a1084787a24408))

## [0.1.1](https://github.com/swoofer/promptweave/compare/v0.1.0...v0.1.1) (2026-05-06)


### Bug Fixes

* **landing:** missing commas in i18n dict broke JS parsing ([8d35d8e](https://github.com/swoofer/promptweave/commit/8d35d8e4390b31723d0ed0cd2f26872720cfb95d))
