# Use official Node.js LTS image for ARM64
FROM --platform=linux/arm64 node:18-alpine

# Install system dependencies and network tools
RUN apk add --no-cache \
    postgresql-client \
    bind-tools \
    netcat-openbsd \
    curl \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Create logs directory with proper permissions
RUN mkdir -p logs && chmod -R 777 logs

# Set environment to production
ENV NODE_ENV=production

# Create a non-root user
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose any necessary ports (if needed)
# EXPOSE 3000

# Command to run the application
CMD ["npm", "start"]