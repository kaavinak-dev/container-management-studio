FROM rclone/rclone:latest AS rclone

FROM node:20-slim

# Build tools required by node-pty native addon (node-gyp)
RUN apt-get update && apt-get install -y \
      python3 make g++ \
      fuse3 \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy rclone binary directly from official image — no curl, no runtime download
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone

# Allow FUSE mounts to be readable by other processes in the container
RUN sed -i 's/#user_allow_other/user_allow_other/' /etc/fuse.conf

# Set up sidecar app directory with its runtime dependencies
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev

COPY editor-sidecar.js .

# Entrypoint: mounts FUSE then starts sidecar
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create the workspace mount point
RUN mkdir -p /workspace

EXPOSE 5003 9999 9229

CMD ["/entrypoint.sh"]
