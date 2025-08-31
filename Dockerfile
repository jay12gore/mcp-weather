# Dockerfile
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install deps
COPY package*.json ./
RUN npm ci

# Build TS
COPY tsconfig.json .
COPY src ./src
RUN npm run build

# Expose the port your app listens on
EXPOSE 3000

# Start
CMD ["npm","start"]
