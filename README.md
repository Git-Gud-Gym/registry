# Git Gud Gym registry

The list of games in [Git Gud Gym](https://git-gud-gym.github.io/)'s library.

CI turns [`modules.json`](modules.json) and each module's latest GitHub release into
**[catalog.json](https://git-gud-gym.github.io/registry/catalog.json)**. The launcher reads that
file to show, install and update games, and the website reads it for its games page. Every
downloadable file is listed with its size and SHA-256, and the launcher refuses anything that
doesn't match.

## Request a game

[Open a game request](../../issues/new?template=game_request.yml), or 👍 an existing one. The most
requested games get built first.

## Add a module

1. Build it with the [SDK](https://github.com/Git-Gud-Gym/sdk) (see
   [Adding a game](https://github.com/Git-Gud-Gym/sdk/blob/main/docs/ADDING_A_GAME.md)).
2. Get the repo into the org as `Git-Gud-Gym/module-<id>`, and publish a release.
3. Open a PR adding it to `modules.json` (and removing it from `planned.json`):
   ```json
   { "id": "sekiro", "repo": "Git-Gud-Gym/module-sekiro" }
   ```
4. The **Validate** check builds the catalog from your release. Once a maintainer merges the PR,
   the game shows up in everyone's library within minutes.

### Why only org repos?

Git Gud Gym runs as administrator and loads modules into game processes. Listing only repos owned
by the organization means every module goes through the same review, CI and release process.
`build-catalog.mjs` rejects anything else.

## How the catalog updates

`publish.yml` runs on every push here, every 30 minutes, and on demand. Module and launcher
release workflows trigger it right away if the org has a `REGISTRY_DISPATCH_TOKEN` secret: a
fine-grained token with *Actions: write* on this repo.

## License

[MIT](LICENSE)
