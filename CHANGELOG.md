# Changelog

## [0.2.0](https://github.com/swoofer/promptweave/compare/v0.1.0...v0.2.0) (2026-05-22)


### Features

* --target skill emits Claude Code SKILL.md from presets ([1f01e55](https://github.com/swoofer/promptweave/commit/1f01e55033be992d32307bcd891115bc734ee970))
* **api:** export Renderer, RenderContext, RenderedParam, registry, bundleRenderer ([c2c5ed2](https://github.com/swoofer/promptweave/commit/c2c5ed2e41fe0898ba08064ec3966bf383383504))
* **cli:** add --target flag and dispatch via renderer registry (bundle only) ([fdea492](https://github.com/swoofer/promptweave/commit/fdea492820056aab0d383e7e09d3d59c7ef6c3a0))
* **cli:** target-aware dry-run for skill mode ([28c076d](https://github.com/swoofer/promptweave/commit/28c076d81117ec3bd756036a197051037cb47868))
* **cli:** wire skill target context (description + resolved params) ([13c2077](https://github.com/swoofer/promptweave/commit/13c20775e09af3b9f1ff1240dd01600e4dfc7569))
* extra_frontmatter passthrough + side-car files for skill renderer ([3904b6d](https://github.com/swoofer/promptweave/commit/3904b6d878ea4fb10a6e29e1070a18c699d4766c))
* **renderers:** basic ## Parameters section rendering ([8520b54](https://github.com/swoofer/promptweave/commit/8520b54e7e96cc3ea1ead65fbef5c83fce80aeae))
* **renderers:** extra_frontmatter passthrough on preset ([2f73034](https://github.com/swoofer/promptweave/commit/2f7303460fec3b943a48487d1065af0c730489b1))
* **renderers:** scaffold Renderer interface, RenderContext, and empty registry ([6e70ddd](https://github.com/swoofer/promptweave/commit/6e70dddde12c2452758175cdc716961bd0367119))
* **renderers:** side-car files (multi-file skill output) ([951892d](https://github.com/swoofer/promptweave/commit/951892d43a70119e89e4072fda8e3c47ed2976a7))
* **renderers:** skill renderer with frontmatter, slug check, empty-prompt check, YAML escaping ([839556a](https://github.com/swoofer/promptweave/commit/839556a643fddfbd027ef2bebd16771341758984))
* **renderers:** warn on frontmatter delimiter collision in composed prompt ([af0ebce](https://github.com/swoofer/promptweave/commit/af0ebce1d463ff13835923fc56c06feae1b7306b))
* **renderers:** warn-and-drop envVars in skill mode ([db58d32](https://github.com/swoofer/promptweave/commit/db58d32517d8d17a986c5fb5b4644d878c60f74a))
* **renderers:** warn-and-drop hooks in skill mode ([19dcf17](https://github.com/swoofer/promptweave/commit/19dcf172f862bd0e5de971b55504444476293b73))
* **renderers:** warn-and-drop mcp_tools in skill mode ([e183e9f](https://github.com/swoofer/promptweave/commit/e183e9f81f27804af487c9aee6b1acb81c9f8f0e))
* **renderers:** warn-and-drop phases in skill mode ([a334cf9](https://github.com/swoofer/promptweave/commit/a334cf9244821777c9445ab4d1f5416e5de564fe))


### Bug Fixes

* **bundle:** apply backup-swap atomicity pattern (parity with skill renderer) ([598f6c6](https://github.com/swoofer/promptweave/commit/598f6c63fd858404d7e3db733ec40dfa0452c7e7))
* **landing:** missing commas in i18n dict broke JS parsing ([e0cf024](https://github.com/swoofer/promptweave/commit/e0cf0248beae3592b3302426c2da69fa8dbdf4dc))
* **side-car:** Windows path validation, real atomicity test, interpolate source + agent ([bb87016](https://github.com/swoofer/promptweave/commit/bb870168c13572cdf75c8302d5710e25c6e93e26))
* tsc error on readonly args + export skillRenderer publicly ([369c15c](https://github.com/swoofer/promptweave/commit/369c15ca212891f0b0410ab983a53654cb166ea5))

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
