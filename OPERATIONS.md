# NoLSAF Operations & Troubleshooting Guide

This document provides all necessary commands for development, deployment, testing, and troubleshooting the NoLSAF application.

## Table of Contents

- [Quick Start Commands](#quick-start-commands)
- [Development Commands](#development-commands)
- [Build Commands](#build-commands)
- [Testing Commands](#testing-commands)
- [Database Commands](#database-commands)
- [Docker Commands](#docker-commands)
- [Deployment Commands](#deployment-commands)
- [Troubleshooting Commands](#troubleshooting-commands)
- [Health Check Commands](#health-check-commands)
- [Monitoring Commands](#monitoring-commands)

---

## Quick Start Commands

### Start Development Environment

```bash
# Start both API and Web servers in development mode
cd nolsaf
npm run dev
```

**What it does:** Starts the API server on port 4000 and the Web server on port 3000 with hot-reload enabled.

### Start Individual Services

```bash
# Start only API server
cd nolsaf
npm run dev --workspace=@nolsaf/api

# Start only Web server
cd nolsaf
npm run dev --workspace=@nolsaf/web
```

**What it does:** Starts individual services separately, useful for debugging specific components.

---

## Development Commands

### Install Dependencies

```bash
# Install all dependencies (root + all workspaces)
cd nolsaf
npm install

# Or use npm ci for clean install (recommended for CI/CD)
npm ci
```

**What it does:** 
- `npm install` - Installs dependencies and updates package-lock.json
- `npm ci` - Clean install from lockfile, faster and more reliable for production

### Generate Prisma Client

```bash
cd nolsaf
npm run prisma:generate
```

**What it does:** Generates TypeScript types and Prisma Client from your Prisma schema. **Required after schema changes.**

### Type Checking

```bash
# Check API types
npm run typecheck --workspace=@nolsaf/api

# Check Web types
npm run typecheck --workspace=@nolsaf/web

# Check all workspaces
npm run typecheck
```

**What it does:** Validates TypeScript code without building. Catches type errors early.

### Linting

```bash
# Lint API code
npm run lint --workspace=@nolsaf/api

# Lint Web code
npm run lint --workspace=@nolsaf/web

# Lint all workspaces
npm run lint
```

**What it does:** Checks code style and catches potential bugs using ESLint.

---

## Build Commands

### Build All Applications

```bash
cd nolsaf
npm run build
```

**What it does:** Builds all workspaces (shared packages, Prisma, API, Web) in the correct order.

### Build Individual Components

```bash
# Build shared packages (required first)
npm run --workspace=@nolsaf/shared build
npm run --workspace=@nolsaf/prisma build

# Build API
npm run build --workspace=@nolsaf/api

# Build Web
npm run build --workspace=@nolsaf/web
```

**What it does:** 
- Shared packages must be built first (they're dependencies)
- API builds TypeScript to JavaScript in `apps/api/dist/`
- Web builds Next.js app to `apps/web/.next/`

### Production Build

```bash
# Full production build
cd nolsaf
npm ci                    # Clean install
npm run prisma:generate   # Generate Prisma client
npm run build             # Build all workspaces
```

**What it does:** Complete production-ready build process.

---

## Testing Commands

### Run Tests

```bash
# Run API tests
npm run test --workspace=@nolsaf/api

# Run tests in watch mode (auto-rerun on changes)
npm run test:watch --workspace=@nolsaf/api

# Run tests with coverage report
npm run test:coverage --workspace=@nolsaf/api
```

**What it does:** 
- Executes unit and integration tests
- Watch mode is useful during development
- Coverage shows which code is tested

### Test Health Endpoints

```bash
# Using the test script (requires API server running)
cd d:\nolsapp2.1
node test-health-endpoints.js

# Manual testing with curl
curl http://localhost:4000/health
curl http://localhost:4000/ready
curl http://localhost:4000/live
```

**What it does:** 
- Tests health check endpoints
- `/health` - Basic server status
- `/ready` - Database connectivity check
- `/live` - Liveness probe

---

## Database Commands

### Run Migrations

```bash
# Apply all pending migrations
cd nolsaf
npm run prisma:migrate

# Or manually
npx prisma migrate deploy
```

**What it does:** Applies database schema changes from migration files.

### Create New Migration

```bash
cd nolsaf
npx prisma migrate dev --name migration_name
```

**What it does:** Creates a new migration file based on schema changes.

### Reset Database (⚠️ DESTRUCTIVE)

```bash
cd nolsaf
npx prisma migrate reset
```

**What it does:** **WARNING:** Drops database, recreates it, and runs all migrations. **Only use in development!**

### Sync Schema (Development Only)

```bash
cd nolsaf
npx prisma db push
```

**What it does:** Pushes schema changes directly to database without migrations. **Use only in development.**

### View Database

```bash
# Open Prisma Studio (database GUI)
cd nolsaf
npx prisma studio
```

**What it does:** Opens a web interface at http://localhost:5555 to view/edit database records.

### Check Database Connection

```bash
# Test connection using Prisma
cd nolsaf
npx prisma db pull

# Or using MySQL client
mysql -u root -p -h localhost nolsaf
```

**What it does:** 
- `db pull` - Tests connection and syncs schema
- `mysql` - Direct database connection test

---

## Docker Commands

### Build Docker Images

```bash
# Build API image
cd d:\nolsapp2.1
docker build -t nolsaf-api:latest -f nolsaf/Dockerfile .

# Build Web image
docker build -t nolsaf-web:latest -f nolsaf/apps/web/Dockerfile ./nolsaf/apps/web
```

**What it does:** Creates Docker images that can be deployed anywhere Docker runs.

### Run Docker Containers

```bash
# Run API container
docker run -d \
  --name nolsaf-api \
  -p 4000:4000 \
  --env-file .env \
  nolsaf-api:latest

# Run Web container
docker run -d \
  --name nolsaf-web \
  -p 3000:3000 \
  --env-file .env \
  -e NEXT_PUBLIC_API_URL=http://localhost:4000 \
  nolsaf-web:latest
```

**What it does:** 
- `-d` - Runs in detached mode (background)
- `-p` - Maps container port to host port
- `--env-file` - Loads environment variables from file
- `-e` - Sets individual environment variables

### Docker Compose

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Rebuild and restart
docker-compose up -d --build
```

**What it does:** Manages multiple containers together with a single command.

### Docker Management

```bash
# List running containers
docker ps

# List all containers (including stopped)
docker ps -a

# View container logs
docker logs nolsaf-api
docker logs -f nolsaf-api  # Follow logs

# Stop container
docker stop nolsaf-api

# Start stopped container
docker start nolsaf-api

# Remove container
docker rm nolsaf-api

# Remove image
docker rmi nolsaf-api:latest

# Clean up unused resources
docker system prune -a
```

**What it does:** 
- `docker ps` - Shows running containers
- `docker logs` - Shows container output
- `docker system prune` - Removes unused images, containers, networks

---

## Deployment Commands

> **Production boundary:** `staging` is the only shared integration and QA
> branch. Run functional, database, migration-rehearsal, browser, load, and
> regression testing on staging or a disposable/restored snapshot clone. AWS
> Elastic Beanstalk and production RDS are deployment targets only. Do not run
> the generic commands below against AWS production. Production releases must
> follow `nolsaf/API_DEPLOYMENT_GUIDE.md` from an approved, clean `main` commit.

### Production Build & Start

The following sequence is for a controlled local or self-managed environment.
It is not the AWS production deployment procedure.

```bash
# 1. Install dependencies
cd nolsaf
npm ci

# 2. Generate Prisma client
npm run prisma:generate

# 3. Build all workspaces
npm run build

# 4. Run migrations
npm run prisma:migrate

# 5. Start API (production mode)
cd apps/api
NODE_ENV=production node dist/index.js

# 6. Start Web (production mode)
cd apps/web
NODE_ENV=production npm start
```

**What it does:** Complete production deployment process.

### Using PM2 (Process Manager)

```bash
# Install PM2 globally
npm install -g pm2

# Start API with PM2
cd nolsaf/apps/api
pm2 start dist/index.js --name nolsaf-api

# Start Web with PM2
cd nolsaf/apps/web
pm2 start npm --name nolsaf-web -- start

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup

# View PM2 status
pm2 status

# View logs
pm2 logs nolsaf-api
pm2 logs nolsaf-web

# Restart services
pm2 restart nolsaf-api
pm2 restart all

# Stop services
pm2 stop nolsaf-api
pm2 stop all

# Delete from PM2
pm2 delete nolsaf-api
```

**What it does:** 
- PM2 keeps processes running and restarts them if they crash
- `pm2 save` - Saves current process list
- `pm2 startup` - Configures auto-start on server reboot

---

## Troubleshooting Commands

### Port Already in Use (EADDRINUSE)

```bash
# Find process using port 3000 (Windows)
netstat -ano | findstr :3000

# Find process using port 4000 (Windows)
netstat -ano | findstr :4000

# Kill process by PID (Windows)
taskkill /PID <PID> /F

# Find and kill process (Linux/Mac)
lsof -ti:3000 | xargs kill -9
lsof -ti:4000 | xargs kill -9

# Alternative: Use different port
# Edit package.json dev script: "dev": "next dev -p 3001"
```

**What it does:** 
- `netstat` - Shows which process is using a port
- `taskkill` - Terminates the process (Windows)
- `lsof` - Lists open files/ports (Linux/Mac)

### Check Server Status

```bash
# Check if API is running (Windows)
netstat -ano | findstr :4000

# Check if Web is running (Windows)
netstat -ano | findstr :3000

# Check process (Linux/Mac)
lsof -i :4000
lsof -i :3000

# Check Node processes
ps aux | grep node
```

**What it does:** Identifies if ports are in use and which process is using them.

### Check Environment Variables

```bash
# Check all environment variables (Node.js)
node -e "require('dotenv').config(); console.log(process.env)"

# Check specific variable
node -e "require('dotenv').config(); console.log(process.env.DATABASE_URL)"

# Check in PowerShell
$env:DATABASE_URL
```

**What it does:** Verifies environment variables are loaded correctly.

### Database Connection Issues

```bash
# Test database connection
cd nolsaf
npx prisma db pull

# Check database URL format
echo $DATABASE_URL  # Should be: mysql://user:password@host:3306/database

# Test MySQL connection directly
mysql -u root -p -h localhost nolsaf

# Check if MySQL is running
# Windows
sc query MySQL80

# Linux/Mac
systemctl status mysql
```

**What it does:** 
- `db pull` - Tests Prisma connection
- Direct MySQL connection verifies credentials
- Service check confirms MySQL is running

### Clear Build Artifacts

```bash
# Remove Next.js build cache
cd nolsaf/apps/web
rm -rf .next

# Remove API build
cd nolsaf/apps/api
rm -rf dist

# Remove all node_modules (nuclear option)
cd nolsaf
rm -rf node_modules apps/*/node_modules packages/*/node_modules
npm install
```

**What it does:** Clears cached builds that might cause issues.

### Check Logs

```bash
# API logs (if using PM2)
pm2 logs nolsaf-api

# Web logs (if using PM2)
pm2 logs nolsaf-web

# Docker logs
docker logs nolsaf-api
docker logs nolsaf-web

# System logs (Linux)
journalctl -u nolsaf-api -f
```

**What it does:** Shows application output and error messages.

### Verify Prisma Client

```bash
# Regenerate Prisma client
cd nolsaf
npm run prisma:generate

# Verify Prisma client exists
ls node_modules/.prisma/client
```

**What it does:** Ensures Prisma Client is generated and up-to-date.

### Check Dependencies

```bash
# Verify all dependencies are installed
cd nolsaf
npm list --depth=0

# Check for outdated packages
npm outdated

# Check for security vulnerabilities
npm audit

# Fix vulnerabilities (non-breaking)
npm audit fix

# Fix vulnerabilities (breaking changes - use with caution)
npm audit fix --force
```

**What it does:** 
- `npm list` - Shows installed packages
- `npm outdated` - Lists packages with updates
- `npm audit` - Checks for security issues
- `npm audit fix --force` - **WARNING:** May break things, use carefully

### Fix Dependency Issues After npm audit fix --force

```bash
# If npm audit fix --force broke something:

# 1. Check for duplicate dependencies
npm list --depth=0

# 2. Remove node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# 3. Check for version conflicts
npm ls <package-name>

# 4. Restore from git if needed
git checkout package.json package-lock.json
npm install
```

**What it does:** Fixes issues caused by forced dependency updates.

---

## Health Check Commands

### Test Health Endpoints

```bash
# Basic health check
curl http://localhost:4000/health

# Readiness check (includes database)
curl http://localhost:4000/ready

# Liveness check
curl http://localhost:4000/live

# With verbose output
curl -v http://localhost:4000/health

# Using PowerShell (Windows)
Invoke-WebRequest -Uri http://localhost:4000/health | Select-Object -ExpandProperty Content
```

**What it does:** 
- `/health` - Server is running
- `/ready` - Server + database are ready
- `/live` - Process is alive (for Kubernetes)

### Expected Responses

**Health Check (`/health`):**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "environment": "production"
}
```

**Readiness Check (`/ready`):**
```json
{
  "status": "ready",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "checks": {
    "database": "ok"
  }
}
```

**Liveness Check (`/live`):**
```json
{
  "status": "alive",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## Monitoring Commands

### Check System Resources

```bash
# CPU and Memory usage (Windows)
tasklist /FI "IMAGENAME eq node.exe"

# CPU and Memory usage (Linux/Mac)
top
# Or
htop

# Disk usage
df -h

# Check specific process
ps aux | grep node
```

**What it does:** Monitors resource usage to identify performance issues.

### Network Diagnostics

```bash
# Test API endpoint
curl http://localhost:4000/health

# Test with timeout
curl --max-time 5 http://localhost:4000/health

# Check DNS resolution
nslookup api.yourdomain.com

# Test connectivity
ping localhost
```

**What it does:** Diagnoses network-related issues.

### Application Performance

```bash
# Check response times
time curl http://localhost:4000/health

# Monitor API with detailed timing
curl -w "@curl-format.txt" http://localhost:4000/health
```

**What it does:** Measures response times and identifies slow endpoints.

---

## Common Issues & Solutions

### Issue: "Cannot find module '@nolsaf/prisma'"

**Solution:**
```bash
cd nolsaf
npm run prisma:generate
npm run --workspace=@nolsaf/prisma build
```

**What it does:** Regenerates and builds the Prisma package.

### Issue: "Port 3000/4000 already in use" (EADDRINUSE)

**Solution:**
```bash
# Windows - Find and kill process
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac - Find and kill process
lsof -ti:3000 | xargs kill -9

# Or use different port
# Edit package.json: "dev": "next dev -p 3001"
```

**What it does:** Frees up the port or uses an alternative port.

### Issue: "Database connection failed"

**Solution:**
```bash
# Check DATABASE_URL
echo $DATABASE_URL

# Test connection
npx prisma db pull

# Verify MySQL is running
# Windows: sc query MySQL80
# Linux: systemctl status mysql
```

**What it does:** Verifies database configuration and connectivity.

### Issue: "Build fails with TypeScript errors"

**Solution:**
```bash
# Check types
npm run typecheck --workspace=@nolsaf/api

# Clean and rebuild
rm -rf apps/api/dist
npm run build --workspace=@nolsaf/api
```

**What it does:** Identifies and fixes TypeScript compilation errors.

### Issue: "Next.js build fails"

**Solution:**
```bash
# Clear Next.js cache
rm -rf apps/web/.next

# Rebuild
npm run build --workspace=@nolsaf/web
```

**What it does:** Clears corrupted build cache and rebuilds.

### Issue: "Docker build fails"

**Solution:**
```bash
# Clean Docker cache
docker system prune -a

# Rebuild without cache
docker build --no-cache -t nolsaf-api -f nolsaf/Dockerfile .
```

**What it does:** Removes cached layers that might be causing issues.

### Issue: "npm audit fix --force broke dependencies"

**Solution:**
```bash
# 1. Check what changed
git diff package.json

# 2. Restore from git
git checkout package.json package-lock.json

# 3. Clean reinstall
rm -rf node_modules
npm install

# 4. If needed, restore specific packages
npm install <package>@<version>
```

**What it does:** Reverts unwanted dependency changes and restores working state.

---

## Quick Reference

### Daily Development Workflow

```bash
# 1. Start development
cd nolsaf
npm run dev

# 2. In another terminal, run tests
npm run test:watch --workspace=@nolsaf/api

# 3. Check types
npm run typecheck
```

### Pre-Deployment Checklist

```bash
# 1. Run tests
npm run test --workspace=@nolsaf/api

# 2. Type check
npm run typecheck

# 3. Lint
npm run lint

# 4. Build
npm run build

# 5. Test health endpoints
node test-health-endpoints.js
```

### Emergency Restart

```bash
# Stop everything
pm2 stop all
# Or
docker-compose down

# Clear caches
rm -rf apps/*/.next apps/*/dist

# Rebuild
npm run build

# Restart
pm2 start all
# Or
docker-compose up -d
```

### Fix Port Conflicts

```bash
# Find process using port
netstat -ano | findstr :3000

# Kill process (Windows)
taskkill /PID <PID> /F

# Or use different port
# Change in package.json: "dev": "next dev -p 3001"
```

---

## Support

For additional help:
- Check `DEPLOYMENT.md` for deployment-specific issues
- Review application logs: `pm2 logs` or `docker logs`
- Check GitHub Issues: https://github.com/NoLS-Tanzania/nols-app/issues
