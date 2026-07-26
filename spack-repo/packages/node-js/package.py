# Copyright Spack Project Developers. See COPYRIGHT file for details.
#
# SPDX-License-Identifier: (Apache-2.0 OR MIT)

from spack.pkg.builtin.node_js import NodeJs as BuiltinNodeJs

from spack.package import *


class NodeJs(BuiltinNodeJs):
    """Node.js runtime — local overlay that adds newer 22.x releases the
    builtin repo hasn't caught up to yet.

    Inherits everything (build system, variants, deps) from the builtin
    package; we only register additional ``version()`` directives. Checksums
    are the official SHA-256 of the source tarballs from
    https://nodejs.org/dist/v<ver>/SHASUMS256.txt.
    """

    version("22.13.1", sha256="e7d5b1e84e7f3c3cebda81e2b138469eef41ba4ecf16a87fd15fc3f7afa3f701")
    version("22.13.0", sha256="38e15a1d0dd0e95c237bc4651d7c9930a78d3fe7954a7ee7693b403f2d879e46")
