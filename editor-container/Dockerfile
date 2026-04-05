FROM node:20-slim

# Install typescript-language-server and typescript globally so the binary is on PATH
RUN npm install -g typescript typescript-language-server

# Set up sidecar app directory with its runtime dependencies
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev

# Copy the sidecar script
COPY editor-sidecar.js .

# Create the workspace mount point
RUN mkdir -p /workspace

EXPOSE 5002 5003

CMD ["node", "--inspect=0.0.0.0:9229", "/app/editor-sidecar.js"]
