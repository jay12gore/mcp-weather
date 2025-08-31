# --- Stage 1: Builder (installs dev deps and compiles TypeScript) ---
    FROM node:20-alpine AS builder
    WORKDIR /app
    
    # Install deps (include devDependencies)
    COPY package*.json ./
    RUN npm ci
    
    # Build TS
    COPY tsconfig.json .
    COPY src ./src
    RUN npm run build
    
    # --- Stage 2: Runner (small, prod-only) ---
    FROM node:20-alpine AS runner
    WORKDIR /app
    ENV NODE_ENV=production
    
    # Install only prod deps
    COPY package*.json ./
    RUN npm ci --omit=dev
    
    # Bring compiled JS
    COPY --from=builder /app/dist ./dist
    
    # Health + port
    EXPOSE 3000
    
    # Start compiled server
    CMD ["node", "dist/server.js"]
    