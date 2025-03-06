# Use official Node.js LTS image for ARM64
FROM --platform=linux/arm64 node:18-bullseye-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Create logs directory
RUN mkdir -p logs

# Set environment to production
ENV NODE_ENV=production

# Expose any necessary ports (if needed)
# EXPOSE 3000

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Command to run the application
CMD ["npm", "start"]