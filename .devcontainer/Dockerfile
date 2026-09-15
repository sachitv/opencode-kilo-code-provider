FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

ARG BUN_VERSION=1.4.2
ARG OPENCODE_V1_VERSION=1.18.30
ARG TARGETARCH

RUN rm -f /etc/apt/sources.list.d/debian.sources \
  && printf '%s\n' \
    'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260301T000000Z bookworm main' \
    'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20260301T000000Z bookworm-security main' \
    > /etc/apt/sources.list \
  && apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates \
  && printf '%s\n' \
    'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20260301T000000Z bookworm main' \
    'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/20260301T000000Z bookworm-security main' \
    > /etc/apt/sources.list \
  && apt-get update \
  && apt-get install --yes --no-install-recommends curl git tar unzip \
  && rm -rf /var/lib/apt/lists/*

RUN case "$TARGETARCH" in \
    amd64) bun_arch=x64; bun_sha256=36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913 ;; \
    arm64) bun_arch=aarch64; bun_sha256=54328bbc2d9c8e0c9f892c544d66c57a83b84139e34909e5ee81758f1ac8fda7 ;; \
    *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
  esac \
  && curl --fail --silent --show-error --location \
    "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${bun_arch}.zip" \
    --output /tmp/bun.zip \
  && echo "${bun_sha256}  /tmp/bun.zip" | sha256sum --check \
  && unzip /tmp/bun.zip -d /tmp \
  && install --mode=0755 "/tmp/bun-linux-${bun_arch}/bun" /usr/local/bin/bun \
  && rm -rf /tmp/bun.zip "/tmp/bun-linux-${bun_arch}"

WORKDIR /opt/opencode-v2

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile \
  && bun pm trust @opencode/cli

RUN case "$TARGETARCH" in \
    amd64) opencode_arch=x64; opencode_sha256=55007246858165496ff85ba1c2b648f7421e8e2013bf4189a680c9ff8e699d17 ;; \
    arm64) opencode_arch=arm64; opencode_sha256=4111a55c2a02c0fac314bd51e9a2330280e6d29d2b85b9554fff6d62612566ed ;; \
    *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
  esac \
  && curl --fail --silent --show-error --location \
    "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_V1_VERSION}/opencode-linux-${opencode_arch}.tar.gz" \
    --output /tmp/opencode.tar.gz \
  && echo "${opencode_sha256}  /tmp/opencode.tar.gz" | sha256sum --check \
  && tar --extract --gzip --file /tmp/opencode.tar.gz --directory /tmp \
  && install --directory /root/.opencode/bin \
  && install --mode=0755 /tmp/opencode /root/.opencode/bin/opencode \
  && rm -f /tmp/opencode /tmp/opencode.tar.gz

ENV PATH="/opt/opencode-v2/node_modules/.bin:/root/.opencode/bin:${PATH}"
