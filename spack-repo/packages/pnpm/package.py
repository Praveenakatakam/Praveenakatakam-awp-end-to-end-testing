# Copyright Spack Project Developers. See COPYRIGHT file for details.
#
# SPDX-License-Identifier: (Apache-2.0 OR MIT)

from spack.package import *


class Pnpm(Package):
    """Fast, disk space efficient package manager for Node.js.

    Installs the pure-JavaScript pnpm distribution published to the npm
    registry. The package is platform independent (no native binary) and
    zero-dependency: the ``bin/pnpm.mjs`` launcher loads the bundled
    ``dist/pnpm.mjs`` and runs on the Node.js provided as a runtime
    dependency. pnpm 11 requires Node.js >= 22.13.
    """

    homepage = "https://pnpm.io"
    url = "https://registry.npmjs.org/pnpm/-/pnpm-11.17.0.tgz"

    maintainers("nashah")

    version("11.17.0", sha256="644eb5079654e87dae59a07e62d7f098162b9ce58f06077328b5ddefca1c8541")

    # pnpm 11's launcher hard-errors below Node 22.13.
    depends_on("node-js@22.13:", type="run")

    def install(self, spec, prefix):
        # The npm tarball unpacks to a single ``package/`` directory holding
        # bin/, dist/, and package.json. Install that tree under libexec and
        # expose the launcher on PATH via a wrapper that pins our node-js.
        install_tree(".", prefix.libexec)

        node = spec["node-js"].command.path
        launcher = join_path(prefix.libexec, "bin", "pnpm.mjs")
        pnpx_launcher = join_path(prefix.libexec, "bin", "pnpx.mjs")

        mkdirp(prefix.bin)
        self._write_wrapper(join_path(prefix.bin, "pnpm"), node, launcher)
        self._write_wrapper(join_path(prefix.bin, "pnpx"), node, pnpx_launcher)

    def _write_wrapper(self, path, node, launcher):
        with open(path, "w") as f:
            f.write("#!/bin/sh\n")
            f.write('exec "{0}" "{1}" "$@"\n'.format(node, launcher))
        set_executable(path)

    @run_after("install")
    def verify_binary(self):
        pnpm = Executable(join_path(self.prefix.bin, "pnpm"))
        pnpm("--version", output=str, error=str)
