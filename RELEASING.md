# Releasing JJ Plus

The repository is prepared so the normal release path is a versioned Git tag. GitHub Actions runs the release checks, packages the VSIX, and publishes it to the Visual Studio Code Marketplace.

## One-time manual setup

1. Sign in to the [Visual Studio Marketplace publisher portal](https://marketplace.visualstudio.com/manage) with the `astahmer` publisher account. Create the publisher if it does not exist.
2. In Azure DevOps, create a personal access token with Marketplace **Manage** scope. Store it somewhere safe; it is only needed by CI.
3. In the GitHub repository settings, add an Actions secret named `VSCE_PAT` containing that token.
4. To publish the optional terminal CLI, create an npm automation token and add it as an Actions secret named `NPM_TOKEN`. Marketplace publishing does not install or expose the CLI, so this is a separate package distribution step.

## Each release

1. Update `version` in `package.json` and add the release notes to `CHANGELOG.md`.
2. Run `pnpm release:check` locally. It runs lint, both typechecks, unit/webview tests, builds the extension and webview, and packages the VSIX.
3. Commit the release metadata. With JJ, `jj commit` leaves the new empty working-copy child at `@`, so the release commit is `@-`.
4. Move `main` to that release commit, then create and push the matching tag. For version `0.10.3`:

   ```sh
   jj commit -m "release: v0.10.3"
   jj bookmark set main -r @-
   jj git push --bookmark main
   jj tag set v0.10.3 -r @-
   jj git push --tag v0.10.3
   ```

   If the repository is being released from a Git checkout instead, the equivalent final action is `git tag v0.10.3 && git push origin v0.10.3`.
5. Open the GitHub Actions run for the tag and wait for it to finish.
6. Check the published [JJ Plus Marketplace listing](https://marketplace.visualstudio.com/) and install the VSIX once in a clean VS Code profile.

## What CI does

The `v*` tag workflow checks that the tag matches `package.json`, installs the pinned pnpm toolchain, runs `pnpm release:publish`, and publishes with `vsce` using `VSCE_PAT`. When `NPM_TOKEN` exists, it also publishes the CLI package to npm and skips that step if the exact version is already present. No local Marketplace credentials or manual VSIX upload are needed.

## Recovery

- A failed check does not publish anything; fix the commit and move the tag to the corrected release before retrying.
- A failed Marketplace publish can be retried by rerunning the workflow after fixing the credential or publisher configuration.
- `--skip-duplicate` makes a rerun safe when the exact version was already accepted by the Marketplace.
