# The Safex Node -- runs the official safexd daemon in a container.
#
# This downloads the maintainer-published release binary for
# safexcore (https://github.com/safex/safexcore) directly from
# GitHub Releases and verifies it against the maintainer's own
# published SHA-256 checksum before it is ever executed. Nothing
# here is fetched from an unverified third party or a bare script.
#
# Bump SAFEXCORE_VERSION to track a newer safexcore release; it must
# match a real tag (e.g. "7.0.3") that published a
# "safexd-linux-<version>" asset and a "SHA256SUMS" file.
FROM ubuntu:22.04

ARG SAFEXCORE_VERSION=7.0.3

ENV DEBIAN_FRONTEND=noninteractive

# The official binary's exact runtime linkage isn't published, so
# this installs the full -dev metapackages (which pull in their
# runtime .so counterparts) rather than guessing specific per-distro
# runtime package names/versions. Costs some image size, avoids a
# fragile guess.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      libboost-all-dev \
      libssl3 \
      libzmq5 \
      libunbound8 \
      libminiupnpc17 \
      libunwind8 \
      liblzma5 \
      libreadline8 \
      libldns3 \
      libexpat1 \
      libpcsclite1 \
      libprotobuf23 \
      python3 \
      python3-lmdb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/safex

RUN curl -fsSL -O \
      "https://github.com/safex/safexcore/releases/download/${SAFEXCORE_VERSION}/safexd-linux-${SAFEXCORE_VERSION}" \
 && curl -fsSL -O \
      "https://github.com/safex/safexcore/releases/download/${SAFEXCORE_VERSION}/SHA256SUMS" \
 && grep " safexd-linux-${SAFEXCORE_VERSION}$" SHA256SUMS | sha256sum -c --strict - \
 && chmod +x "safexd-linux-${SAFEXCORE_VERSION}" \
 && mv "safexd-linux-${SAFEXCORE_VERSION}" /usr/local/bin/safexd \
 && rm SHA256SUMS

# Read-only chain-database health check, used by the app's Maintenance panel.
# Baked into the image (with python3-lmdb above) so it works offline. Placed
# after the download so editing the script doesn't re-download the daemon.
COPY diagnose-chain-db.py /opt/safex/diagnose-chain-db.py

# Blockchain data lives in a named volume so it survives container
# restarts/rebuilds and doesn't need to resync from scratch.
VOLUME ["/data"]

# 17401 = P2P, 17402 = RPC, 17403 = ZMQ RPC (safexcore defaults).
EXPOSE 17401 17402 17403

ENTRYPOINT ["safexd", "--data-dir", "/data", "--rpc-bind-ip", "0.0.0.0", "--rpc-bind-port", "17402", "--confirm-external-bind", "--p2p-bind-ip", "0.0.0.0", "--p2p-bind-port", "17401", "--non-interactive", "--log-level", "0"]
