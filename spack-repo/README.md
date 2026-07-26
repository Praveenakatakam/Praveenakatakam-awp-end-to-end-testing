# collegeboard Spack package repo

Shared Spack packages for the CollegeBoard Node.js toolchain. Register this
repo once (globally) and every Spack environment on the machine can use its
packages.

## Packages

- **pnpm** `@11.17.0` — pure-JavaScript pnpm distribution from the npm registry.
  Zero native code; runs on the `node-js` runtime dependency. Requires
  `node-js@22.13:`.
- **node-js** — overlay that subclasses the builtin `node-js` package and adds
  newer 22.x releases (22.13.0, 22.13.1) that the builtin repo hasn't picked up
  yet. Inherits the entire builtin build; only registers extra versions.

## Install / register (once per machine)

```sh
git clone <this-repo> ~/spack-repos/pnpm
spack repo add ~/spack-repos/pnpm      # writes to ~/.spack/repos.yaml (user scope)
spack repo list                        # confirm 'collegeboard' is listed
```

## Use in an environment

Add the specs to any `spack.yaml`:

```yaml
spack:
  specs:
  - 'node-js@22.13.1 ^openssl@3.3:'
  - pnpm
```

Then:

```sh
spack -e . concretize -f
spack -e . install
pnpm --version   # 11.17.0
```

## Updating pnpm

pnpm publishes the pure-JS package to `https://registry.npmjs.org/pnpm`. To bump:

```sh
# get the tarball url + sha256 for the new version, then:
spack checksum pnpm <new-version>     # or edit packages/pnpm/package.py by hand
```

Note the Node.js floor: pnpm 11 requires Node >= 22.13; older pnpm 10.x runs on
Node >= 18.12 (uses `bin/pnpm.cjs` instead of `bin/pnpm.mjs`).
