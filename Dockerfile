# --- Stage 1: Builder ---
    FROM node:20-alpine AS builder
    WORKDIR /app
    
    # Install deps (includes devDeps so tsc is available)
    COPY package*.json ./
    RUN npm ci
    
    # Build TypeScript -> dist/
    COPY tsconfig.json .
    COPY src ./src
    RUN npm run build
    
    # --- Stage 2: Runner ---
    FROM node:20-alpine AS runner
    WORKDIR /app
    ENV NODE_ENV=production
    
    # Install only production deps
    COPY package*.json ./
    RUN npm ci --omit=dev
    
    # Bring compiled output
    COPY --from=builder /app/dist ./dist
    
    EXPOSE 3000
    CMD ["node", "dist/server.js"]
    